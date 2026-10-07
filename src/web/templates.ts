import type { Position } from "../core/types";
export const TEMPLATE_VERSION = "reader-1-mermaid-12.1";
const json = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
export const readerCSS = `:root{color-scheme:light dark;--bg:#faf9f6;--fg:#202c36;--muted:#576777;--border:#dadfdf}html.dark{--bg:#152029;--fg:#e8eef2;--muted:#b1bdc7;--border:#384954}html,body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif}body{line-height:1.7;font-size:17px;overflow-wrap:anywhere}#reader{padding:20px;max-width:820px;margin:auto}a{color:#357bba}img,video{max-width:100%;height:auto}pre{overflow-x:auto;padding:16px;background:color-mix(in srgb,var(--fg) 6%,var(--bg));border-radius:8px;font-size:14px}code{font-family:ui-monospace,monospace}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:8px;border:1px solid var(--border)}.mermaid{overflow:auto;margin:20px 0;cursor:pointer}.mermaid svg{display:block;width:100%;height:auto;max-width:100%!important}.diagram-error{color:var(--muted);padding:16px;border:1px dashed var(--border)}.diagram-stage{touch-action:none;overflow:hidden;height:calc(100dvh - 72px);padding:0!important;display:flex;align-items:center;justify-content:center}.diagram-stage svg{width:95%;height:auto;max-height:90%;transform-origin:center;flex-shrink:0}.diagram-controls{display:flex;gap:12px;justify-content:center;padding:8px}.diagram-controls button{min-width:48px;height:48px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--fg);font-size:16px}`;
export function readerDocument(
  options: {
    html?: string;
    head?: string;
    position?: Position;
    initialAnchor?: string;
    svgCache?: Record<string, string>;
    diagram?: string;
    dark?: boolean;
  },
  runtimeUri: string,
) {
  return `<!doctype html><html${options.dark ? ' class="dark"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=8,user-scalable=${options.diagram ? "no" : "yes"}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-rnread'; style-src 'self' 'unsafe-inline' file:; img-src 'self' file: data:; font-src 'self' file:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';"><style>${readerCSS}</style>${options.head ?? ""}</head><body><main id="reader"></main>${options.diagram ? '<div class="diagram-controls"><button id="minus" aria-label="缩小">−</button><button id="reset">重置</button><button id="plus" aria-label="放大">＋</button></div>' : ""}<script nonce="rnread">window.__RN_READ__=${json(options)};</script><script nonce="rnread" src="${runtimeUri}"></script></body></html>`;
}
