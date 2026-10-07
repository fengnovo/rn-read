import { Library } from "../database/library";
import * as files from "../storage/files";
import type { Resource } from "../core/types";
export async function removeResource(library: Library, resource: Resource) {
  await library.setStatus(resource.id, "deleting");
  await files.remove(resource.localPath.split("/").slice(0, -1).join("/"));
  await files.remove("readers/" + resource.id);
  await library.remove(resource.id);
}
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
