import { Readability } from "@mozilla/readability";
window.RNReadCapture = async (id: string, mode: "snapshot" | "reader") => {
  const send = (m: object) =>
    window.ReactNativeWebView?.postMessage(JSON.stringify({ id, ...m }));
  try {
    const baseURI = document.baseURI;
    const clone = document.cloneNode(true) as Document;
    clone.querySelectorAll("img").forEach((img, i) => {
      const original = document.querySelectorAll("img")[i];
      img.src = original?.currentSrc || original?.src || img.src;
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    });
    clone.querySelectorAll("picture source").forEach((el) => el.remove());
    clone.querySelectorAll("a[href],link[href]").forEach((el) => {
      try {
        const href = el.getAttribute("href")!,
          resolved = new URL(href, baseURI);
        const current = new URL(location.href);
        current.hash = "";
        const destination = new URL(resolved);
        destination.hash = "";
        el.setAttribute(
          "href",
          el.tagName === "A" &&
            resolved.hash &&
            destination.href === current.href
            ? resolved.hash
            : resolved.href,
        );
      } catch {}
    });
    clone
      .querySelectorAll("base,script,iframe,object,embed")
      .forEach((el) => el.remove());
    let title = document.title,
      html = clone.documentElement.outerHTML;
    if (mode === "reader") {
      const article = new Readability(clone).parse();
      if (!article?.content) throw Error("无法提取正文，请改用原样快照");
      title = article.title || title;
      html = article.content;
    }
    if (html.length > 20 * 1024 * 1024) throw Error("网页超过20 MiB，无法保存");
    send({
      type: "CAPTURE_START",
      title,
      url: location.href,
      baseURI,
      mode,
      length: html.length,
    });
    for (
      let index = 0, offset = 0;
      offset < html.length;
      index++, offset += 128 * 1024
    ) {
      send({
        type: "CAPTURE_CHUNK",
        index,
        data: html.slice(offset, offset + 128 * 1024),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    send({ type: "CAPTURE_END" });
  } catch (error) {
    send({ type: "CAPTURE_ERROR", error: String(error) });
  }
};
