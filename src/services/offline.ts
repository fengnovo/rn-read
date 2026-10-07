import * as Crypto from "expo-crypto";
import BlobUtil, {
  type FetchBlobResponse,
  type StatefulPromise,
} from "react-native-blob-util";
import { Library } from "../database/library";
import type { Capture, Resource } from "../core/types";
import { rewritePage, type DownloadedAsset } from "../core/offline";
import * as files from "../storage/files";
import { readerDocument } from "../web/templates";

// 网页正文与它引用的资源共享总容量上限，防止一次保存耗尽手机空间。
const MAX_OFFLINE_BYTES = 100 * 1024 * 1024;
const extensionByMimeType: Record<string, string> = {
  "text/css": "css",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-icon": "ico",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "application/font-woff": "woff",
  "application/vnd.ms-fontobject": "eot",
  "application/octet-stream": "bin",
};
function createNamedError(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}
const createAbortError = () => createNamedError("AbortError", "保存已取消");
const createSizeLimitError = () =>
  createNamedError("SaveLimitError", "页面超过 100 MiB，保存已停止");

/** 捕获网页、下载静态资源并以可恢复的方式写入本地资料库。 */
export class OfflinePages {
  private isSaving = false;
  constructor(private library: Library) {}

  /**
   * 保存一份离线网页。signal 可取消本次保存，onProgress 接收给界面显示的状态文字。
   * 内容先写入 staging；只有完整文件和 manifest 就绪后才移动到正式目录并更新数据库。
   */
  async save(
    capture: Capture,
    onProgress?: (label: string) => void,
    signal?: AbortSignal,
  ): Promise<Resource> {
    if (this.isSaving) throw Error("已有网页正在保存");
    if (signal?.aborted) throw createAbortError();
    if (capture.html.length > 20 * 1024 * 1024)
      throw Error("网页内容超过 20 MiB");
    const parsed = new URL(capture.url);
    if (!/^https?:$/.test(parsed.protocol))
      throw Error("仅支持保存 HTTP(S) 网页");
    const baseURI = capture.baseURI ?? capture.url;
    if (
      typeof baseURI !== "string" ||
      !/^https?:$/.test(new URL(baseURI).protocol)
    )
      throw Error("网页基础地址只支持 HTTP(S)");
    this.isSaving = true;

    // 最多同时下载 4 个资源。取消或超额时，立即停止活动请求并唤醒排队任务退出。
    const activeRequests = new Set<StatefulPromise<FetchBlobResponse>>();
    const waitingForDownloadSlot: Array<() => void> = [];
    let activeDownloadCount = 0,
      completedAssetBytes = 0,
      stopError: Error | undefined,
      recoveryJobRecorded = false;
    const inFlightBytesByUrl = new Map<string, number>();
    const pendingDownloads = new Set<Promise<DownloadedAsset>>();
    const stopSaving = (error: Error) => {
      stopError ??= error;
      for (const request of activeRequests) request.cancel();
      for (const resume of waitingForDownloadSlot.splice(0)) resume();
    };
    const handleAbort = () => stopSaving(createAbortError());
    signal?.addEventListener("abort", handleAbort);
    const throwIfStopped = () => {
      if (signal?.aborted) throw createAbortError();
      if (stopError) throw stopError;
    };
    const acquireDownloadSlot = async () => {
      throwIfStopped();
      if (activeDownloadCount >= 4)
        await new Promise<void>((resume) =>
          waitingForDownloadSlot.push(resume),
        );
      throwIfStopped();
      activeDownloadCount++;
    };
    const releaseDownloadSlot = () => {
      activeDownloadCount--;
      waitingForDownloadSlot.shift()?.();
    };
    const jobId = Crypto.randomUUID();
    const stagingDirectory = "staging/" + jobId;
    const finalDirectory = "offline/" + jobId;
    try {
      const sourceKey = "web:" + capture.mode + ":" + capture.url;
      const existingResource = await this.library.bySource(sourceKey);
      const resourceId = existingResource?.id ?? Crypto.randomUUID();
      throwIfStopped();
      await this.library.startJob(
        jobId,
        resourceId,
        stagingDirectory,
        finalDirectory,
      );
      recoveryJobRecorded = true;
      await files.mkdir(stagingDirectory + "/assets");
      throwIfStopped();

      const downloadAsset = async (
        address: string,
      ): Promise<DownloadedAsset> => {
        await acquireDownloadSlot();
        let request: StatefulPromise<FetchBlobResponse> | undefined;
        let temporaryAssetPath: string | undefined;
        try {
          throwIfStopped();
          const assetHash = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            address,
          );
          throwIfStopped();
          // 原生层直接把响应写入文件，图片和字体等二进制内容不会复制进 JS 内存。
          temporaryAssetPath =
            stagingDirectory + "/assets/" + assetHash + ".download";
          request = BlobUtil.config({
            path: decodeURIComponent(
              files.uri(temporaryAssetPath).replace(/^file:\/\//, ""),
            ),
            timeout: 20_000,
            followRedirect: true,
          }).fetch("GET", address, {
            Accept: "text/css,image/*,font/*,application/font-woff,*/*;q=0.5",
          });
          activeRequests.add(request);
          const pendingRequest = request;
          request.progress({ interval: 100 }, (receivedBytes, totalBytes) => {
            inFlightBytesByUrl.set(address, Number(receivedBytes));
            const inFlightBytes = [...inFlightBytesByUrl.values()].reduce(
              (sum, byteCount) => sum + byteCount,
              0,
            );
            if (
              Number(totalBytes) > MAX_OFFLINE_BYTES ||
              completedAssetBytes + inFlightBytes > MAX_OFFLINE_BYTES
            )
              stopSaving(createSizeLimitError());
            onProgress?.(
              "下载资源 " +
                Math.round((completedAssetBytes + inFlightBytes) / 1024) +
                " KiB",
            );
          });
          const response = await pendingRequest;
          throwIfStopped();
          const responseInfo = response.respInfo;
          if (
            responseInfo.timeout ||
            responseInfo.status < 200 ||
            responseInfo.status >= 300
          )
            throw Error("资源 HTTP " + responseInfo.status);
          const responseHeaders = Object.fromEntries(
            Object.entries(responseInfo.headers ?? {}).map(
              ([headerName, headerValue]) => [
                headerName.toLowerCase(),
                String(headerValue),
              ],
            ),
          );
          const mimeType = (responseHeaders["content-type"] ?? "")
            .split(";")[0]!
            .trim()
            .toLowerCase();
          if (!extensionByMimeType[mimeType])
            throw Error("不支持的资源类型：" + mimeType);
          const assetBytes = await files.size(temporaryAssetPath);
          inFlightBytesByUrl.delete(address);
          completedAssetBytes += assetBytes;
          const inFlightBytes = [...inFlightBytesByUrl.values()].reduce(
            (sum, byteCount) => sum + byteCount,
            0,
          );
          if (
            assetBytes > MAX_OFFLINE_BYTES ||
            completedAssetBytes + inFlightBytes > MAX_OFFLINE_BYTES
          ) {
            stopSaving(createSizeLimitError());
            throw stopError;
          }
          const assetPath =
            "assets/" + assetHash + "." + extensionByMimeType[mimeType];
          await files.move(
            temporaryAssetPath,
            stagingDirectory + "/" + assetPath,
          );
          temporaryAssetPath = stagingDirectory + "/" + assetPath;
          const finalUrl =
            responseInfo.redirects?.[responseInfo.redirects.length - 1] ??
            address;
          if (!/^https?:$/.test(new URL(finalUrl).protocol))
            throw Error("不支持的重定向");
          // 只有 CSS 需要进入 JS 做语法树改写；限制大小以免大样式占满内存。
          if (mimeType === "text/css" && assetBytes > 20 * 1024 * 1024)
            throw Error("样式文件超过 20 MiB");
          const cssText =
            mimeType === "text/css" ? await files.read(temporaryAssetPath) : "";
          temporaryAssetPath = undefined;
          return {
            localPath: assetPath,
            finalUrl,
            mime: mimeType,
            text: cssText,
          };
        } catch (error) {
          if (stopError) throw stopError;
          throw error;
        } finally {
          if (request) activeRequests.delete(request);
          inFlightBytesByUrl.delete(address);
          if (temporaryAssetPath)
            await files.remove(temporaryAssetPath).catch(() => {});
          releaseDownloadSlot();
        }
      };
      const downloadAssetOnce = async (address: string) => {
        const task = downloadAsset(address);
        pendingDownloads.add(task);
        try {
          return await task;
        } finally {
          pendingDownloads.delete(task);
        }
      };

      onProgress?.("整理网页资源");
      const rewrittenPage = await rewritePage(
        capture.html,
        baseURI,
        downloadAssetOnce,
        (assetPath, cssText) =>
          files.write(stagingDirectory + "/" + assetPath, cssText),
      );
      throwIfStopped();
      await files.write(
        stagingDirectory + "/content.json",
        JSON.stringify({
          html: rewrittenPage.html,
          head: rewrittenPage.head,
        }),
      );
      await files.write(
        stagingDirectory + "/index.html",
        readerDocument(
          {
            html: rewrittenPage.html,
            head: rewrittenPage.head,
            position: existingResource?.position,
          },
          "../../runtime/runtime.js",
        ),
      );
      const stagedSizeBytes = await files.size(stagingDirectory);
      if (stagedSizeBytes > MAX_OFFLINE_BYTES) throw createSizeLimitError();
      const resource: Resource = {
        id: resourceId,
        sourceKey,
        type: "web",
        title: capture.title || capture.url,
        sourceUri: capture.url,
        localPath: finalDirectory + "/index.html",
        size: stagedSizeBytes,
        status: rewrittenPage.warnings.length ? "ready_with_warnings" : "ready",
        lastOpenedAt: Date.now(),
        position: existingResource?.position ?? {},
        warnings: rewrittenPage.warnings,
        mode: capture.mode,
      };
      // 把 manifest 和资源放在同一目录，应用意外退出后可据此恢复数据库记录。
      await files.write(
        stagingDirectory + "/manifest.json",
        JSON.stringify(resource),
      );
      resource.size = await files.size(stagingDirectory);
      if (resource.size > MAX_OFFLINE_BYTES) throw createSizeLimitError();
      await files.write(
        stagingDirectory + "/manifest.json",
        JSON.stringify(resource),
      );
      throwIfStopped();
      onProgress?.("保存离线副本");
      await files.move(stagingDirectory, finalDirectory);
      // 原子移动完成后保留恢复任务；若 SQLite 写入失败，下次启动会从 manifest 补回记录。
      const savedResource = await this.library.upsert(resource);
      await this.library.finishJob(jobId);
      recoveryJobRecorded = false;
      await files.remove("readers/" + resourceId).catch(() => {});
      if (
        existingResource &&
        existingResource.localPath !== savedResource.localPath
      )
        await files
          .remove(existingResource.localPath.split("/").slice(0, -1).join("/"))
          .catch(() => {});
      onProgress?.("保存完成");
      return savedResource;
    } catch (error) {
      stopSaving(error instanceof Error ? error : Error("保存失败"));
      await Promise.allSettled([...pendingDownloads]);
      if (!(await files.exists(finalDirectory + "/manifest.json"))) {
        await files.remove(stagingDirectory);
        if (recoveryJobRecorded) await this.library.finishJob(jobId);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", handleAbort);
      this.isSaving = false;
    }
  }
}
