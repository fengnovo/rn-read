import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Alert, Platform, Text, TextInput, View } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
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
    "https://ai.codefather.cn/vibe";
  const { library, offline, ready } = useServices(),
    { colors } = usePalette(),
    navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  // Android edge-to-edge 下浏览标签的原生头部留白过大；改由页面绘制紧凑工具栏。
  const useCompactAndroidToolbar =
    Platform.OS === "android" && route.name === "Browser";
  const [url, setUrl] = useState(initial),
    [address, setAddress] = useState(initial),
    [navigationState, setNavigationState] = useState({
      back: false,
      forward: false,
    }),
    [busy, setBusy] = useState(""),
    [bookmarked, setBookmarked] = useState(false),
    [bookmarkBusy, setBookmarkBusy] = useState(false);
  const browserWebView = useRef<WebView>(null),
    currentPageUrl = useRef(initial),
    currentPageTitle = useRef(initial),
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
      currentPageTitle.current = target;
      setBookmarked(false);
    } catch (e) {
      showError(e);
    }
  };
  /** 把当前网页地址和标题写入收藏表，再次点击同一按钮可取消收藏。 */
  const toggleBookmark = useCallback(async () => {
    const targetUrl = currentPageUrl.current;
    if (!/^https?:\/\//i.test(targetUrl)) return;

    setBookmarkBusy(true);
    try {
      await ready;
      const nextBookmarked = await library.toggleBookmark(
        targetUrl,
        currentPageTitle.current || targetUrl,
      );
      if (currentPageUrl.current === targetUrl) setBookmarked(nextBookmarked);
    } catch (e) {
      showError(e);
    } finally {
      setBookmarkBusy(false);
    }
  }, [library, ready]);
  const saveCurrentPage = useCallback(async () => {
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
          `;window.RNReadCapture(${JSON.stringify(captureId)},"reader");true;`,
      );
    } catch (e) {
      cancel();
      showError(e);
    }
  }, [cancel, ready]);
  /** 只接收当前任务的捕获分块，并在完整快照到达后启动离线保存。 */
  const onMessage = async (data: string) => {
    const captureTask = activeCapture.current;
    if (!captureTask || data.length > 1024 * 1024) return;
    try {
      const capture = captureTask.receiver.accept(JSON.parse(data));
      if (!capture) return;
      clearTimeout(captureTask.timer);
      await offline.save(capture, setBusy, captureTask.controller.signal);
      // 保存期间用户可能已经取消或离开页面；旧任务完成后不能弹出过期结果。
      if (activeCapture.current !== captureTask) return;
      activeCapture.current = null;
      setBusy("");
    } catch (e) {
      if (activeCapture.current === captureTask) {
        cancel();
        if (!captureTask.controller.signal.aborted) showError(e);
        else if (!(e instanceof Error && e.name === "AbortError")) showError(e);
      }
    }
  };
  const renderBrowserActions = () => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: useCompactAndroidToolbar ? 0 : 8,
      }}
    >
      <Action
        label={bookmarked ? "取消收藏" : "收藏"}
        icon={bookmarked ? "check" : "bookmark"}
        iconOnly
        disabled={bookmarkBusy || !/^https?:\/\//i.test(currentPageUrl.current)}
        onPress={toggleBookmark}
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
        onPress={() => {
          void saveCurrentPage();
        }}
      />
      <Action
        label="存储管理"
        icon="settings"
        iconOnly
        onPress={() => navigation.navigate("Settings")}
      />
    </View>
  );
  /** iOS 原生导航栏标题和 Android 紧凑工具栏共用同一个网页后退箭头。 */
  const renderBackTitle = () => (
    <Action
      label="返回"
      icon="arrow-left"
      iconOnly
      disabled={!navigationState.back}
      onPress={() => browserWebView.current?.goBack()}
    />
  );
  useLayoutEffect(() => {
    navigation.setOptions({
      // 用紧凑工具栏替代默认头部；SafeAreaView 继续避开 Android 状态栏和摄像头开孔。
      headerShown: !useCompactAndroidToolbar,
      headerTitleAlign: "left",
      // iOS 浏览标签仍使用原生导航栏，把原来的标题替换成网页历史后退按钮。
      headerTitle: route.name === "Browser" ? renderBackTitle : undefined,
      headerRight: renderBrowserActions,
    });
  }, [
    busy,
    navigationState.back,
    navigationState.forward,
    bookmarked,
    bookmarkBusy,
    navigation,
    route.name,
    saveCurrentPage,
    toggleBookmark,
    useCompactAndroidToolbar,
  ]);
  return (
    <SafeAreaView
      edges={useCompactAndroidToolbar ? ["top"] : []}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      {useCompactAndroidToolbar && (
        <View
          style={{
            minHeight: 48,
            paddingHorizontal: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {renderBackTitle()}
          {renderBrowserActions()}
        </View>
      )}
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: useCompactAndroidToolbar ? 4 : 12,
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
      ) : null}
      <WebView
        ref={browserWebView}
        source={{ uri: url }}
        javaScriptEnabled
        domStorageEnabled
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
          currentPageTitle.current = state.title?.trim() || state.url;
          setAddress(state.url);
          void library
            .isBookmarked(state.url)
            .then((saved) => {
              if (currentPageUrl.current === state.url) setBookmarked(saved);
            })
            .catch(showError);
          setNavigationState({
            back: state.canGoBack,
            forward: state.canGoForward,
          });
        }}
        style={{ flex: 1 }}
      />
    </SafeAreaView>
  );
}
