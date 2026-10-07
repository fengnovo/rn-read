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
function safePosition(value: unknown): Position | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Position;
  if (
    !Number.isFinite(p.scrollY) ||
    !Number.isFinite(p.progress) ||
    Number(p.progress) < 0 ||
    Number(p.progress) > 1
  )
    return null;
  return {
    version: 1,
    scrollY: Math.max(0, Math.min(1e8, p.scrollY!)),
    progress: p.progress,
    anchor: typeof p.anchor === "string" ? p.anchor.slice(0, 200) : undefined,
    offset: Number.isFinite(p.offset)
      ? Math.max(-1e5, Math.min(1e5, p.offset!))
      : 0,
  };
}
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
  const makeSession = (r: Resource) => ({
    writer: createPositionWriter(
      r.position,
      (p) => library.savePosition(r.id, p),
      showError,
    ),
    ready: r.type === "pdf",
    closed: false,
    suspended: false,
    key: ++generation.current,
  });
  const persist = (p: Position, force = false) => {
    if (session?.ready)
      session.writer.update(p, force || session.closed || session.suspended);
  };
  const flush = () => {
    if (sessionRef.current) sessionRef.current.suspended = true;
    web.current?.injectJavaScript("window.RNRead?.flush(); true;");
    void sessionRef.current?.writer.flush();
  };
  useEffect(() => {
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
      const r = await library.get(route.params.id);
      if (!r) throw Error("资料记录不存在");
      await library.touch(r.id);
      const prepared =
        r.type === "pdf"
          ? files.uri(r.localPath)
          : await prepareReader(r, dark, route.params.initialAnchor);
      if (!live) return;
      opened = makeSession(r);
      sessionRef.current = opened;
      setSession(opened);
      navigation.setOptions({ title: r.title });
      if (live) {
        setResource(r);
        setEntry(prepared);
        if (r.type === "pdf") setBusy(false);
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
  const onMessage = (data: string) => {
    if (!session || data.length > 5 * 1024 * 1024) return;
    try {
      const message = JSON.parse(data);
      if (message.type === "POSITION") {
        const p = safePosition(message.position);
        if (p && session.ready)
          session.writer.update(
            p,
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
  const associate = async () => {
    const original = session;
    try {
      await ready;
      await original?.writer.flush();
      const folder = await documents.chooseFolder();
      const r = await documents.openRelative(folder, resource!.title);
      if (!active.current || sessionRef.current !== original) return;
      setBusy(true);
      const prepared = await prepareReader(r, dark, route.params.initialAnchor);
      if (!active.current || sessionRef.current !== original) return;
      setResource(r);
      if (session) {
        session.closed = true;
        void session.writer.flush();
      }
      const replacement = makeSession(r);
      sessionRef.current = replacement;
      setSession(replacement);
      setEntry(prepared);
    } catch (e) {
      if (active.current && sessionRef.current === original) {
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
