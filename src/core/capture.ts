import type { Capture } from "./types";

/**
 * 把 WebView 的分块消息组装为完整网页快照。
 * 一个接收器只接受指定 id 的一次捕获，避免旧页面或并发任务串入当前保存流程。
 */
export class CaptureReceiver {
  private metadata: Omit<Capture, "html"> | null = null;
  private chunks: string[] = [];
  private receivedLength = 0;
  private expectedLength = 0;
  constructor(
    private id: string,
    private max = 20 * 1024 * 1024,
  ) {}
  /** 中间消息返回 null；收到完整结束消息时才返回拼接后的快照。 */
  accept(message: unknown): Capture | null {
    if (!message || typeof message !== "object") return null;
    const payload = message as Record<string, unknown>;
    if (payload.id !== this.id) return null;
    if (payload.type === "CAPTURE_ERROR")
      throw Error(
        typeof payload.error === "string" ? payload.error : "网页捕获失败",
      );
    if (payload.type === "CAPTURE_START") {
      if (
        this.metadata ||
        !Number.isSafeInteger(payload.length) ||
        Number(payload.length) < 0 ||
        Number(payload.length) > this.max
      )
        throw Error("网页内容过大或捕获协议错误");
      if (
        typeof payload.url !== "string" ||
        typeof payload.title !== "string" ||
        !["snapshot", "reader"].includes(String(payload.mode))
      )
        throw Error("捕获元数据错误");
      const url = new URL(payload.url);
      if (!["https:", "http:"].includes(url.protocol))
        throw Error("只支持公开网页");
      let baseURI: string | undefined;
      if (payload.baseURI !== undefined) {
        if (typeof payload.baseURI !== "string")
          throw Error("网页基础地址错误");
        const base = new URL(payload.baseURI);
        if (!["https:", "http:"].includes(base.protocol))
          throw Error("网页基础地址只支持 HTTP(S)");
        baseURI = base.href;
      }
      this.expectedLength = Number(payload.length);
      this.metadata = {
        title: payload.title.slice(0, 1000),
        url: payload.url,
        ...(baseURI ? { baseURI } : {}),
        mode: payload.mode as Capture["mode"],
      };
    } else if (payload.type === "CAPTURE_CHUNK") {
      if (
        !this.metadata ||
        payload.index !== this.chunks.length ||
        typeof payload.data !== "string" ||
        payload.data.length > 128 * 1024
      )
        throw Error("网页分块顺序错误");
      this.receivedLength += payload.data.length;
      if (
        this.receivedLength > this.expectedLength ||
        this.receivedLength > this.max
      )
        throw Error("网页捕获超出限额");
      this.chunks.push(payload.data);
    } else if (payload.type === "CAPTURE_END") {
      if (!this.metadata || this.expectedLength !== this.receivedLength)
        throw Error("网页捕获不完整");
      const capture = { ...this.metadata, html: this.chunks.join("") };
      this.metadata = null;
      this.chunks = [];
      return capture;
    }
    return null;
  }
}
