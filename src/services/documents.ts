import {
  pick,
  pickDirectory,
  types,
  isErrorWithCode,
  errorCodes,
} from "@react-native-documents/picker";
import { Platform } from "react-native";
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

/** 让系统选择器优先只显示项目可以直接导入的文件类型。 */
function pickerTypesForMarkdown() {
  return Platform.OS === "ios"
    ? [types.plainText, "net.daringfireball.markdown"]
    : [types.plainText, "text/markdown", "application/x-markdown"];
}

/** 管理外部文件与目录授权，并把可读资料复制到应用沙盒。 */
export class Documents {
  constructor(private library: Library) {}

  /** 从系统文件选择器中选择 Markdown / TXT，并导入本地副本。 */
  async chooseMarkdownFile() {
    return this.chooseFile(
      pickerTypesForMarkdown(),
      /\.(md|markdown|txt)$/i,
      "请选择 Markdown 或 TXT 文件",
    );
  }

  /** 从系统文件选择器中只选择 PDF，并导入本地副本。 */
  async choosePdfFile() {
    return this.chooseFile([types.pdf], /\.pdf$/i, "请选择 PDF 文件");
  }

  /** 系统选择器类型作为筛选；再校验扩展名，兼顾忽略筛选条件的文件提供方。 */
  private async chooseFile(
    allowedTypes: string[],
    allowedExtension: RegExp,
    errorMessage: string,
  ) {
    const [selection] = await pick({
      mode: "open",
      requestLongTermAccess: true,
      type: allowedTypes,
    });
    const fileName = selection.name ?? "文档";
    if (!allowedExtension.test(fileName)) throw Error(errorMessage);
    return this.importFile(
      selection.uri,
      fileName,
      undefined,
      undefined,
      "bookmark" in selection ? selection.bookmark : undefined,
    );
  }

  /** 选择或替换一个长期授权目录，并尽量沿用原目录记录与上次浏览路径。 */
  async chooseFolder(replacingId?: string) {
    const result = await pickDirectory({ requestLongTermAccess: true });
    if (result.bookmarkStatus === "error")
      throw Error("无法保存目录权限：" + result.bookmarkError);
    const folders = await this.library.folders();
    const existing = folders.find((folder) => folder.uri === result.uri);
    const replacing = folders.find((folder) => folder.id === replacingId);
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
    // iOS 安全书签可能在系统续期后返回新的 URI/bookmark，需要及时回写数据库。
    if (result.rootUri) folder.uri = result.rootUri;
    if (result.bookmark) folder.bookmark = result.bookmark;
    await this.library.saveFolder(folder);
  }

  /** 列出授权目录的一个子路径，并把目录访问权限续期后的信息保存起来。 */
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

  /** 打开目录中的关联文件；path 始终是相对于已授权目录的路径。 */
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

