export type ResourceType = "markdown" | "pdf" | "web";
/**
 * 资料的生命周期状态。
 * `ready_with_warnings` 表示正文可阅读，但部分图片或网页资源不可用。
 */
export type ResourceStatus =
  "saving" | "ready" | "ready_with_warnings" | "failed" | "deleting";

/** 不同阅读器共用的进度格式；每类文档只会使用其中相关字段。 */
export interface Position {
  version?: number;
  anchor?: string;
  offset?: number;
  progress?: number;
  scrollY?: number;
  page?: number;
  scale?: number;
}

/** 资料库中的记录；正文文件保存在应用沙盒，由 `localPath` 指向。 */
export interface Resource {
  id: string;
  sourceKey: string;
  type: ResourceType;
  title: string;
  sourceUri?: string;
  folderId?: string;
  relativePath?: string;
  localPath: string;
  size: number;
  status: ResourceStatus;
  lastOpenedAt: number;
  position: Position;
  warnings: string[];
  mode?: "snapshot" | "reader";
}

/** 用户授权的外部目录，以及上次浏览的位置。bookmark 用于续期系统权限。 */
export interface Folder {
  id: string;
  name: string;
  uri: string;
  bookmark?: string;
  lastPath: string;
  lastOpenedAt: number;
}

/** 浏览器收藏的网页地址与显示标题；页面正文仍可按需单独保存为离线副本。 */
export interface Bookmark {
  url: string;
  title: string;
  createdAt: number;
}

/** WebView 发送给原生端的一份网页快照。HTML 由单独的分块消息传输。 */
export interface Capture {
  html: string;
  url: string;
  baseURI?: string;
  title: string;
  mode: "snapshot" | "reader";
}
