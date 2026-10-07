import type { Position } from "../core/types";

/** 改动阅读页 HTML/CSS 或 Mermaid 版本后递增，使旧 reader 缓存失效。 */
export const TEMPLATE_VERSION = "reader-1-mermaid-12.1";

/** 阅读器文档禁止网络、表单和嵌入页面，只放行本地样式与 nonce 脚本。 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'nonce-rnread'",
  "style-src 'self' 'unsafe-inline' file:",
  "img-src 'self' file: data:",
  "font-src 'self' file:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** 把运行时配置嵌进 script 时转义可能结束标签或破坏 JS 字符串的字符。 */
const serializeForScript = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/** 离线正文、PDF 伴随页和 Mermaid 查看器共用的阅读样式。 */
export const readerCSS = `
:root {
  color-scheme: light dark;
  --bg: #faf9f6;
  --fg: #202c36;
  --muted: #576777;
  --border: #dadfdf;
}

html.dark {
  --bg: #152029;
  --fg: #e8eef2;
  --muted: #b1bdc7;
  --border: #384954;
}

html,
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}

body {
  line-height: 1.7;
  font-size: 17px;
  overflow-wrap: anywhere;
}

#reader {
  max-width: 820px;
  margin: auto;
  padding: 20px;
}

a {
  color: #357bba;
}

img,
video {
  max-width: 100%;
  height: auto;
}

pre {
  overflow-x: auto;
  padding: 16px;
  background: color-mix(in srgb, var(--fg) 6%, var(--bg));
  border-radius: 8px;
  font-size: 14px;
}

code {
  font-family: ui-monospace, monospace;
}

table {
  display: block;
  overflow: auto;
  border-collapse: collapse;
}

td,
th {
  padding: 8px;
  border: 1px solid var(--border);
}

.mermaid {
  overflow: auto;
  margin: 20px 0;
  cursor: pointer;
}

.mermaid svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100% !important;
}

.diagram-error {
  color: var(--muted);
  padding: 16px;
  border: 1px dashed var(--border);
}

.diagram-stage {
  touch-action: none;
  overflow: hidden;
  height: calc(100dvh - 72px);
  padding: 0 !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.diagram-stage svg {
  width: 95%;
  height: auto;
  max-height: 90%;
  transform-origin: center;
  flex-shrink: 0;
}

.diagram-controls {
  display: flex;
  gap: 12px;
  justify-content: center;
  padding: 8px;
}

.diagram-controls button {
  min-width: 48px;
  height: 48px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font-size: 16px;
}
`;

interface ReaderDocumentOptions {
  html?: string;
  head?: string;
  position?: Position;
  initialAnchor?: string;
  svgCache?: Record<string, string>;
  diagram?: string;
  dark?: boolean;
}

/**
 * 生成本地 WebView 文档并注入安全上下文策略。
 * 默认禁止网络、表单和 iframe；脚本只接受带固定 nonce 的本地 runtime。
 */
export function readerDocument(
  options: ReaderDocumentOptions,
  runtimeUri: string,
) {
  const pageClass = options.dark ? ' class="dark"' : "";
  const zoomSetting = options.diagram ? "no" : "yes";
  const diagramControls = options.diagram
    ? `
      <div class="diagram-controls">
        <button id="minus" aria-label="缩小">−</button>
        <button id="reset">重置</button>
        <button id="plus" aria-label="放大">＋</button>
      </div>
    `
    : "";

  return `<!doctype html>
<html${pageClass}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=8,user-scalable=${zoomSetting}">
    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
    <style>${readerCSS}</style>${options.head ?? ""}
  </head>
  <body>
    <main id="reader"></main>
    ${diagramControls}
    <script nonce="rnread">window.__RN_READ__=${serializeForScript(options)};</script>
    <script nonce="rnread" src="${runtimeUri}"></script>
  </body>
</html>`;
}
