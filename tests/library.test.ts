import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Library } from "../src/database/library";
it("updates a renewed folder URI without replacing its identity or document association", async () => {
  const db = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...args: any[]) => {
      db.prepare(sql).run(...args);
    },
    getAllAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).all(...args) as T[],
    getFirstAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).get(...args) as T | null,
  };
  const library = new Library(adapter);
  await library.initialize();
  const folder = {
    id: "folder",
    name: "Notes",
    uri: "file:///old/",
    bookmark: "old",
    lastPath: "chapter",
    lastOpenedAt: 1,
  };
  await library.saveFolder(folder);
  await library.upsert({
    id: "doc",
    sourceKey: "file:doc",
    type: "markdown",
    title: "A",
    localPath: "imported/a/document.md",
    folderId: folder.id,
  });
  await library.saveFolder({
    ...folder,
    uri: "file:///moved/",
    bookmark: "renewed",
  });
  expect(await library.folders()).toMatchObject([
    {
      id: "folder",
      uri: "file:///moved/",
      bookmark: "renewed",
      lastPath: "chapter",
    },
  ]);
  expect((await library.get("doc"))?.folderId).toBe("folder");
  db.close();
});
it("keeps identity, local copy and position when the same source is reimported", async () => {
  const db = new DatabaseSync(":memory:");
  const adapter = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...args: any[]) => {
      db.prepare(sql).run(...args);
    },
    getAllAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).all(...args) as T[],
    getFirstAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).get(...args) as T | null,
  };
  const library = new Library(adapter);
  await library.initialize();
  const a = await library.upsert({
    id: "one",
    sourceKey: "provider:1",
    type: "pdf",
    title: "A",
    localPath: "imported/one/a.pdf",
  });
  await library.savePosition(a.id, { page: 38, scale: 1.3 });
  const b = await library.upsert({
    id: "two",
    sourceKey: "provider:1",
    type: "pdf",
    title: "B",
    localPath: "imported/one/b.pdf",
  });
  expect(b.id).toBe("one");
  expect((await library.get("one"))?.position).toMatchObject({
    page: 38,
    scale: 1.3,
  });
  expect((await library.recent()).length).toBe(1);
  await library.setStatus("one", "deleting");
  expect((await library.recent()).length).toBe(0);
  db.close();
});
it("persists browser bookmarks and removes them when toggled off", async () => {
  const db = new DatabaseSync(":memory:");
  const library = new Library({
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...args) => {
      db.prepare(sql).run(...args);
    },
    getAllAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).all(...args) as T[],
    getFirstAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).get(...args) as T | null,
  });
  await library.initialize();

  expect(await library.isBookmarked("https://example.com/guide")).toBe(false);
  expect(
    await library.toggleBookmark("https://example.com/guide", "Example guide"),
  ).toBe(true);
  expect(await library.isBookmarked("https://example.com/guide")).toBe(true);
  expect(await library.bookmarks()).toMatchObject([
    { url: "https://example.com/guide", title: "Example guide" },
  ]);

  expect(
    await library.toggleBookmark("https://example.com/guide", "Example guide"),
  ).toBe(false);
  expect(await library.bookmarks()).toEqual([]);
  db.close();
});
it("migrates an existing version-one database to bookmark storage", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA user_version=1;");
  const library = new Library({
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...args) => {
      db.prepare(sql).run(...args);
    },
    getAllAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).all(...args) as T[],
    getFirstAsync: async <T>(sql: string, ...args: any[]) =>
      db.prepare(sql).get(...args) as T | null,
  });

  await library.initialize();

  expect(db.prepare("PRAGMA user_version;").get()).toMatchObject({
    user_version: 2,
  });
  expect(await library.toggleBookmark("https://example.com", "Example")).toBe(
    true,
  );
  db.close();
});
