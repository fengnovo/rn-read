import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Alert, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Crypto from "expo-crypto";
import type { RootStack } from "../app/navigation";
import { useServices, usePalette } from "../app/context";
import { Action, Busy, styles, showError } from "../components/ui";
import { normalizeBrowserUrl } from "../core/paths";
import { CaptureReceiver } from "../core/capture";
import { read } from "../storage/files";

/** 内置浏览器：显示网页，并把 WebView 通过分块协议交来的内容保存为离线副本。 */
export function BrowserScreen() {
  const route = useRoute();
  const initial =
    (route.params as { url?: string } | undefined)?.url ??
    "https://developer.mozilla.org/zh-CN/";
  const { offline, ready } = useServices(),
    { colors } = usePalette(),
    navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [url, setUrl] = useState(initial),
    [address, setAddress] = useState(initial),
    [navigationState, setNavigationState] = useState({
      back: false,
      forward: false,
    }),
    [loading, setLoading] = useState(0),
    [busy, setBusy] = useState("");
  const browserWebView = useRef<WebView>(null),
    currentPageUrl = useRef(initial),
    // 接收器、取消控制器和超时器属于同一次保存，导航或离开页面时一起作废。
    activeCapture = useRef<{
      receiver: CaptureReceiver;
      controller: AbortController;
      timer: ReturnType<typeof setTimeout>;
    } | null>(null);
  const cancel = useCallback(() => {
    activeCapture.current?.controller.abort();
    if (activeCapture.current) clearTimeout(activeCapture.current.timer);
    activeCapture.current = null;
    setBusy("");
  }, []);
  useEffect(
    () => () => {
      activeCapture.current?.controller.abort();
      if (activeCapture.current) clearTimeout(activeCapture.current.timer);
    },
    [],
  );
  const navigateToAddress = () => {
    try {
      const target = normalizeBrowserUrl(address);
      cancel();
      setUrl(target);
      currentPageUrl.current = target;
    } catch (e) {
      showError(e);
    }
  };
  const saveCurrentPage = useCallback(
    async (mode: "reader" | "snapshot") => {
      try {
        await ready;
        cancel();
        const captureId = Crypto.randomUUID();
        const controller = new AbortController();
        setBusy("正在捕获当前已加载内容…");
        const timer = setTimeout(() => {
          cancel();
          Alert.alert("捕获超时", "请等待网页内容加载后重试。");
        }, 30000);
        activeCapture.current = {
          receiver: new CaptureReceiver(captureId),
          controller,
          timer,
        };
        browserWebView.current?.injectJavaScript(
          (await read("runtime/capture.js")) +
            `;window.RNReadCapture(${JSON.stringify(captureId)},${JSON.stringify(mode)});true;`,
        );
      } catch (e) {
        cancel();
        showError(e);
      }
    },
    [cancel, ready],
  );
  /** 只接收当前任务的捕获分块，并在完整快照到达后启动离线保存。 */
  const onMessage = async (data: string) => {
    const captureTask = activeCapture.current;
    if (!captureTask || data.length > 1024 * 1024) return;
    try {
      const capture = captureTask.receiver.accept(JSON.parse(data));
      if (!capture) return;
      clearTimeout(captureTask.timer);
      const resource = await offline.save(
        capture,
        setBusy,
        captureTask.controller.signal,
      );
      // 保存期间用户可能已经取消或离开页面；旧任务完成后不能弹出过期结果。
      if (activeCapture.current !== captureTask) return;
      activeCapture.current = null;
      setBusy("");
      Alert.alert(
        resource.warnings.length ? "已保存，有部分资源缺失" : "已保存离线",
        resource.title,
        [
          { text: "继续浏览" },
          {
            text: "打开本地页面",
            onPress: () => navigation.navigate("Reader", { id: resource.id }),
          },
        ],
      );
    } catch (e) {
      if (activeCapture.current === captureTask) {
        cancel();
        if (!captureTask.controller.signal.aborted) showError(e);
        else if (!(e instanceof Error && e.name === "AbortError")) showError(e);
      }
    }
  };
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitleAlign: "left",
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Action
            label="后退"
            icon="arrow-left"
            iconOnly
            disabled={!navigationState.back}
            onPress={() => browserWebView.current?.goBack()}
          />
          <Action
            label="前进"
            icon="arrow-right"
            iconOnly
            disabled={!navigationState.forward}
            onPress={() => browserWebView.current?.goForward()}
          />
          <Action
            label="刷新"
            icon="refresh-cw"
            iconOnly
            onPress={() => browserWebView.current?.reload()}
          />
          <Action
            label="保存离线"
            icon="download"
            iconOnly
            primary
            disabled={!!busy}
            onPress={() =>
              Alert.alert(
                "保存当前内容",
                "保存当前已经加载的正文和资源。未加载内容、视频和复杂交互不包含在快照中。",
                [
                  { text: "取消", style: "cancel" },
                  {
                    text: "阅读模式",
                    onPress: () => {
                      void saveCurrentPage("reader");
                    },
                  },
                  {
                    text: "原样快照",
                    onPress: () => {
                      void saveCurrentPage("snapshot");
                    },
                  },
                ],
              )
            }
          />
          <Action
            label="存储管理"
            icon="settings"
            iconOnly
            onPress={() => navigation.navigate("Settings")}
          />
        </View>
      ),
    });
  }, [
    busy,
    navigationState.back,
    navigationState.forward,
    navigation,
    saveCurrentPage,
  ]);
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View
        style={{
          padding: 12,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
        }}
      >
        <TextInput
          accessibilityLabel="网页地址"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          value={address}
          onChangeText={setAddress}
          onSubmitEditing={navigateToAddress}
          style={{
            flex: 1,
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.card,
          }}
        />
        <Action label="前往" onPress={navigateToAddress} />
      </View>
      {busy ? (
        <View>
          <Busy label={busy} />
          <Action label="取消保存" onPress={cancel} />
        </View>
      ) : loading > 0 && loading < 1 ? (
        <Busy label={`网页加载 ${Math.round(loading * 100)}%`} />
      ) : null}
      <WebView
        ref={browserWebView}
        source={{ uri: url }}
        javaScriptEnabled
        domStorageEnabled
        onLoadProgress={(e) => setLoading(e.nativeEvent.progress)}
        onError={(e) => Alert.alert("网页无法加载", e.nativeEvent.description)}
        onMessage={(e) => {
          void onMessage(e.nativeEvent.data);
        }}
        onShouldStartLoadWithRequest={(r) =>
          /^https?:\/\//i.test(r.url) || r.url === "about:blank"
        }
        onNavigationStateChange={(state) => {
          // 捕获期间跳到新页面就取消，避免把下一个页面误存为当前快照。
          if (activeCapture.current && state.url !== currentPageUrl.current)
            cancel();
          currentPageUrl.current = state.url;
          setAddress(state.url);
          setNavigationState({
            back: state.canGoBack,
            forward: state.canGoForward,
          });
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
