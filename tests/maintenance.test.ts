import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/storage/files", () => ({
  exists: async (p: string) => disk.has(p),
  read: async (p: string) => disk.get(p),
  remove: async (p: string) => {
    for (const key of disk.keys())
      if (key === p || key.startsWith(p + "/")) disk.delete(key);
  },
}));
import { recover } from "../src/services/maintenance";
import { Library } from "../src/database/library";
const openLibrary = async () => {
  const db = new DatabaseSync(":memory:");
  const library = new Library({
    execAsync: async (s) => {
      db.exec(s);
    },
    runAsync: async (s, ...a) => {
      db.prepare(s).run(...a);
    },
    getFirstAsync: async <T>(s: string, ...a: any[]) =>
      db.prepare(s).get(...a) as T | null,
    getAllAsync: async <T>(s: string, ...a: any[]) =>
      db.prepare(s).all(...a) as T[],
  });
  await library.initialize();
  return { db, library };
};
it("recovers a moved snapshot after interrupted database commit and removes incomplete staging", async () => {
  disk.clear();
  const { db, library } = await openLibrary();
  await library.startJob(
    "complete",
    "doc",
    "staging/complete",
    "offline/complete",
  );
  await library.startJob(
    "partial",
    "other",
    "staging/partial",
    "offline/partial",
  );
  const resource = {
    id: "doc",
    sourceKey: "web:example",
    type: "web",
    title: "Example",
    localPath: "offline/complete/index.html",
    status: "ready_with_warnings",
    warnings: ["missing image"],
    position: { progress: 0.5 },
  };
  disk.set("offline/complete/manifest.json", JSON.stringify(resource));
  disk.set(resource.localPath, "html");
  disk.set("staging/partial/temp", "partial");
  await recover(library);
  expect(await library.get("doc")).toMatchObject({
    status: "ready_with_warnings",
    position: { progress: 0.5 },
  });
  expect(await library.get("other")).toBeNull();
  expect(await library.jobs()).toEqual([]);
  expect(disk.has("staging/partial/temp")).toBe(false);
  await recover(library);
  expect((await library.recent()).length).toBe(1);
  db.close();
});
it("resumes deletion without touching source files or other snapshots", async () => {
  disk.clear();
  const { db, library } = await openLibrary();
  const r = await library.upsert({
    id: "delete",
    sourceKey: "file:source",
    type: "pdf",
    title: "PDF",
    localPath: "imported/delete/document.pdf",
  });
  await library.setStatus(r.id, "deleting");
  disk.set(r.localPath, "pdf");
  disk.set("readers/delete/index.html", "reader");
  disk.set("imported/keep/document.pdf", "keep");
  disk.set("external/source.pdf", "source");
  await recover(library);
  expect(await library.get("delete")).toBeNull();
  expect(disk.has(r.localPath)).toBe(false);
  expect(disk.get("external/source.pdf")).toBe("source");
  expect(disk.get("imported/keep/document.pdf")).toBe("keep");
  db.close();
});
