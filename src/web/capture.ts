import { Readability } from "@mozilla/readability";

/**
 * 运行在浏览器页面中的捕获脚本。
 * 页面内容通过 CAPTURE_START/CHUNK/END 发给原生端，避免单条 WebView 消息过大。
 */
window.RNReadCapture = async (id: string, mode: "snapshot" | "reader") => {
  const sendToNative = (message: object) =>
    window.ReactNativeWebView?.postMessage(JSON.stringify({ id, ...message }));
  try {
    const baseURI = document.baseURI;
    // 只改副本，避免为了抓取图片和链接而影响用户正在浏览的网页。
    const capturedDocument = document.cloneNode(true) as Document;
    capturedDocument.querySelectorAll("img").forEach((image, imageIndex) => {
      const originalImage = document.querySelectorAll("img")[imageIndex];
      image.src = originalImage?.currentSrc || originalImage?.src || image.src;
      image.removeAttribute("srcset");
      image.removeAttribute("loading");
    });
    capturedDocument
      .querySelectorAll("picture source")
      .forEach((source) => source.remove());
    capturedDocument
      .querySelectorAll("a[href],link[href]")
      .forEach((element) => {
        try {
          const href = element.getAttribute("href")!;
          const resolvedUrl = new URL(href, baseURI);
          const currentPage = new URL(location.href);
          currentPage.hash = "";
          const destinationPage = new URL(resolvedUrl);
          destinationPage.hash = "";
          element.setAttribute(
            "href",
            element.tagName === "A" &&
              resolvedUrl.hash &&
              destinationPage.href === currentPage.href
              ? resolvedUrl.hash
              : resolvedUrl.href,
          );
        } catch {}
      });
    capturedDocument
      .querySelectorAll("base,script,iframe,object,embed")
      .forEach((element) => element.remove());
    let title = document.title;
    let html = capturedDocument.documentElement.outerHTML;
    if (mode === "reader") {
      const article = new Readability(capturedDocument).parse();
      if (!article?.content) throw Error("无法提取正文，请改用原样快照");
      title = article.title || title;
      html = article.content;
    }
    if (html.length > 20 * 1024 * 1024) throw Error("网页超过20 MiB，无法保存");
    sendToNative({
      type: "CAPTURE_START",
      title,
      url: location.href,
      baseURI,
      mode,
      length: html.length,
    });
    const chunkSize = 128 * 1024;
    for (
      let chunkIndex = 0, offset = 0;
      offset < html.length;
      chunkIndex++, offset += chunkSize
    ) {
      sendToNative({
        type: "CAPTURE_CHUNK",
        index: chunkIndex,
        data: html.slice(offset, offset + chunkSize),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    sendToNative({ type: "CAPTURE_END" });
  } catch (error) {
    sendToNative({ type: "CAPTURE_ERROR", error: String(error) });
  }
};
