import { parseDocument } from "htmlparser2";
import { isTag, Text, type AnyNode, type Element } from "domhandler";
import { getInnerHTML, removeElement } from "domutils";
import render from "dom-serializer";
import * as css from "css-tree";

/** 下载器在文件系统里保存一项资源后返回的元数据。CSS 会附带文本供 AST 重写。 */
export interface DownloadedAsset {
  text: string;
  finalUrl: string;
  mime: string;
  localPath: string;
}
type DownloadAsset = (url: string) => Promise<DownloadedAsset>;

// 控制单页保存体积和样式导入深度，避免异常站点触发无限下载或递归。
const MAX_CAPTURED_ASSETS = 500;
const MAX_STYLESHEET_IMPORT_DEPTH = 8;

// 原样快照只保留静态内容；脚本、表单、媒体和 SVG 动画都不能在离线页执行。
const removedElementTags = new Set([
  "script",
  "noscript",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "base",
  "meta",
  "audio",
  "video",
  "source",
  "track",
  "applet",
  "foreignobject",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);
/** 仅允许 HTTP(S) 资源地址，拒绝 data/file/javascript 等其他 scheme。 */
function resolveHttpUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value.trim(), base);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
/** 返回从资源所属文件到另一份本地文件的相对路径。 */
function relativeLocalPath(sourceFilePath: string, destinationPath: string) {
  const sourceSegments = sourceFilePath.split("/");
  sourceSegments.pop();
  const destinationSegments = destinationPath.split("/");
  while (
    sourceSegments.length &&
    sourceSegments[0] === destinationSegments[0]
  ) {
    sourceSegments.shift();
    destinationSegments.shift();
  }
  return [...sourceSegments.map(() => ".."), ...destinationSegments].join("/");
}
/** 快照仅保留常见、内嵌的位图格式；其他 data URL 可能承载可执行内容。 */
const isSafeInlineImage = (value: string) =>
  /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(
    value,
  );

/**
 * 将网页变成不执行远程代码的离线正文，并收集可本地加载的样式。
 * `download` 负责落盘资源，`write` 保存重写后的 CSS；失败资源会进入 warnings。
 */