  /**
   * 导入 Markdown/TXT/PDF 并生成本地阅读副本。
   * Markdown 的相对图片只有在用户授权了父目录时才能一起复制；缺失资源会记录警告。
   */
  async importFile(
    sourceUri: string,
    fileName: string,
    folder?: Folder,
    relativePath?: string,
    bookmark?: string,
  ) {
    const documentType = /\.(md|markdown|txt)$/i.test(fileName)
      ? "markdown"
      : /\.pdf$/i.test(fileName)
        ? "pdf"
        : null;
    if (!documentType)
      throw Error("请选择 Markdown（.md/.markdown/.txt）或 PDF 文件");
    const sourceIdentity = await identity(
      sourceUri,
      folder?.bookmark ?? bookmark,
    );
    if (folder) await this.renew(folder, sourceIdentity);
    const sourceKey = "file:" + sourceIdentity.identity;
    const existingResource = await this.library.bySource(sourceKey);
    const resourceId = existingResource?.id ?? Crypto.randomUUID();
    const jobId = Crypto.randomUUID();
    const stagingDirectory = "staging/" + jobId;
    const finalDirectory = "imported/" + jobId;
    await files.mkdir(stagingDirectory + "/assets");
    await this.library.startJob(
      jobId,
      resourceId,
      stagingDirectory,
      finalDirectory,
    );
    const localDocumentName =
      "document." + (documentType === "pdf" ? "pdf" : "md");
    const warnings: string[] = [];
    try {
      await copyToLocal(
        sourceIdentity.uri,
        files.uri(stagingDirectory + "/" + localDocumentName),
        folder?.bookmark ?? bookmark,
      );
      if (documentType === "markdown") {
        if (
          (await files.size(stagingDirectory + "/" + localDocumentName)) >
          20 * 1024 * 1024
        )
          throw Error("Markdown 超过20 MiB，无法打开");
        const markdownText = await files.read(
          stagingDirectory + "/" + localDocumentName,
        );
        if (markdownText.length > 20 * 1024 * 1024)
          throw Error("Markdown 超过20 MiB，无法打开");
        const markdown = createMarkdown();
        const tokens = markdown.parse(markdownText, {});
        const localImageBySource = new Map<string, string>();
        const images = tokens
          .flatMap((t) => t.children ?? [])
          .filter((t) => t.type === "image");
        // 先收集并复制引用图片，渲染时再把原始地址替换为沙盒内的相对路径。
        for (const imageToken of images) {
          const sourceImageUrl = String(imageToken.attrGet("src") ?? "");
          if (localImageBySource.has(sourceImageUrl)) continue;
          if (sourceImageUrl.startsWith("data:image/")) {
            localImageBySource.set(sourceImageUrl, sourceImageUrl);
            continue;
          }
          if (
            !folder ||
            !relativePath ||
            /^(https?:|\/\/)/i.test(sourceImageUrl)
          ) {
            warnings.push("图片未保存：" + sourceImageUrl);
            localImageBySource.set(sourceImageUrl, "");
            continue;
          }
          try {
            const relativeImagePath = resolveRelativePath(
              relativePath,
              sourceImageUrl,
            );
            const imageIdentity = await resolveRelative(
              folder.uri,
              relativeImagePath,
              folder.bookmark,
            );
            await this.renew(folder, imageIdentity);
            const imageExtension =
              /\.(png|jpg|jpeg|gif|webp|svg|avif|bmp)$/i.exec(
                relativeImagePath,
              )?.[1] ?? "img";
            const localImagePath =
              "assets/" +
              (await hash(relativeImagePath)) +
              "." +
              imageExtension;
            await copyToLocal(
              imageIdentity.uri,
              files.uri(stagingDirectory + "/" + localImagePath),
              folder.bookmark,
            );
            localImageBySource.set(
              sourceImageUrl,
              "../../" + finalDirectory + "/" + localImagePath,
            );
          } catch {
            warnings.push("图片不可读取：" + sourceImageUrl);
            localImageBySource.set(sourceImageUrl, "");
          }
        }
        const defaultImageRenderer = markdown.renderer.rules.image!;
        markdown.renderer.rules.image = (
          renderTokens,
          tokenIndex,
          renderOptions,
          renderEnv,
          renderer,
        ) => {
          const imageToken = renderTokens[tokenIndex]!;
          const sourceImageUrl = String(imageToken.attrGet("src") ?? "");
          imageToken.attrSet(
            "src",
            localImageBySource.get(sourceImageUrl) ?? "",
          );
          if (!imageToken.attrGet("src"))
            imageToken.attrSet("alt", "图片未保存离线");
          return defaultImageRenderer(
            renderTokens,
            tokenIndex,
            renderOptions,
            renderEnv,
            renderer,
          );
        };
        const defaultFenceRenderer = markdown.renderer.rules.fence!;
        let diagramIndex = 0;
        markdown.renderer.rules.fence = (
          renderTokens,
          tokenIndex,
          renderOptions,
          renderEnv,
          renderer,
        ) =>
          renderTokens[tokenIndex]!.info.trim() === "mermaid"
            ? `<div class="mermaid" data-svg-key="${diagramIndex++}">${markdown.utils.escapeHtml(renderTokens[tokenIndex]!.content)}</div>`
            : defaultFenceRenderer(
                renderTokens,
                tokenIndex,
                renderOptions,
                renderEnv,
                renderer,
              );
        await files.write(
          stagingDirectory + "/body.html",
          markdown.render(markdownText),
        );
      }
      const resource: Resource = {
        id: resourceId,
        sourceKey,
        type: documentType,
        title: fileName,
        sourceUri: sourceIdentity.uri,
        folderId: folder?.id,
        relativePath,
        localPath: finalDirectory + "/" + localDocumentName,
        size: await files.size(stagingDirectory),
        status: warnings.length ? "ready_with_warnings" : "ready",
        lastOpenedAt: Date.now(),
        position: existingResource?.position ?? {},
        warnings,
      };
      await files.write(
        stagingDirectory + "/manifest.json",
        JSON.stringify(resource),
      );
      await files.move(stagingDirectory, finalDirectory);
      const importedResource = await this.library.upsert(resource);
      await this.library.finishJob(jobId);
      await files.remove("readers/" + resourceId);
      if (
        existingResource &&
        existingResource.localPath !== importedResource.localPath
      )
        await files
          .remove(existingResource.localPath.split("/").slice(0, -1).join("/"))
          .catch(() => {});
      return importedResource;
    } catch (error) {
      if (!(await files.exists(finalDirectory + "/manifest.json"))) {
        await files.remove(stagingDirectory);
        await this.library.finishJob(jobId);
      }
      throw error;
    }
  }
}
