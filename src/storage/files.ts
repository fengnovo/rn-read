import * as FS from "expo-file-system/legacy";
import { Asset } from "expo-asset";
export const root = (FS.documentDirectory ?? "") + "rn-read/";
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
  const names = await FS.readDirectoryAsync(uri(path));
  return (await Promise.all(names.map((n) => size(path + "/" + n)))).reduce(
    (a, b) => a + b,
    0,
  );
}
export async function initializeFiles() {
  if (!FS.documentDirectory) throw Error("持久存储不可用");
  for (const dir of ["imported", "offline", "readers", "staging", "runtime"])
    await mkdir(dir);
  for (const [name, module] of [
    ["runtime", require("../../assets/runtime.webbundle")],
    ["capture", require("../../assets/capture.webbundle")],
  ] as const) {
    const asset = Asset.fromModule(module);
    const path = "runtime/" + name + ".js";
    const stamp = "runtime/" + name + ".hash";
    if (
      asset.hash &&
      (await exists(path)) &&
      (await exists(stamp)) &&
      (await read(stamp)) === asset.hash
    )
      continue;
    await asset.downloadAsync();
    if (!asset.localUri) throw Error("本地阅读资源不可用");
    await copy(asset.localUri, path);
    await write(stamp, asset.hash ?? "");
  }
}
export { FS };