export async function rewritePage(
  html: string,
  url: string,
  download: DownloadAsset,
  write: (path: string, text: string) => Promise<void>,
): Promise<{ html: string; head: string; warnings: string[] }> {
  const warnings: string[] = [];
  const warningKeys = new Set<string>();
  const warn = (key: string, message: string) => {
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push(message);
    }
  };
  // 同一 URL 可能在多处出现。缓存 Promise 可去重下载，也能让并发引用等待同一结果。
  const assetDownloadByUrl = new Map<string, Promise<DownloadedAsset | null>>();
  const stylesheetByUrl = new Map<string, Promise<DownloadedAsset | null>>();
  async function downloadOnce(
    address: string,
  ): Promise<DownloadedAsset | null> {
    const prior = assetDownloadByUrl.get(address);
    if (prior) return prior;
    if (assetDownloadByUrl.size >= MAX_CAPTURED_ASSETS) {
      warn("limit", "资源数超过 500，部分资源未保存");
      return null;
    }
    const pending = (async () => {
      try {
        return await download(address);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "SaveLimitError")
        )
          throw error;
        warn(address, "资源未保存：" + address);
        return null;
      }
    })();
    assetDownloadByUrl.set(address, pending);
    return pending;
  }
  async function rewriteAssetReference(
    value: string,
    base: string,
    sourceFilePath: string,
  ): Promise<string | null> {
    if (value.startsWith("#") || isSafeInlineImage(value)) return value;
    const address = resolveHttpUrl(value, base);
    if (!address) {
      warn(value, "不支持的资源：" + value);
      return null;
    }
    const parsed = new URL(address);
    const hash = parsed.hash;
    parsed.hash = "";
    const result = await downloadOnce(parsed.href);
    return result
      ? relativeLocalPath(sourceFilePath, result.localPath) + hash
      : null;
  }
  async function getStylesheet(
    address: string,
    depth: number,
    ancestors: Set<string>,
  ): Promise<DownloadedAsset | null> {
    if (depth > MAX_STYLESHEET_IMPORT_DEPTH || ancestors.has(address)) {
      warn("css:" + address, "样式导入循环或超过 8 层：" + address);
      return null;
    }
    const prior = stylesheetByUrl.get(address);
    if (prior) return prior;
    const pending = (async () => {
      const downloaded = await downloadOnce(address);
      if (!downloaded) return null;
      if (!/^text\/css(?:;|$)/i.test(downloaded.mime)) {
        warn(address, "样式类型错误：" + address);
        return null;
      }
      const chain = new Set(ancestors);
      chain.add(address);
      chain.add(downloaded.finalUrl);
      const rewritten = await rewriteCssReferences(
        downloaded.text,
        downloaded.finalUrl,
        downloaded.localPath,
        "stylesheet",
        depth,
        chain,
      );
      await write(downloaded.localPath, rewritten);
      return downloaded;
    })();
    stylesheetByUrl.set(address, pending);
    return pending;
  }
  async function rewriteCssReferences(
    text: string,
    base: string,
    sourceFilePath: string,
    context: "stylesheet" | "declarationList",
    depth = 0,
    ancestors = new Set<string>(),
  ): Promise<string> {
    let stylesheetAst: css.CssNode;
    try {
      stylesheetAst = css.parse(text, {
        context,
        parseCustomProperty: true,
      });
    } catch {
      warn("css-parse:" + text, "无法解析部分样式");
      return "";
    }
    const deferredChanges: Array<() => Promise<void>> = [];
    const visitor: css.EnterOrLeaveFn = function (node, listItem, parentList) {
      if (
        node.type === "Atrule" &&
        ["import", "charset", "namespace"].includes(node.name.toLowerCase())
      ) {
        if (node.name.toLowerCase() !== "import") {
          if (listItem && parentList) parentList.remove(listItem);
          return css.walk.skip;
        }
        const prelude = node.prelude;
        let importTarget: css.StringNode | css.Url | null = null;
        if (prelude)
          css.walk(prelude, (part) => {
            if (
              !importTarget &&
              (part.type === "String" || part.type === "Url")
            )
              importTarget = part;
          });
        const importUrl = importTarget as css.StringNode | css.Url | null;
        deferredChanges.push(async () => {
          const address = importUrl
            ? resolveHttpUrl(importUrl.value, base)
            : null;
          const saved = address
            ? await getStylesheet(address, depth + 1, ancestors)
            : null;
          if (saved && importUrl)
            importUrl.value = relativeLocalPath(
              sourceFilePath,
              saved.localPath,
            );
          else if (listItem && parentList) parentList.remove(listItem);
        });
        return css.walk.skip;
      }
      if (node.type === "Declaration" && node.value.type === "Raw") {
        if (listItem && parentList) parentList.remove(listItem);
        warn("css-raw:" + node.property, "无法解析部分样式：" + node.property);
        return css.walk.skip;
      }
      if (node.type === "Raw") {
        if (listItem && parentList) parentList.remove(listItem);
        return;
      }
      if (
        node.type === "Declaration" &&
        (/^(?:behavior|-moz-binding)$/i.test(node.property) ||
          css.generate(node.value).toLowerCase().includes("expression("))
      ) {
        if (listItem && parentList) parentList.remove(listItem);
        return css.walk.skip;
      }
      if (node.type === "Url")
        deferredChanges.push(async () => {
          node.value =
            (await rewriteAssetReference(node.value, base, sourceFilePath)) ??
            "data:,";
        });
      if (
        node.type === "Function" &&
        /^(?:-webkit-)?image-set$/i.test(node.name)
      ) {
        let nextArgumentIsImage = true;
        node.children.forEach((part) => {
          if (part.type === "Operator" && part.value === ",") {
            nextArgumentIsImage = true;
            return;
          }
          if (part.type === "WhiteSpace") return;
          if (nextArgumentIsImage && part.type === "String")
            deferredChanges.push(async () => {
              part.value =
                (await rewriteAssetReference(
                  part.value,
                  base,
                  sourceFilePath,
                )) ?? "data:,";
            });
          nextArgumentIsImage = false;
        });
      }
    };
    css.walk(stylesheetAst, visitor);
    // 遍历期间只记录异步修改；遍历结束后再按顺序下载，避免 CSS @import 互相等待形成死锁。
    for (const applyChange of deferredChanges) await applyChange();
    return css.generate(stylesheetAst).replace(/<\/style/gi, "<\\/style");
  }
  const documentTree = parseDocument(html);
  let bodyElement: Element | undefined;
  const localHeadMarkup: string[] = [];
  const pendingAttributeRewrites: Promise<void>[] = [];
  let attributeRewriteError: unknown;
  const queueAttributeRewrite = (task: Promise<void>) =>
    pendingAttributeRewrites.push(
      task.catch((error) => {
        attributeRewriteError ??= error;
      }),
    );
  async function visitNode(node: AnyNode): Promise<void> {
    if (!isTag(node)) return;
    const tagName = node.name.toLowerCase();
    if (removedElementTags.has(tagName)) {
      removeElement(node);
      return;
    }
    if (tagName === "body") bodyElement = node;
    if (tagName === "link") {
      if (
        (node.attribs.rel ?? "")
          .toLowerCase()
          .split(/\s+/)
          .includes("stylesheet")
      ) {
        const address = resolveHttpUrl(node.attribs.href ?? "", url);
        const savedStylesheet = address
          ? await getStylesheet(address, 0, new Set())
          : null;
        if (savedStylesheet) {
          const media = node.attribs.media;
          const disabled = "disabled" in node.attribs;
          node.attribs = {
            rel: "stylesheet",
            href: savedStylesheet.localPath,
            ...(media ? { media } : {}),
            ...(disabled ? { disabled: "" } : {}),
          };
          localHeadMarkup.push(render(node));
        }
      }
      removeElement(node);
      return;
    }
    if (tagName === "style") {
      const content = await rewriteCssReferences(
        getInnerHTML(node),
        url,
        "index.html",
        "stylesheet",
      );
      node.attribs = node.attribs.media ? { media: node.attribs.media } : {};
      const text = new Text(content);
      text.parent = node;
      node.children = [text];
      localHeadMarkup.push(render(node));
      removeElement(node);
      return;
    }
    for (const attributeName of Object.keys(node.attribs)) {
      const normalizedAttributeName = attributeName.toLowerCase();
      const attributeValue = node.attribs[attributeName] ?? "";
      if (
        normalizedAttributeName.startsWith("on") ||
        [
          "srcset",
          "imagesrcset",
          "ping",
          "srcdoc",
          "action",
          "formaction",
          "autofocus",
          "nonce",
          "integrity",
          "crossorigin",
        ].includes(normalizedAttributeName)
      ) {
        delete node.attribs[attributeName];
        continue;
      }
      if (normalizedAttributeName === "style") {
        node.attribs[attributeName] = await rewriteCssReferences(
          attributeValue,
          url,
          "index.html",
          "declarationList",
        );
        continue;
      }
      if (
        normalizedAttributeName === "href" ||
        normalizedAttributeName === "xlink:href"
      ) {
        if (tagName === "a") {
          const address = attributeValue.startsWith("#")
            ? attributeValue
            : resolveHttpUrl(attributeValue, url);
          if (address) node.attribs[attributeName] = address;
          else delete node.attribs[attributeName];
        } else if (["image", "use", "feimage"].includes(tagName)) {
          queueAttributeRewrite(
            rewriteAssetReference(attributeValue, url, "index.html").then(
              (savedPath) => {
                if (savedPath) node.attribs[attributeName] = savedPath;
                else delete node.attribs[attributeName];
              },
            ),
          );
        } else delete node.attribs[attributeName];
        continue;
      }
      if (["src", "poster", "background"].includes(normalizedAttributeName)) {
        queueAttributeRewrite(
          rewriteAssetReference(attributeValue, url, "index.html").then(
            (savedPath) => {
              if (savedPath) node.attribs[attributeName] = savedPath;
              else delete node.attribs[attributeName];
            },
          ),
        );
        continue;
      }
      if (
        [
          "fill",
          "stroke",
          "filter",
          "clip-path",
          "mask",
          "cursor",
          "marker-start",
          "marker-mid",
          "marker-end",
        ].includes(normalizedAttributeName) &&
        /url\s*\(/i.test(attributeValue)
      ) {
        const rewritten = await rewriteCssReferences(
          `${normalizedAttributeName}:${attributeValue}`,
          url,
          "index.html",
          "declarationList",
        );
        node.attribs[attributeName] = rewritten.slice(
          rewritten.indexOf(":") + 1,
        );
      }
      if (/^(?:javascript|vbscript|file|blob):/i.test(attributeValue.trim()))
        delete node.attribs[attributeName];
    }
    for (const child of [...node.children]) await visitNode(child);
    if (tagName === "head") removeElement(node);
  }
  for (const child of [...documentTree.children]) await visitNode(child);
  await Promise.all(pendingAttributeRewrites);
  if (attributeRewriteError) throw attributeRewriteError;
  // Readability 返回的是正文片段，可能没有 body/html 外壳，因此两种输入都要支持。
  let markup = bodyElement
    ? getInnerHTML(bodyElement)
    : getInnerHTML(documentTree);
  if (!bodyElement) {
    const wrapper = documentTree.children.find(
      (node) => isTag(node) && node.name === "html",
    );
    if (wrapper && isTag(wrapper)) markup = getInnerHTML(wrapper);
  }
  return { html: markup, head: localHeadMarkup.join(""), warnings };
}
