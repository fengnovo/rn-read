import {
  pick,
  pickDirectory,
  types,
  isErrorWithCode,
  errorCodes,
} from "@react-native-documents/picker";
import * as Crypto from "expo-crypto";
import { createMarkdown } from "../core/markdown";
import {
  identity,
  listDirectory,
  resolveRelative,
  copyToLocal,
  type DocumentEntry,
} from "../../modules/document-access";
import { Library } from "../database/library";
import type { Folder, Resource } from "../core/types";
import { resolveRelativePath } from "../core/paths";
import * as files from "../storage/files";

export const hash = (value: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
export const cancelled = (error: unknown) =>
  isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;
export class Documents {
  constructor(private library: Library) {}
  async chooseFile() {
    const [file] = await pick({
      mode: "open",
      requestLongTermAccess: true,
      type: [types.allFiles],
    });
    return this.importFile(
      file.uri,
      file.name ?? "文档",
      undefined,
      undefined,
      "bookmark" in file ? file.bookmark : undefined,
    );
  }
  async chooseFolder(replacingId?: string) {
    const result = await pickDirectory({ requestLongTermAccess: true });
    if (result.bookmarkStatus === "error")
      throw Error("无法保存目录权限：" + result.bookmarkError);
    const folders = await this.library.folders();
    const existing = folders.find((f) => f.uri === result.uri);
    const replacing = folders.find((f) => f.id === replacingId);
    const decoded = decodeURIComponent(result.uri);
    const name = decoded.split(/[/:]/).filter(Boolean).pop() ?? "文件夹";
    const folder: Folder = {
      id: existing?.id ?? replacing?.id ?? Crypto.randomUUID(),
      name,
      uri: result.uri,
      bookmark: result.bookmark,
      lastPath: existing?.lastPath ?? replacing?.lastPath ?? "",
      lastOpenedAt: Date.now(),
    };
    if (replacing && replacing.id !== folder.id)
      await this.library.mergeFolder(replacing.id, folder.id);
    await this.library.saveFolder(folder);
    return folder;
  }
  private async renew(
    folder: Folder,
    result: { rootUri?: string; bookmark?: string },
  ) {
    if (result.rootUri) folder.uri = result.rootUri;
    if (result.bookmark) folder.bookmark = result.bookmark;
    await this.library.saveFolder(folder);
  }
  async list(folder: Folder, path: string): Promise<DocumentEntry[]> {
    const location = path
      ? await resolveRelative(folder.uri, path, folder.bookmark)
      : { uri: folder.uri, rootUri: folder.uri };
    await this.renew(folder, location);
    const result = await listDirectory(location.uri, folder.bookmark);
    folder.lastPath = path;
    await this.renew(folder, result);
    return result.entries.sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name),
    );
  }
  async openRelative(folder: Folder, path: string) {
    const resolved = await resolveRelative(folder.uri, path, folder.bookmark);
    await this.renew(folder, resolved);
    return this.importFile(
      resolved.uri,
      path.split("/").pop() ?? "文档",
      folder,
      path,
    );
  }
  async importFile(
    sourceUri: string,
    name: string,
    folder?: Folder,
    relativePath?: string,
    bookmark?: string,
  ) {
    const type = /\.(md|markdown|txt)$/i.test(name)
      ? "markdown"
      : /\.pdf$/i.test(name)
        ? "pdf"
        : null;
    if (!type) throw Error("请选择 Markdown（.md/.markdown/.txt）或 PDF 文件");
    const info = await identity(sourceUri, folder?.bookmark ?? bookmark);
    if (folder) await this.renew(folder, info);
    const key = "file:" + info.identity;
    const old = await this.library.bySource(key);
    const id = old?.id ?? Crypto.randomUUID();
    const job = Crypto.randomUUID();
    const staging = "staging/" + job,
      final = "imported/" + job;
    await files.mkdir(staging + "/assets");
    await this.library.startJob(job, id, staging, final);
    const document = "document." + (type === "pdf" ? "pdf" : "md");
    const warnings: string[] = [];
    try {
      await copyToLocal(
        info.uri,
        files.uri(staging + "/" + document),
        folder?.bookmark ?? bookmark,
      );
      if (type === "markdown") {
        if ((await files.size(staging + "/" + document)) > 20 * 1024 * 1024)
          throw Error("Markdown 超过20 MiB，无法打开");
        const text = await files.read(staging + "/" + document);
        if (text.length > 20 * 1024 * 1024)
          throw Error("Markdown 超过20 MiB，无法打开");
        const md = createMarkdown();
        const tokens = md.parse(text, {});
        const assets = new Map<string, string>();
        const images = tokens
          .flatMap((t) => t.children ?? [])
          .filter((t) => t.type === "image");
        for (const image of images) {
          const target = String(image.attrGet("src") ?? "");
          if (assets.has(target)) continue;
          if (target.startsWith("data:image/")) {
            assets.set(target, target);
            continue;
          }
          if (!folder || !relativePath || /^(https?:|\/\/)/i.test(target)) {
            warnings.push("图片未保存：" + target);
            assets.set(target, "");
            continue;
          }
          try {
            const path = resolveRelativePath(relativePath, target);
            const imageInfo = await resolveRelative(
              folder.uri,
              path,
              folder.bookmark,
            );
            await this.renew(folder, imageInfo);
            const extension =
              /\.(png|jpg|jpeg|gif|webp|svg|avif|bmp)$/i.exec(path)?.[1] ??
              "img";
            const assetPath = "assets/" + (await hash(path)) + "." + extension;
            await copyToLocal(
              imageInfo.uri,
              files.uri(staging + "/" + assetPath),
              folder.bookmark,
            );
            assets.set(target, "../../" + final + "/" + assetPath);
          } catch (error) {
            warnings.push("图片不可读取：" + target);
            assets.set(target, "");
          }
        }
        const imageRule = md.renderer.rules.image!;
        md.renderer.rules.image = (tokens, index, options, env, self) => {
          const token = tokens[index]!;
          const original = String(token.attrGet("src") ?? "");
          token.attrSet("src", assets.get(original) ?? "");
          if (!token.attrGet("src")) token.attrSet("alt", "图片未保存离线");
          return imageRule(tokens, index, options, env, self);
        };
        const fenceRule = md.renderer.rules.fence!;
        let graph = 0;
        md.renderer.rules.fence = (tokens, index, options, env, self) =>
          tokens[index]!.info.trim() === "mermaid"
            ? `<div class="mermaid" data-svg-key="${graph++}">${md.utils.escapeHtml(tokens[index]!.content)}</div>`
            : fenceRule(tokens, index, options, env, self);
        await files.write(staging + "/body.html", md.render(text));
      }
      const value: Resource = {
        id,
        sourceKey: key,
        type,
        title: name,
        sourceUri: info.uri,
        folderId: folder?.id,
        relativePath,
        localPath: final + "/" + document,
        size: await files.size(staging),
        status: warnings.length ? "ready_with_warnings" : "ready",
        lastOpenedAt: Date.now(),
        position: old?.position ?? {},
        warnings,
      };
      await files.write(staging + "/manifest.json", JSON.stringify(value));
      await files.move(staging, final);
      const result = await this.library.upsert(value);
      await this.library.finishJob(job);
      await files.remove("readers/" + id);
      if (old && old.localPath !== result.localPath)
        await files
          .remove(old.localPath.split("/").slice(0, -1).join("/"))
          .catch(() => {});
      return result;
    } catch (error) {
      if (!(await files.exists(final + "/manifest.json"))) {
        await files.remove(staging);
        await this.library.finishJob(job);
      }
      throw error;
    }
  }
}
