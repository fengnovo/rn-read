import { Library } from "../database/library";
import * as files from "../storage/files";
import type { Resource } from "../core/types";

/** 删除副本时先标记数据库，文件或进程异常后 recover 仍能继续清理。 */
export async function removeResource(library: Library, resource: Resource) {
  await library.setStatus(resource.id, "deleting");
  await files.remove(resource.localPath.split("/").slice(0, -1).join("/"));
  await files.remove("readers/" + resource.id);
  await library.remove(resource.id);
}

/**
 * 应用启动时修复被中断的保存/删除。
 * 正式目录已有 manifest 就补写数据库；只有 staging 时则丢弃不完整副本。
 */
export async function recover(library: Library) {
  for (const job of await library.jobs()) {
    if (await files.exists(job.final_path + "/manifest.json")) {
      const value = JSON.parse(
        await files.read(job.final_path + "/manifest.json"),
      ) as Resource;
      if (await files.exists(value.localPath)) await library.upsert(value);
    }
    await files.remove(job.staging);
    await library.finishJob(job.id);
  }
  for (const resource of await library.deleting())
    await removeResource(library, resource);
}
