import React, { useEffect, useRef, useState } from "react";
import { AppState, View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import Pdf from "react-native-pdf";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStack } from "../app/navigation";
import { createPositionWriter } from "../core/position-writer";
import { resolveRelativePath } from "../core/paths";
import type { Position, Resource } from "../core/types";
import { useServices, usePalette } from "../app/context";
import { Action, Busy, styles, showError } from "../components/ui";
import {
  prepareReader,
  saveSvgCache,
  prepareDiagram,
} from "../services/readers";
import * as files from "../storage/files";

/** 校验来自 WebView 的阅读位置，只接受有限且处于合理范围内的数据。 */
function safePosition(value: unknown): Position | null {
  if (!value || typeof value !== "object") return null;
  const positionData = value as Position;
  if (
    !Number.isFinite(positionData.scrollY) ||
    !Number.isFinite(positionData.progress) ||
    Number(positionData.progress) < 0 ||
    Number(positionData.progress) > 1
  )
    return null;
  return {
    version: 1,
    scrollY: Math.max(0, Math.min(1e8, positionData.scrollY!)),
    progress: positionData.progress,
    anchor:
      typeof positionData.anchor === "string"
        ? positionData.anchor.slice(0, 200)
        : undefined,
    offset: Number.isFinite(positionData.offset)
      ? Math.max(-1e5, Math.min(1e5, positionData.offset!))
      : 0,
  };
}

