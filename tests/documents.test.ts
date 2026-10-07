import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  resolveRelative: vi.fn(),
  identity: vi.fn(),
  copyToLocal: vi.fn(),
  content: new Map<string, string>(),
}));
const picker = vi.hoisted(() => ({ pick: vi.fn(), pickDirectory: vi.fn() }));
vi.mock("../modules/document-access", () => native);
vi.mock("@react-native-documents/picker", () => ({
  ...picker,
  types: { allFiles: "all" },
  isErrorWithCode: () => false,
  errorCodes: {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "new-id" }));
vi.mock("../src/storage/files", () => ({
  uri: (s: string) => s,
  mkdir: async () => {},
  read: async (s: string) => native.content.get(s) ?? "",
  write: async (s: string, v: string) => {
    native.content.set(s, v);
  },
  size: async () => 1,
  move: async () => {},
  remove: async () => {},
  exists: async () => false,
}));
import { Documents } from "../src/services/documents";
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
beforeEach(() => vi.clearAllMocks());
it("persists refreshed root URI and bookmark across directory reopen and subdirectory resolution", async () => {
  const { db, library } = await openLibrary();
  const folder = {
    id: "one",
    name: "Notes",
    uri: "file:///old",
    bookmark: "old",
    lastPath: "",
    lastOpenedAt: 0,
  };
  await library.saveFolder(folder);
  native.listDirectory.mockResolvedValue({
    rootUri: "file:///moved",
    bookmark: "fresh",
    entries: [],
  });
  const documents = new Documents(library);
  await documents.list(folder, "");
  expect((await library.folders())[0]).toMatchObject({
    id: "one",
    uri: "file:///moved",
    bookmark: "fresh",
  });
  native.resolveRelative.mockResolvedValue({
    uri: "file:///moved/chapter",
    rootUri: "file:///moved",
    bookmark: "fresh",
  });
  await documents.list((await library.folders())[0]!, "chapter");
  expect(native.resolveRelative).toHaveBeenCalledWith(
    "file:///moved",
    "chapter",
    "fresh",
  );
  expect((await library.folders())[0]?.uri).toBe("file:///moved");
  db.close();
});
it("reauthorizes a folder without orphaning its imported document references", async () => {
  const { db, library } = await openLibrary();
  await library.saveFolder({
    id: "one",
    name: "Notes",
    uri: "file:///old",
    lastPath: "chapter",
    lastOpenedAt: 0,
  });
  await library.upsert({
    id: "doc",
    sourceKey: "doc",
    type: "markdown",
    title: "A",
    localPath: "imported/a/document.md",
    folderId: "one",
  });
  picker.pickDirectory.mockResolvedValue({
    uri: "file:///new",
    bookmark: "renewed",
    bookmarkStatus: "success",
  });
  const f = await new Documents(library).chooseFolder("one");
  expect(f.id).toBe("one");
  expect(f.lastPath).toBe("chapter");
  expect((await library.get("doc"))?.folderId).toBe("one");
  db.close();
});

it("imports Markdown with stable duplicate and Unicode heading anchors", async () => {
  const { db, library } = await openLibrary();
  native.identity.mockResolvedValue({
    identity: "heading-doc",
    uri: "source.md",
  });
  native.copyToLocal.mockImplementation(async (_: string, target: string) => {
    native.content.set(
      target,
      "# Hello World\n\n[Jump](#hello-world)\n\n# Hello World\n\n# 中文 标题\n\n[中文](#中文-标题)",
    );
  });
  await new Documents(library).importFile("source.md", "anchors.md");
  const html = native.content.get("staging/new-id/body.html");
  expect(html).toContain('<h1 id="hello-world">');
  expect(html).toContain('<h1 id="hello-world-1">');
  expect(html).toContain('<h1 id="中文-标题">');
  db.close();
});
