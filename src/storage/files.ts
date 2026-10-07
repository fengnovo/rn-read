import * as FS from "expo-file-system/legacy";
import { Asset } from "expo-asset";

/** 所有应用私有文件共用的持久目录；外部原件不会被写入这里。 */
export const root = (FS.documentDirectory ?? "") + "rn-read/";

/** 把相对存储路径转为 file URI，并阻止绝对路径或 `..` 越出应用目录。 */
export function uri(path: string): string {
  if (path.startsWith("/") || path.split("/").includes(".."))
    throw Error("无效存储路径");
  return root + path;
}
export async function mkdir(path: string) {
  await FS.makeDirectoryAsync(uri(path), { intermediates: true });
}
export async function write(path: string, text: string) {
  await mkdir(path.split("/").slice(0, -1).join("/"));
  await FS.writeAsStringAsync(uri(path), text);
}
export async function read(path: string) {
  return FS.readAsStringAsync(uri(path));
}
export async function remove(path: string) {
  await FS.deleteAsync(uri(path), { idempotent: true });
}
export async function exists(path: string) {
  return (await FS.getInfoAsync(uri(path))).exists;
}
export async function copy(from: string, to: string) {
  await mkdir(to.split("/").slice(0, -1).join("/"));
  await FS.copyAsync({ from, to: uri(to) });
}
export async function move(from: string, to: string) {
  await mkdir(to.split("/").slice(0, -1).join("/"));
  await FS.moveAsync({ from: uri(from), to: uri(to) });
}
export async function size(path: string): Promise<number> {
  const info = await FS.getInfoAsync(uri(path));
  if (!info.exists) return 0;
  if (!info.isDirectory) return info.size;
  const children = await FS.readDirectoryAsync(uri(path));
  return (
    await Promise.all(children.map((name) => size(path + "/" + name)))
  ).reduce((total, childSize) => total + childSize, 0);
}

/**
 * 创建资料目录，并把随应用打包的网页运行时复制到可离线读取的位置。
 * hash 未变化时跳过复制，避免每次启动都重复写入同一批 JS 文件。
 */
export async function initializeFiles() {
  if (!FS.documentDirectory) throw Error("持久存储不可用");
  for (const dir of ["imported", "offline", "readers", "staging", "runtime"])
    await mkdir(dir);
  for (const [bundleName, module] of [
    ["runtime", require("../../assets/runtime.webbundle")],
    ["capture", require("../../assets/capture.webbundle")],
  ] as const) {
    const asset = Asset.fromModule(module);
    const runtimePath = "runtime/" + bundleName + ".js";
    const hashPath = "runtime/" + bundleName + ".hash";
    if (
      asset.hash &&
      (await exists(runtimePath)) &&
      (await exists(hashPath)) &&
      (await read(hashPath)) === asset.hash
    )
      continue;
    await asset.downloadAsync();
    if (!asset.localUri) throw Error("本地阅读资源不可用");
    await copy(asset.localUri, runtimePath);
    await write(hashPath, asset.hash ?? "");
  }
}
export { FS };
