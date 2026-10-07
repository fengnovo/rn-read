import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { headingId } from "../core/headings";

// 原生端在加载本文件前注入文档内容、主题、缓存图表和阅读位置。
const readerOptions = window.__RN_READ__ ?? {};
history.scrollRestoration = "manual";
const sendToNative = (message: object) =>
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
const sanitizeSvg = (svg: string) =>
  DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
window.RNRead = {
  flush: () => {},
  setTheme: (dark: boolean) =>
    document.documentElement.classList.toggle("dark", dark),
};
if (readerOptions.diagram) {
  const diagramStage = document.getElementById("reader")!;
  diagramStage.innerHTML = sanitizeSvg(readerOptions.diagram);
  const diagramSvg = diagramStage.querySelector("svg")!;
  diagramStage.className = "diagram-stage";
  let scale = 1,
    translateX = 0,
    translateY = 0,
    gestureStart: null | {
      distance: number;
      scale: number;
      translateX: number;
      translateY: number;
      centerX: number;
      centerY: number;
    } = null;
  const apply = () => {
    diagramSvg.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`;
  };
  const reset = () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
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
  // 双指按两指间距缩放，并以手指中心点为锚；单指拖动只调整平移量。
  diagramStage.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      if (!firstTouch) return;
      gestureStart = {
        distance: secondTouch
          ? Math.hypot(
              firstTouch.clientX - secondTouch.clientX,
              firstTouch.clientY - secondTouch.clientY,
            )
          : 0,
        scale,
        translateX,
        translateY,
        centerX: secondTouch
          ? (firstTouch.clientX + secondTouch.clientX) / 2
          : firstTouch.clientX,
        centerY: secondTouch
          ? (firstTouch.clientY + secondTouch.clientY) / 2
          : firstTouch.clientY,
      };
    },
    { passive: false },
  );
  diagramStage.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      if (!gestureStart) return;
      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      if (!firstTouch) return;
      if (secondTouch && gestureStart.distance) {
        scale = Math.max(
          0.3,
          Math.min(
            12,
            (gestureStart.scale *
              Math.hypot(
                firstTouch.clientX - secondTouch.clientX,
                firstTouch.clientY - secondTouch.clientY,
              )) /
              gestureStart.distance,
          ),
        );
        translateX =
          gestureStart.translateX +
          (firstTouch.clientX + secondTouch.clientX) / 2 -
          gestureStart.centerX;
        translateY =
          gestureStart.translateY +
          (firstTouch.clientY + secondTouch.clientY) / 2 -
          gestureStart.centerY;
      } else if (!secondTouch && !gestureStart.distance) {
        translateX =
          gestureStart.translateX + firstTouch.clientX - gestureStart.centerX;
        translateY =
          gestureStart.translateY + firstTouch.clientY - gestureStart.centerY;
      }
      apply();
    },
    { passive: false },
  );
  diagramStage.addEventListener("touchend", () => {
    gestureStart = null;
  });
  sendToNative({ type: "READY" });
} else {
  const readerRoot = document.getElementById("reader")!;
  // 阅读正文再次经过白名单消毒；保存时的净化不能替代展示前的安全边界。
  readerRoot.innerHTML = DOMPurify.sanitize(readerOptions.html ?? "", {
    ADD_ATTR: ["data-link", "data-svg-key"],
    FORBID_TAGS: ["iframe", "object", "embed", "form"],
    FORBID_ATTR: ["srcset"],
  });
  readerRoot.querySelectorAll("img[src]").forEach((image) => {
    const imageSource = image.getAttribute("src") ?? "";
    if (/^(https?:|\/\/)/i.test(imageSource)) {
      // 离线阅读不偷偷访问网络；未保存的远程图片明确显示为缺失资源。
      image.removeAttribute("src");
      image.setAttribute("alt", "图片未保存离线");
    }
  });
  const usedIds = new Set(
    Array.from(readerRoot.querySelectorAll("[id]"), (element) => element.id),
  );
  readerRoot.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
    if (!heading.id) heading.id = headingId(heading.textContent ?? "", usedIds);
  });
  readerRoot
    .querySelectorAll("h1,h2,h3,h4,h5,h6,p,pre,table,blockquote")
    .forEach((element, index) => {
      if (!element.id) element.id = "read-" + index;
    });
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: readerOptions.dark ? "dark" : "default",
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
  let contentLayoutReady = false;
  const flush = () => {
    if (!contentLayoutReady) return;
    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight,
    );
    let anchor: Element | undefined;
    for (const element of readerRoot.querySelectorAll("[id]")) {
      if (element.getBoundingClientRect().top <= 16) anchor = element;
      else break;
    }
    sendToNative({
      type: "POSITION",
      position: {
        version: 1,
        scrollY,
        progress: maxScrollY ? Math.min(1, scrollY / maxScrollY) : 0,
        anchor: anchor?.id,
        offset: anchor ? -anchor.getBoundingClientRect().top : 0,
      },
    });
  };
  window.RNRead.flush = flush;
  let timer: number | undefined;
  addEventListener("scroll", () => {
    if (!contentLayoutReady) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  });
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  readerRoot.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const diagram = element?.closest(".mermaid")?.querySelector("svg");
    if (diagram) {
      event.preventDefault();
      sendToNative({ type: "DIAGRAM", svg: sanitizeSvg(diagram.outerHTML) });
      return;
    }
    const link = element?.closest("a");
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute("href") ?? "";
    if (url.startsWith("#")) {
      try {
        document
          .getElementById(decodeURIComponent(url.slice(1)))
          ?.scrollIntoView();
      } catch {}
      return;
    }
    sendToNative({ type: "OPEN_LINK", url });
  });
  void (async () => {
    const cache: Record<string, string> = {};
    const diagramBlocks = Array.from(readerRoot.querySelectorAll(".mermaid"));
    for (
      let diagramIndex = 0;
      diagramIndex < diagramBlocks.length;
      diagramIndex++
    ) {
      const block = diagramBlocks[diagramIndex]!;
      const cacheKey =
        block.getAttribute("data-svg-key") ?? String(diagramIndex);
      try {
        let diagramSvg = readerOptions.svgCache?.[cacheKey];
        if (!diagramSvg) {
          const result = await mermaid.render(
            "diagram-" + diagramIndex,
            block.textContent ?? "",
          );
          diagramSvg = result.svg;
        }
        const sanitizedSvg = sanitizeSvg(diagramSvg);
        block.innerHTML = sanitizedSvg;
        cache[cacheKey] = sanitizedSvg;
        block.setAttribute("role", "button");
        block.setAttribute("tabindex", "0");
        block.setAttribute("aria-label", "放大查看图表");
        block.addEventListener("keydown", (event) => {
          if (
            event instanceof KeyboardEvent &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            sendToNative({ type: "DIAGRAM", svg: sanitizedSvg });
          }
        });
      } catch {
        block.classList.add("diagram-error");
        block.textContent = "图表语法错误，正文仍可阅读。";
        document.getElementById("ddiagram-" + diagramIndex)?.remove();
      }
    }
    if (Object.keys(cache).length) sendToNative({ type: "SVG_CACHE", cache });
    await Promise.race([
      Promise.all(
        [...readerRoot.querySelectorAll("img")].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }),
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    await document.fonts?.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    // 图片和字体会改变段落高度；等布局稳定后恢复位置，避免跳到错误段落。
    const savedPosition = readerOptions.position ?? {};
    const initialAnchor = readerOptions.initialAnchor
      ? document.getElementById(readerOptions.initialAnchor)
      : null;
    const anchor =
      initialAnchor ??
      (savedPosition.anchor
        ? document.getElementById(savedPosition.anchor)
        : null);
    const maxScrollY = Math.max(
      0,
      document.documentElement.scrollHeight - innerHeight,
    );
    const restoredScrollY = anchor
      ? anchor.getBoundingClientRect().top +
        scrollY +
        (initialAnchor ? 0 : (savedPosition.offset ?? 0))
      : typeof savedPosition.progress === "number" &&
          Number.isFinite(savedPosition.progress)
        ? maxScrollY * savedPosition.progress
        : (savedPosition.scrollY ?? 0);
    scrollTo(0, Math.max(0, Math.min(maxScrollY, restoredScrollY)));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    contentLayoutReady = true;
    sendToNative({ type: "READY" });
  })().catch((error) => sendToNative({ type: "ERROR", error: String(error) }));
}
