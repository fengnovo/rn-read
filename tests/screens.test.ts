import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Library } from "../src/database/library";
import type { Resource } from "../src/core/types";
const env = vi.hoisted(() => ({
  services: null as any,
  appState: null as any,
  navigation: {
    setOptions: vi.fn(),
    navigate: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    addListener: vi.fn(),
  },
  content: new Map<string, string>(),
  mounts: 0,
  failWrite: false,
  inject: vi.fn(),
  errors: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  FlatList: "FlatList",
  Alert: { alert: vi.fn() },
  AppState: {
    addEventListener: (_: string, callback: any) => {
      env.appState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("react-native-pdf", () => ({ default: "Pdf" }));
vi.mock("react-native-webview", async () => {
  const React = await import("react");
  return {
    WebView: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: env.inject,
        reload: vi.fn(),
      }));
      React.useEffect(() => {
        env.mounts++;
      }, []);
      return React.createElement("WebView", props);
    }),
  };
});
vi.mock("@react-navigation/native", async () => {
  const React = await import("react");
  return {
    useNavigation: () => env.navigation,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (callback: any) => React.useEffect(callback, [callback]),
  };
});
vi.mock("../src/app/context", () => ({
  useServices: () => env.services,
  usePalette: () => ({ dark: false, colors: {} }),
}));
vi.mock("../src/components/ui", () => ({
  Action: "Action",
  IconAction: "IconAction",
  Busy: "Busy",
  Empty: "Empty",
  Row: "Row",
  styles: {},
  showError: env.errors,
  formatSize: () => "",
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "capture-id" }));
vi.mock("../src/services/maintenance", () => ({ removeResource: vi.fn() }));
vi.mock("../src/storage/files", () => ({
  root: "file:///app/",
  uri: (s: string) => "file:///app/" + s,
  exists: async (s: string) => !s.endsWith("svg.json"),
  read: async (s: string) => env.content.get(s) ?? "",
  write: async (s: string, value: string) => {
    if (env.failWrite) throw Error("disk full");
    env.content.set(s, value);
  },
}));
import { ReaderScreen } from "../src/screens/ReaderScreen";
import { LibraryScreen } from "../src/screens/LibraryScreen";
import { BrowserScreen } from "../src/screens/BrowserScreen";
let db: DatabaseSync, library: Library, tree: ReactTestRenderer;
const render = async (element: React.ReactElement) => {
  await act(async () => {
    tree = create(element);
  });
  return tree;
};
const row = (id = "doc", type: Resource["type"] = "markdown") => ({
  id,
  sourceKey: id,
  type,
  title: id + ".md",
  localPath: "imported/" + id + "/document.md",
  status: "ready" as const,
  warnings: [],
  position: { progress: 0.7, scrollY: 1000 },
  size: 10,
  lastOpenedAt: 1,
});
const message = async (type: string, extra = {}) =>
  act(async () => {
    tree.root.findByType("WebView" as any).props.onMessage({
      nativeEvent: { data: JSON.stringify({ type, ...extra }) },
    });
  });
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  env.mounts = 0;
  env.failWrite = false;
  env.content.clear();
  db = new DatabaseSync(":memory:");
  library = new Library({
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
  env.services = { library, ready: Promise.resolve(), documents: {} };
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  db.close();
  vi.useRealTimers();
});
it("places browser navigation and offline controls in the top bar as icon-only actions", async () => {
  await render(React.createElement(BrowserScreen));

  const options = env.navigation.setOptions.mock.calls.at(-1)?.[0];
  expect(options?.headerRight).toBeTypeOf("function");
  expect(options?.headerTitleAlign).toBe("left");
  const header = options.headerRight();
  const controls = React.Children.toArray(
    header.props.children,
  ) as React.ReactElement[];

  expect(controls.map((control) => control.props.label)).toEqual([
    "后退",
    "前进",
    "刷新",
    "保存离线",
    "存储管理",
  ]);
  expect(controls.every((control) => control.props.iconOnly)).toBe(true);
  expect(
    tree.root
      .findAllByType("Action" as any)
      .map((action) => action.props.label),
  ).toEqual(["前往"]);
});
it("reassociating an unchanged resource ID remounts prepared content and completes loading", async () => {
  const original = { ...row(), warnings: ["missing image"] };
  await library.upsert(original);
  env.content.set("imported/doc/body.html", "<p>Old</p>");
  env.services.documents = {
    chooseFolder: async () => ({ id: "folder" }),
    openRelative: async () => {
      env.content.set("imported/doc/body.html", "<p>New image</p>");
      return { ...original, folderId: "folder", warnings: [] };
    },
  };
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  await act(async () =>
    tree.root.findAllByType("Action" as any)[0]!.props.onPress(),
  );
  expect(env.mounts).toBe(2);
  expect(env.content.get("readers/doc/index.html")).toContain("New image");
  await message("READY");
  expect(tree.root.findAllByType("Busy" as any)).toHaveLength(0);
});
it("a failed reassociation clears the reader busy state", async () => {
  await library.upsert({ ...row(), warnings: ["missing"] });
  env.services.documents = {
    chooseFolder: async () => ({ id: "folder" }),
    openRelative: async () => ({ ...row(), warnings: [] }),
  };
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  env.failWrite = true;
  await act(async () =>
    tree.root.findAllByType("Action" as any)[0]!.props.onPress(),
  );
  expect(tree.root.findAllByType("Busy" as any)).toHaveLength(0);
});
it("persists the last position after two scroll messages within the throttle window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  await library.upsert(row());
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  await message("POSITION", { position: { progress: 0.2, scrollY: 200 } });
  await act(async () => vi.advanceTimersByTimeAsync(300));
  await message("POSITION", { position: { progress: 0.4, scrollY: 400 } });
  await act(async () => vi.advanceTimersByTimeAsync(700));
  expect((await library.get("doc"))?.position.scrollY).toBe(400);
});
it("ignores position messages before restoration finishes", async () => {
  await library.upsert(row());
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("POSITION", { position: { progress: 0, scrollY: 0 } });
  expect((await library.get("doc"))?.position.progress).toBe(0.7);
});
it("refreshes the initial library after background recovery completes", async () => {
  let resolve!: () => void;
  env.services.ready = new Promise<void>((r) => {
    resolve = r;
  });
  await library.upsert(row("old"));
  await render(React.createElement(LibraryScreen, { mode: "recent" }));
  expect(
    tree.root
      .findByType("FlatList" as any)
      .props.data.map((x: any) => x.value.id),
  ).toEqual(["old"]);
  await library.upsert(row("recovered"));
  await act(async () => {
    resolve();
    await env.services.ready;
  });
  expect(
    tree.root
      .findByType("FlatList" as any)
      .props.data.map((x: any) => x.value.id),
  ).toContain("recovered");
});
it("files paginates matching documents past 200 newer webpages and reaches all saved rows", async () => {
  for (let i = 0; i < 215; i++) {
    await library.upsert(row("pdf-" + i, "pdf"));
  }
  for (let i = 0; i < 205; i++) {
    await library.upsert(row("web-" + i, "web"));
  }
  await render(React.createElement(LibraryScreen, { mode: "files" }));
  let list = tree.root.findByType("FlatList" as any);
  expect(list.props.data.length).toBeGreaterThan(0);
  for (let n = 0; n < 8; n++) {
    await act(async () => list.props.onEndReached?.());
    list = tree.root.findByType("FlatList" as any);
  }
  expect(list.props.data).toHaveLength(215);
  expect(list.props.data.every((x: any) => x.value.type === "pdf")).toBe(true);
});
it("cross-file links retain their Unicode fragment in the next reader route", async () => {
  await library.saveFolder({
    id: "folder",
    uri: "file:///folder",
    name: "Notes",
    lastPath: "",
    lastOpenedAt: 1,
  });
  await library.upsert({
    ...row(),
    folderId: "folder",
    relativePath: "first.md",
  });
  env.services.documents = { openRelative: async () => row("next") };
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  await message("OPEN_LINK", { url: "next.md#%E4%B8%AD%E6%96%87" });
  await vi.waitFor(() => expect(env.navigation.push).toHaveBeenCalled());
  expect(env.navigation.push).toHaveBeenCalledWith("Reader", {
    id: "next",
    initialAnchor: "中文",
  });
});
it("accepts the final POSITION bridge message delivered after reader cleanup", async () => {
  await library.upsert(row());
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  const deliver = tree.root.findByType("WebView" as any).props.onMessage;
  await act(async () => tree.unmount());
  await act(async () =>
    deliver({
      nativeEvent: {
        data: JSON.stringify({
          type: "POSITION",
          position: { scrollY: 900, progress: 0.9 },
        }),
      },
    }),
  );
  expect((await library.get("doc"))?.position.scrollY).toBe(900);
});
it("flushes a trailing position immediately on blur and before navigation removal", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const events = new Map<string, () => void>();
  env.navigation.addListener.mockImplementation(
    (name: string, callback: any) => {
      events.set(name, callback);
      return () => events.delete(name);
    },
  );
  await library.upsert(row());
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  await message("POSITION", { position: { progress: 0.2, scrollY: 200 } });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  await message("POSITION", { position: { progress: 0.3, scrollY: 300 } });
  await act(async () => events.get("blur")!());
  expect((await library.get("doc"))?.position.scrollY).toBe(300);
  await message("POSITION", { position: { progress: 0.4, scrollY: 400 } });
  await act(async () => events.get("beforeRemove")!());
  expect((await library.get("doc"))?.position.scrollY).toBe(400);
});
it("flushes the position returned by the runtime while the app is already in background", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  await library.upsert(row());
  await render(
    React.createElement(ReaderScreen, {
      route: { params: { id: "doc" } },
      navigation: env.navigation,
    } as any),
  );
  await message("READY");
  await message("POSITION", { position: { progress: 0.2, scrollY: 200 } });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  await act(async () => env.appState("background"));
  await message("POSITION", { position: { progress: 0.5, scrollY: 500 } });
  expect((await library.get("doc"))?.position.scrollY).toBe(500);
});
it("does not rerun the library query when recovery finishes after unmount", async () => {
  let resolve!: () => void;
  env.services.ready = new Promise<void>((r) => {
    resolve = r;
  });
  const recent = vi.spyOn(library, "recent");
  await render(React.createElement(LibraryScreen, { mode: "recent" }));
  expect(recent).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
  await act(async () => {
    resolve();
    await env.services.ready;
  });
  expect(recent).toHaveBeenCalledTimes(1);
});
it("offline pagination includes forgotten saved webpages and stops querying after the last page", async () => {
  for (let i = 0; i < 215; i++) await library.upsert(row("web-" + i, "web"));
  await library.forget("web-0");
  const page = vi.spyOn(library, "savedPage");
  await render(React.createElement(LibraryScreen, { mode: "offline" }));
  for (let n = 0; n < 5; n++)
    await act(async () =>
      tree.root.findByType("FlatList" as any).props.onEndReached(),
    );
  expect(tree.root.findByType("FlatList" as any).props.data).toHaveLength(215);
  const count = page.mock.calls.length;
  await act(async () =>
    tree.root.findByType("FlatList" as any).props.onEndReached(),
  );
  expect(page).toHaveBeenCalledTimes(count);
});
