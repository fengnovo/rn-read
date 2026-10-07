import { readerDocument, TEMPLATE_VERSION } from "../web/templates";
import type { Resource } from "../core/types";
import * as files from "../storage/files";
import { relocateContent } from "../core/relocate";

/**
 * 为 WebView 准备当前主题、阅读位置和缓存图表对应的独立 HTML 文件。
 * 网页正文保存路径与临时 reader 路径不同，因此需要先重写资源相对地址。
 */
export async function prepareReader(
  resource: Resource,
  dark: boolean,
  initialAnchor?: string,
) {
  if (!(await files.exists(resource.localPath)))
    throw Error("离线文件不存在，请重新导入或重新保存网页");
  const resourceDirectory = resource.localPath
    .split("/")
    .slice(0, -1)
    .join("/");
  const savedContent =
    resource.type === "web"
      ? JSON.parse(await files.read(resourceDirectory + "/content.json"))
      : { html: await files.read(resourceDirectory + "/body.html"), head: "" };
  const cachePath = "readers/" + resource.id + "/svg.json";
  let svgCache: Record<string, string> = {};
  if (await files.exists(cachePath)) {
    const cache = JSON.parse(await files.read(cachePath));
    if (cache.key === resource.localPath + TEMPLATE_VERSION + dark)
      svgCache = cache.svg;
  }
  const target = "readers/" + resource.id + "/index.html";
  const { html, head } =
    resource.type === "web"
      ? relocateContent(
          savedContent.html,
          savedContent.head,
          "../../" + resourceDirectory + "/",
        )
      : { html: savedContent.html, head: "" };
  await files.write(
    target,
    readerDocument(
      {
        html,
        head,
        position: resource.position,
        initialAnchor,
        svgCache,
        dark,
      },
      "../../runtime/runtime.js",
    ),
  );
  return files.uri(target);
}

/** 保存 mermaid 生成的 SVG，减少重新打开文档时的解析和布局等待。 */
export async function saveSvgCache(
  resource: Resource,
  dark: boolean,
  cache: unknown,
) {
  // 只接受字符串映射，并限制缓存体积；WebView 消息不能直接成为任意结构的文件。
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return;
  const serialized = JSON.stringify(cache);
  if (serialized.length > 4 * 1024 * 1024) return;
  if (Object.values(cache).some((value) => typeof value !== "string")) return;
  await files.write(
    "readers/" + resource.id + "/svg.json",
    JSON.stringify({
      key: resource.localPath + TEMPLATE_VERSION + dark,
      svg: cache,
    }),
  );
}

/** 为独立图表查看器生成临时 HTML；巨大 SVG 会被拒绝以控制内存占用。 */
export async function prepareDiagram(svg: string, dark: boolean) {
  if (svg.length > 2 * 1024 * 1024) throw Error("图表过大");
  const target = "readers/diagram/index.html";
  await files.write(
    target,
    readerDocument({ diagram: svg, dark }, "../../runtime/runtime.js"),
  );
  return files.uri(target);
}
