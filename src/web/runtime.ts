import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { headingId } from "../core/headings";

const cfg = window.__RN_READ__ ?? {};
history.scrollRestoration = "manual";
const send = (message: object) =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
const cleanSVG = (svg: string) =>
  DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
window.RNRead = {
  flush: () => {},
  setTheme: (dark: boolean) =>
    document.documentElement.classList.toggle("dark", dark),
};
if (cfg.diagram) {
  const stage = document.getElementById("reader")!;
  stage.innerHTML = cleanSVG(cfg.diagram);
  const svg = stage.querySelector("svg")!;
  stage.className = "diagram-stage";
  let scale = 1,
    x = 0,
    y = 0,
    start: null | {
      distance: number;
      scale: number;
      x: number;
      y: number;
      cx: number;
      cy: number;
    } = null;
  const apply = () => {
    svg.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  };
  const reset = () => {
    scale = 1;
    x = 0;
    y = 0;
    apply();
  };
  document.getElementById("reset")?.addEventListener("click", reset);
  document.getElementById("plus")?.addEventListener("click", () => {
    scale = Math.min(12, scale * 1.3);
    apply();
  });
  document.getElementById("minus")?.addEventListener("click", () => {
    scale = Math.max(0.3, scale / 1.3);
    apply();
  });
  stage.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const a = e.touches[0],
        b = e.touches[1];
      if (!a) return;
      start = {
        distance: b
          ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
          : 0,
        scale,
        x,
        y,
        cx: b ? (a.clientX + b.clientX) / 2 : a.clientX,
        cy: b ? (a.clientY + b.clientY) / 2 : a.clientY,
      };
    },
    { passive: false },
  );
  stage.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (!start) return;
      const a = e.touches[0],
        b = e.touches[1];
      if (!a) return;
      if (b && start.distance) {
        scale = Math.max(
          0.3,
          Math.min(
            12,
            (start.scale *
              Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) /
              start.distance,
          ),
        );
        x = start.x + (a.clientX + b.clientX) / 2 - start.cx;
        y = start.y + (a.clientY + b.clientY) / 2 - start.cy;
      } else if (!b && !start.distance) {
        x = start.x + a.clientX - start.cx;
        y = start.y + a.clientY - start.cy;
      }
      apply();
    },
    { passive: false },
  );
  stage.addEventListener("touchend", () => {
    start = null;
  });
  send({ type: "READY" });
} else {
  const root = document.getElementById("reader")!;
  root.innerHTML = DOMPurify.sanitize(cfg.html ?? "", {
    ADD_ATTR: ["data-link", "data-svg-key"],
    FORBID_TAGS: ["iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcset"],
  });
  root.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (/^(https?:|\/\/)/i.test(src)) {
      img.removeAttribute("src");
      img.setAttribute("alt", "图片未保存离线");
    }
  });
  const usedIds = new Set(
    Array.from(root.querySelectorAll("[id]"), (el) => el.id),
  );
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
    if (!el.id) el.id = headingId(el.textContent ?? "", usedIds);
  });
  root
    .querySelectorAll("h1,h2,h3,h4,h5,h6,p,pre,table,blockquote")
    .forEach((el, i) => {
      if (!el.id) el.id = "read-" + i;
    });
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: cfg.dark ? "dark" : "default",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: 100000,
    maxEdges: 1000,
    secure: [
      "secure",
      "securityLevel",
      "startOnLoad",
      "maxTextSize",
      "maxEdges",
      "themeCSS",
      "fontFamily",
      "htmlLabels",
    ],
  });
  let ready = false;
  const flush = () => {
    if (!ready) return;
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight,
    );
    let anchor: Element | undefined;
    for (const el of root.querySelectorAll("[id]")) {
      if (el.getBoundingClientRect().top <= 16) anchor = el;
      else break;
    }
    send({
      type: "POSITION",
      position: {
        version: 1,
        scrollY,
        progress: max ? Math.min(1, scrollY / max) : 0,
        anchor: anchor?.id,
        offset: anchor ? -anchor.getBoundingClientRect().top : 0,
      },
    });
  };
  window.RNRead.flush = flush;
  let timer: number | undefined;
  addEventListener("scroll", () => {
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  });
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  root.addEventListener("click", (e) => {
    const element = e.target instanceof Element ? e.target : null;
    const diagram = element?.closest(".mermaid")?.querySelector("svg");
    if (diagram) {
      e.preventDefault();
      send({ type: "DIAGRAM", svg: cleanSVG(diagram.outerHTML) });
      return;
    }
    const a = element?.closest("a");
    if (!a) return;
    e.preventDefault();
    const url = a.getAttribute("href") ?? "";
    if (url.startsWith("#")) {
      try {
        document
          .getElementById(decodeURIComponent(url.slice(1)))
          ?.scrollIntoView();
      } catch {}
      return;
    }
    send({ type: "OPEN_LINK", url });
  });
  void (async () => {
    const cache: Record<string, string> = {};
    const blocks = Array.from(root.querySelectorAll(".mermaid"));
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      const key = block.getAttribute("data-svg-key") ?? String(i);
      try {
        let svg = cfg.svgCache?.[key];
        if (!svg) {
          const result = await mermaid.render(
            "diagram-" + i,
            block.textContent ?? "",
          );
          svg = result.svg;
        }
        const clean = cleanSVG(svg);
        block.innerHTML = clean;
        cache[key] = clean;
        block.setAttribute("role", "button");
        block.setAttribute("tabindex", "0");
        block.setAttribute("aria-label", "放大查看图表");
        block.addEventListener("keydown", (e) => {
          if (
            e instanceof KeyboardEvent &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            send({ type: "DIAGRAM", svg: clean });
          }
        });
      } catch {
        block.classList.add("diagram-error");
        block.textContent = "图表语法错误，正文仍可阅读。";
        document.getElementById("ddiagram-" + i)?.remove();
      }
    }
    if (Object.keys(cache).length) send({ type: "SVG_CACHE", cache });
    await Promise.race([
      Promise.all(
        [...root.querySelectorAll("img")].map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.addEventListener("load", resolve, { once: true });
                img.addEventListener("error", resolve, { once: true });
              }),
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    await document.fonts?.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const p = cfg.position ?? {};
    const initial = cfg.initialAnchor
      ? document.getElementById(cfg.initialAnchor)
      : null;
    const anchor =
      initial ?? (p.anchor ? document.getElementById(p.anchor) : null);
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight,
    );
    const y = anchor
      ? anchor.getBoundingClientRect().top +
        scrollY +
        (initial ? 0 : (p.offset ?? 0))
      : Number.isFinite(p.progress)
        ? max * p.progress
        : (p.scrollY ?? 0);
    scrollTo(0, Math.max(0, Math.min(max, y)));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    ready = true;
    send({ type: "READY" });
  })().catch((error) => send({ type: "ERROR", error: String(error) }));
}