/** 根据资料类型打开 PDF 或 WebView 阅读器，并持续保存页码/滚动位置。 */
export function ReaderScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStack, "Reader">) {
  const { library, documents, ready } = useServices(),
    { colors, dark } = usePalette();
  const [resource, setResource] = useState<Resource | null>(null),
    [entry, setEntry] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [bounds, setBounds] = useState({ width: 0, height: 0 });
  type Session = {
    writer: ReturnType<typeof createPositionWriter>;
    ready: boolean;
    closed: boolean;
    suspended: boolean;
    key: number;
  };
  const [session, setSession] = useState<Session | null>(null);
  const web = useRef<WebView>(null),
    sessionRef = useRef<Session | null>(null),
    generation = useRef(0),
    active = useRef(true);
  const createReadingSession = (resourceToOpen: Resource) => ({
    writer: createPositionWriter(
      resourceToOpen.position,
      (position) => library.savePosition(resourceToOpen.id, position),
      showError,
    ),
    ready: resourceToOpen.type === "pdf",
    closed: false,
    suspended: false,
    key: ++generation.current,
  });
  const persist = (positionUpdate: Position, force = false) => {
    if (session?.ready)
      session.writer.update(
        positionUpdate,
        force || session.closed || session.suspended,
      );
  };
  /** 页面失焦、进后台或卸载前，先让 WebView 上报最后一个滚动位置再写入数据库。 */
  const flush = () => {
    if (sessionRef.current) sessionRef.current.suspended = true;
    web.current?.injectJavaScript("window.RNRead?.flush(); true;");
    void sessionRef.current?.writer.flush();
  };
  useEffect(() => {
    // 先加载资源记录，再生成带主题和位置的 reader HTML；异步返回时页面可能已卸载。
    let live = true;
    active.current = true;
    setBusy(true);
    setError("");
    setEntry("");
    setResource(null);
    sessionRef.current = null;
    setSession(null);
    let opened: Session | null = null;
    void (async () => {
      await ready;
      const resource = await library.get(route.params.id);
      if (!resource) throw Error("资料记录不存在");
      await library.touch(resource.id);
      const prepared =
        resource.type === "pdf"
          ? files.uri(resource.localPath)
          : await prepareReader(resource, dark, route.params.initialAnchor);
      if (!live) return;
      opened = createReadingSession(resource);
      sessionRef.current = opened;
      setSession(opened);
      navigation.setOptions({ title: resource.title });
      if (live) {
        setResource(resource);
        setEntry(prepared);
        if (resource.type === "pdf") setBusy(false);
      }
    })().catch((e) => {
      if (live) {
        setError(String(e));
        setBusy(false);
      }
    });
    return () => {
      live = false;
      web.current?.injectJavaScript("window.RNRead?.flush(); true;");
      if (sessionRef.current) {
        sessionRef.current.closed = true;
        void sessionRef.current.writer.flush();
      }
      active.current = false;
    };
  }, [
    route.params.id,
    route.params.initialAnchor,
    dark,
    library,
    ready,
    navigation,
  ]);
  useEffect(() => {
    // WebView 在内容布局稳定前不保存位置；后台或离开时由 flush 强制落盘。
    const sub = AppState.addEventListener("change", (state) => {
      if (sessionRef.current) sessionRef.current.suspended = state !== "active";
      if (state !== "active") flush();
    });
    return () => sub.remove();
  }, [library]);
  useEffect(() => {
    const blur = navigation.addListener("blur", flush);
    const exit = navigation.addListener("beforeRemove", flush);
    const focus = navigation.addListener("focus", () => {
      if (sessionRef.current) sessionRef.current.suspended = false;
    });
    return () => {
      blur?.();
      exit?.();
      focus?.();
    };
  }, [navigation]);
  const openLink = async (url: string) => {
    if (/^https?:\/\//i.test(url)) {
      navigation.navigate("BrowserPage", { url });
      return;
    }
    if (!resource?.folderId || !resource.relativePath)
      throw Error("需要先选择文档所在目录才能打开关联文件");
    const folder = (await library.folders()).find(
      (f) => f.id === resource.folderId,
    );
    if (!folder) throw Error("目录授权记录不存在，请重新选择目录");
    const target = resolveRelativePath(resource.relativePath, url);
    const r = await documents.openRelative(folder, target);
    const fragment = url.includes("#")
      ? decodeURIComponent(url.slice(url.indexOf("#") + 1))
      : undefined;
    navigation.push("Reader", {
      id: r.id,
      ...(fragment ? { initialAnchor: fragment } : {}),
    });
  };
  /** 处理本地 reader runtime 发来的进度、图表和链接消息，并校验消息体积。 */
  const onMessage = (data: string) => {
    if (!session || data.length > 5 * 1024 * 1024) return;
    try {
      const message = JSON.parse(data);
      if (message.type === "POSITION") {
        const position = safePosition(message.position);
        if (position && session.ready)
          session.writer.update(
            position,
            session.closed || session.suspended || !active.current,
          );
        return;
      }
      if (!active.current || session.closed) return;
      if (message.type === "READY") {
        session.ready = true;
        setBusy(false);
      } else if (message.type === "SVG_CACHE" && resource)
        void saveSvgCache(resource, dark, message.cache).catch(() => {});
      else if (
        message.type === "DIAGRAM" &&
        typeof message.svg === "string" &&
        message.svg.length < 2 * 1024 * 1024
      )
        navigation.navigate("Diagram", { svg: message.svg });
      else if (
        message.type === "OPEN_LINK" &&
        typeof message.url === "string" &&
        message.url.length < 4096
      )
        void openLink(message.url).catch(showError);
      else if (message.type === "ERROR") {
        setError("内容渲染失败");
        setBusy(false);
      }
    } catch {}
  };
  /** 单独选择 Markdown 所在目录后重新导入，才能读取其相对图片。 */
  const associate = async () => {
    const previousSession = session;
    try {
      await ready;
      await previousSession?.writer.flush();
      const folder = await documents.chooseFolder();
      const importedResource = await documents.openRelative(
        folder,
        resource!.title,
      );
      if (!active.current || sessionRef.current !== previousSession) return;
      setBusy(true);
      const prepared = await prepareReader(
        importedResource,
        dark,
        route.params.initialAnchor,
      );
      if (!active.current || sessionRef.current !== previousSession) return;
      setResource(importedResource);
      if (session) {
        session.closed = true;
        void session.writer.flush();
      }
      const replacement = createReadingSession(importedResource);
      sessionRef.current = replacement;
      setSession(replacement);
      setEntry(prepared);
    } catch (e) {
      if (active.current && sessionRef.current === previousSession) {
        setBusy(false);
        showError(e);
      }
    }
  };
  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      {resource?.warnings.length ? (
        <View
          style={{
            padding: 12,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            numberOfLines={3}
            style={{ color: colors.muted, lineHeight: 21 }}
          >
            {resource.warnings.length} 个资源未保存离线。{resource.warnings[0]}
          </Text>
          {resource.type === "markdown" && !resource.folderId && (
            <Action
              label="选择所在目录，补全图片"
              icon="folder"
              onPress={() => {
                void associate();
              }}
            />
          )}
        </View>
      ) : null}
      {busy && <Busy label="正在准备阅读内容…" />}
      {error && (
        <View style={{ padding: 24, gap: 16 }}>
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {error}
          </Text>
          <Action
            label="重新导入文件"
            onPress={() => {
              void documents
                .chooseFile()
                .then((r) => navigation.replace("Reader", { id: r.id }))
                .catch(showError);
            }}
          />
        </View>
      )}
      <View
        style={{ flex: 1 }}
        onLayout={(e) => setBounds(e.nativeEvent.layout)}
      >
        {entry && resource?.type === "pdf" && bounds.width > 0 ? (
          <Pdf
            source={{ uri: entry, cache: false }}
            trustAllCerts={false}
            page={Math.max(1, resource.position.page ?? 1)}
            scale={Math.max(1, Math.min(5, resource.position.scale ?? 1))}
            minScale={1}
            maxScale={5}
            fitPolicy={0}
            enableDoubleTapZoom
            onPageChanged={(page) => persist({ page })}
            onScaleChanged={(scale) => persist({ scale })}
            onError={(e) => {
              setError(String(e));
              setBusy(false);
            }}
            onPressLink={(url) => {
              void openLink(url).catch(showError);
            }}
            style={{
              width: bounds.width,
              height: bounds.height,
              backgroundColor: colors.bg,
            }}
          />
        ) : entry && resource?.type !== "pdf" ? (
          <WebView
            key={session?.key}
            ref={web}
            source={{ uri: entry }}
            allowingReadAccessToURL={files.root}
            allowFileAccess
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            javaScriptEnabled
            setBuiltInZoomControls
            setDisplayZoomControls={false}
            originWhitelist={["file://*"]}
            onShouldStartLoadWithRequest={(request) =>
              request.url.startsWith(files.root) && request.url === entry
            }
            onMessage={(e) => onMessage(e.nativeEvent.data)}
            onError={(e) => {
              setError(e.nativeEvent.description);
              setBusy(false);
            }}
            onContentProcessDidTerminate={() => web.current?.reload()}
            style={{ backgroundColor: colors.bg, flex: 1 }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

/** 展示独立 Mermaid 图表页面，缩放和拖动由共享 WebView runtime 处理。 */
export function DiagramScreen({
  route,
}: NativeStackScreenProps<RootStack, "Diagram">) {
  const { dark, colors } = usePalette();
  const [entry, setEntry] = useState("");
  useEffect(() => {
    void prepareDiagram(route.params.svg, dark).then(setEntry).catch(showError);
  }, [route.params.svg, dark]);
  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      {entry ? (
        <WebView
          source={{ uri: entry }}
          allowingReadAccessToURL={files.root}
          allowFileAccess
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptEnabled
          originWhitelist={["file://*"]}
          onShouldStartLoadWithRequest={(r) => r.url === entry}
          style={{ flex: 1, backgroundColor: colors.bg }}
        />
      ) : (
        <Busy label="正在打开图表…" />
      )}
    </SafeAreaView>
  );
}
