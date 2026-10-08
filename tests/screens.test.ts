import React from "react";
import { create, act, type ReactTestRenderer } from "react-test-renderer";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Library } from "../src/database/library";
import type { Resource } from "../src/core/types";
const env = vi.hoisted(() => ({
  services: null as any,
  appState: null as any,
  platformOS: "android",
  routeName: "Browser",
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
  goBack: vi.fn(),
  errors: vi.fn(),
  offlineSave: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  FlatList: "FlatList",
  Alert: { alert: vi.fn() },
  Platform: {
    get OS() {
      return env.platformOS;
    },
  },
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
        goBack: env.goBack,
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
    useRoute: () => ({ params: {}, name: env.routeName }),
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
import { FavoritesScreen } from "../src/screens/FavoritesScreen";
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
  env.platformOS = "android";
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
  env.offlineSave.mockResolvedValue({
    id: "saved-page",
    title: "Example page",
    warnings: [],
  });
  env.services = {
    library,
    ready: Promise.resolve(),
    documents: {},
    offline: { save: env.offlineSave },
  };
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
    "收藏",
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
  ).toEqual(["返回", "收藏", "前进", "刷新", "保存离线", "存储管理", "前往"]);
});
it("separates Markdown and PDF file selection from adding a folder", async () => {
  const documents = {
    chooseMarkdownFile: vi.fn().mockResolvedValue({ id: "markdown-id" }),
    choosePdfFile: vi.fn().mockResolvedValue({ id: "pdf-id" }),
    chooseFolder: vi.fn().mockResolvedValue({ id: "folder-id" }),
  };
  env.services.documents = documents;
  await render(React.createElement(LibraryScreen, { mode: "files" }));

  const actions = tree.root.findAllByType("Action" as any);
  expect(actions.map((action) => action.props.label)).toEqual([
    "打开 Markdown",
    "打开 PDF",
    "添加文件夹",
  ]);

  await act(async () => actions[0]!.props.onPress());
  expect(documents.chooseMarkdownFile).toHaveBeenCalledOnce();
  expect(env.navigation.navigate).toHaveBeenCalledWith("Reader", {
    id: "markdown-id",
  });

  await act(async () =>
    tree.root.findByProps({ label: "打开 PDF" }).props.onPress(),
  );
  expect(documents.choosePdfFile).toHaveBeenCalledOnce();
  expect(env.navigation.navigate).toHaveBeenCalledWith("Reader", {
    id: "pdf-id",
  });

  await act(async () =>
    tree.root.findByProps({ label: "添加文件夹" }).props.onPress(),
  );
  expect(documents.chooseFolder).toHaveBeenCalledOnce();
  expect(env.navigation.navigate).toHaveBeenCalledWith("Directory", {
    id: "folder-id",
  });
});
it("uses a compact safe-area toolbar for the Android browser tab", async () => {
  await render(React.createElement(BrowserScreen));

  const options = env.navigation.setOptions.mock.calls.at(-1)?.[0];

  expect(options?.headerShown).toBe(false);
  expect(tree.root.findByType("SafeAreaView" as any).props.edges).toEqual([
    "top",
  ]);
  expect(
    tree.root
      .findAllByType("Action" as any)
      .some((action) => action.props.label === "返回"),
  ).toBe(true);
});
it("shrinks the Android web page area when the keyboard opens", async () => {
  await render(React.createElement(BrowserScreen));

  const keyboardArea = tree.root.findByType("KeyboardAvoidingView" as any);
  expect(keyboardArea.props.behavior).toBe("height");
  expect(keyboardArea.props.style).toMatchObject({ flex: 1 });
  expect(keyboardArea.findByType("WebView" as any)).toBeDefined();
});
it("opens Android popup links in the current embedded browser", async () => {
  await render(React.createElement(BrowserScreen));

  const webView = tree.root.findByType("WebView" as any);
  expect(webView.props.onOpenWindow).toBeTypeOf("function");

  await act(async () =>
    webView.props.onOpenWindow({
      nativeEvent: { targetUrl: "https://example.com/new-window" },
    }),
  );

  expect(webView.props.source).toEqual({
    uri: "https://example.com/new-window",
  });
});
it("uses the Android toolbar title as a browser back arrow", async () => {
  await render(React.createElement(BrowserScreen));

  const webView = tree.root.findByType("WebView" as any);
  const initialBackControl = tree.root.findByProps({ label: "返回" });
  expect(initialBackControl.props.icon).toBe("arrow-left");
  expect(initialBackControl.props.iconOnly).toBe(true);
  expect(initialBackControl.props.disabled).toBe(true);

  await act(async () =>
    webView.props.onNavigationStateChange({
      url: "https://example.com/previous-page",
      canGoBack: true,
      canGoForward: false,
    }),
  );

  const backControl = tree.root.findByProps({ label: "返回" });
  expect(backControl.props.icon).toBe("arrow-left");
  expect(backControl.props.disabled).toBe(false);

  await act(async () => backControl.props.onPress());
  expect(env.goBack).toHaveBeenCalledOnce();
});
it.each(["android", "ios"] as const)(
  "lets %s users toggle a saved web bookmark",
  async (platformOS) => {
    env.platformOS = platformOS;
    await render(React.createElement(BrowserScreen));

    const webView = tree.root.findByType("WebView" as any);
    await act(async () =>
      webView.props.onNavigationStateChange({
        url: "https://example.com/article",
        title: "Example article",
        canGoBack: true,
        canGoForward: false,
      }),
    );

    const bookmarkAction = () => {
      const options = env.navigation.setOptions.mock.calls.at(-1)?.[0];
      return React.Children.toArray(options.headerRight().props.children)[0];
    };
    expect((bookmarkAction() as React.ReactElement).props).toMatchObject({
      label: "收藏",
      icon: "bookmark",
    });

    await act(async () =>
      (
        (bookmarkAction() as React.ReactElement).props
          .onPress as () => Promise<void>
      )(),
    );
    expect(await library.bookmarks()).toMatchObject([
      {
        url: "https://example.com/article",
        title: "Example article",
      },
    ]);
    expect((bookmarkAction() as React.ReactElement).props).toMatchObject({
      label: "取消收藏",
      icon: "check",
    });

    await act(async () =>
      (
        (bookmarkAction() as React.ReactElement).props
          .onPress as () => Promise<void>
      )(),
    );
    expect(await library.bookmarks()).toEqual([]);
  },
);
it("uses the iOS browser header as a browser back arrow", async () => {
  env.platformOS = "ios";
  await render(React.createElement(BrowserScreen));

  let options = env.navigation.setOptions.mock.calls.at(-1)?.[0];
  expect(options?.headerShown).toBe(true);
  expect(options?.headerTitle).toBeTypeOf("function");
  let title = options.headerTitle();
  expect(title.props.label).toBe("返回");
  expect(title.props.icon).toBe("arrow-left");
  expect(title.props.iconOnly).toBe(true);
  expect(title.props.disabled).toBe(true);

  const webView = tree.root.findByType("WebView" as any);
  expect(tree.root.findAllByType("KeyboardAvoidingView" as any)).toHaveLength(
    0,
  );
  expect(webView.props.onOpenWindow).toBeUndefined();
  await act(async () =>
    webView.props.onNavigationStateChange({
      url: "https://example.com/previous-page",
      canGoBack: true,
      canGoForward: false,
    }),
  );

  options = env.navigation.setOptions.mock.calls.at(-1)?.[0];
  title = options.headerTitle();
  expect(title.props.icon).toBe("arrow-left");
  expect(title.props.disabled).toBe(false);

  await act(async () => title.props.onPress());
  expect(env.goBack).toHaveBeenCalledOnce();
});
it("opens a bookmarked web page from the favorites list", async () => {
  await library.toggleBookmark("https://example.com/saved", "Saved article");
  await render(React.createElement(FavoritesScreen));

  await vi.waitFor(() =>
    expect(tree.root.findByType("FlatList" as any).props.data).toMatchObject([
      { url: "https://example.com/saved", title: "Saved article" },
    ]),
  );
  const favorites = tree.root.findByType("FlatList" as any);
  const rowElement = favorites.props.renderItem({
    item: favorites.props.data[0],
  });
  expect(rowElement.props.icon).toBe("bookmark");
  expect(rowElement.props.subtitle).toBe("https://example.com/saved");

  await act(async () => rowElement.props.onPress());
  expect(env.navigation.navigate).toHaveBeenCalledWith("BrowserPage", {
    url: "https://example.com/saved",
  });
});
it("removes a bookmark from the favorites list management action", async () => {
  await library.toggleBookmark("https://example.com/remove", "Remove me");
  await render(React.createElement(FavoritesScreen));

  await vi.waitFor(() =>
    expect(tree.root.findByType("FlatList" as any).props.data).toHaveLength(1),
  );
  const list = tree.root.findByType("FlatList" as any);
  const rowElement = list.props.renderItem({ item: list.props.data[0] });
  await act(async () => rowElement.props.onLongPress());

  const { Alert } = await import("react-native");
  const managementButtons = vi.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  await act(async () => managementButtons?.[1]?.onPress?.());

  expect(await library.bookmarks()).toEqual([]);
});
it("saves from the browser in reader mode and silently stays on the page", async () => {
  await render(React.createElement(BrowserScreen));
  const controls = React.Children.toArray(
    env.navigation.setOptions.mock.calls.at(-1)?.[0].headerRight().props
      .children,
  ) as React.ReactElement[];

  await act(async () => controls[3]!.props.onPress());
  await vi.waitFor(() => expect(env.inject).toHaveBeenCalled());
  expect(env.inject.mock.calls[0]![0]).toContain('"reader"');

  const webView = tree.root.findByType("WebView" as any);
  await act(async () => {
    await webView.props.onMessage({
      nativeEvent: {
        data: JSON.stringify({
          id: "capture-id",
          type: "CAPTURE_START",
          url: "https://example.com/article",
          title: "Example page",
          mode: "reader",
          length: 0,
        }),
      },
    });
    await webView.props.onMessage({
      nativeEvent: {
        data: JSON.stringify({ id: "capture-id", type: "CAPTURE_END" }),
      },
    });
  });

  expect(env.offlineSave.mock.calls[0]![0].mode).toBe("reader");
  expect(env.navigation.navigate).not.toHaveBeenCalled();
  expect(tree.root.findAllByType("WebView" as any)).toHaveLength(1);
  expect(
    vi.mocked((await import("react-native")).Alert.alert),
  ).not.toHaveBeenCalled();
});
it("does not render the web-page load percentage row", async () => {
  await render(React.createElement(BrowserScreen));

  const webView = tree.root.findByType("WebView" as any);
  expect(webView.props.onLoadProgress).toBeUndefined();
  expect(tree.root.findAllByType("Busy" as any)).toHaveLength(0);
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
