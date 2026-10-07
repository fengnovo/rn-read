import { readerDocument, TEMPLATE_VERSION } from "../web/templates";
import type { Resource } from "../core/types";
import * as files from "../storage/files";
import { relocateContent } from "../core/relocate";
export async function prepareReader(
  resource: Resource,
  dark: boolean,
  initialAnchor?: string,
) {
  if (!(await files.exists(resource.localPath)))
    throw Error("离线文件不存在，请重新导入或重新保存网页");
  const directory = resource.localPath.split("/").slice(0, -1).join("/");
  const source =
    resource.type === "web"
      ? JSON.parse(await files.read(directory + "/content.json"))
      : { html: await files.read(directory + "/body.html"), head: "" };
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
      ? relocateContent(source.html, source.head, "../../" + directory + "/")
      : { html: source.html, head: "" };
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
export async function saveSvgCache(
  resource: Resource,
  dark: boolean,
  cache: unknown,
) {
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
export async function prepareDiagram(svg: string, dark: boolean) {
  if (svg.length > 2 * 1024 * 1024) throw Error("图表过大");
  const target = "readers/diagram/index.html";
  await files.write(
    target,
    readerDocument({ diagram: svg, dark }, "../../runtime/runtime.js"),
  );
  return files.uri(target);
}
