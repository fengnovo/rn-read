import type { Position } from "../core/types";

/** 原生端在加载 WebView 阅读器脚本前注入的页面数据与恢复位置。 */
interface ReaderOptions {
  html?: string;
  head?: string;
  position?: Position;
  initialAnchor?: string;
  svgCache?: Record<string, string>;
  diagram?: string;
  dark?: boolean;
}

export {};

/** WebView 页面与 React Native 宿主之间共享的消息和控制接口。 */
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    RNReadCapture?: (id: string, mode: "reader" | "snapshot") => Promise<void>;
    __RN_READ__?: ReaderOptions;
    RNRead?: { flush: () => void; setTheme: (dark: boolean) => void };
  }
}
