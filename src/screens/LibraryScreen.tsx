import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, View, Text } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useServices, usePalette } from "../app/context";
import type { RootStack } from "../app/navigation";
import type { Resource, Folder } from "../core/types";
import {
  Action,
  Busy,
  Empty,
  Row,
  styles,
  showError,
  formatSize,
} from "../components/ui";
import { removeResource } from "../services/maintenance";
type Item =
  { kind: "resource"; value: Resource } | { kind: "folder"; value: Folder };
export function LibraryScreen({
  mode,
}: {
  mode: "recent" | "files" | "offline";
}) {
  const { library, documents, ready } = useServices(),
    { colors } = usePalette();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState("");
  const mounted = useRef(true),
    revision = useRef(0),
    offset = useRef(0),
    complete = useRef(false),
    loading = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    loading.current = true;
    try {
      const [resources, folders] = await Promise.all([
        mode === "recent"
          ? library.recent()
          : library.savedPage(mode === "files" ? "files" : "web"),
        mode === "offline" ? Promise.resolve([]) : library.folders(),
      ]);
      if (!mounted.current || request !== revision.current) return;
      offset.current = resources.length;
      complete.current = mode === "recent" || resources.length < 60;
      const list: Item[] = [
        ...resources.map((value) => ({ kind: "resource" as const, value })),
        ...folders.map((value) => ({ kind: "folder" as const, value })),
      ];
      setItems(
        list.sort((a, b) => b.value.lastOpenedAt - a.value.lastOpenedAt),
      );
    } finally {
      if (request === revision.current) loading.current = false;
    }
  }, [library, mode]);
  const loadMore = async () => {
    if (loading.current || complete.current || mode === "recent") return;
    loading.current = true;
    setLoadingMore(true);
    const request = revision.current;
    try {
      const rows = await library.savedPage(
        mode === "files" ? "files" : "web",
        offset.current,
      );
      if (!mounted.current || request !== revision.current) return;
      offset.current += rows.length;
      complete.current = rows.length < 60;
      setItems((old) => {
        const ids = new Set(
          old.filter((x) => x.kind === "resource").map((x) => x.value.id),
        );
        return [
          ...old,
          ...rows
            .filter((r) => !ids.has(r.id))
            .map((value) => ({ kind: "resource" as const, value })),
        ].sort((a, b) => b.value.lastOpenedAt - a.value.lastOpenedAt);
      });
    } catch (e) {
      if (mounted.current) showError(e);
    } finally {
      if (request === revision.current) loading.current = false;
      if (mounted.current) setLoadingMore(false);
    }
  };
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      void refresh().catch(showError);
      void ready
        .then(() => {
          if (focused && mounted.current) return refresh();
        })
        .catch(showError);
      return () => {
        focused = false;
      };
    }, [refresh, ready]),
  );
  const choose = async (folder: boolean) => {
    setBusy(folder ? "正在授权目录…" : "正在导入文件与图片…");
    try {
      await ready;
      if (folder) {
        const f = await documents.chooseFolder();
        navigation.navigate("Directory", { id: f.id });
      } else {
        const r = await documents.chooseFile();
        navigation.navigate("Reader", { id: r.id });
      }
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const open = (item: Item) =>
    item.kind === "resource"
      ? navigation.navigate("Reader", { id: item.value.id })
      : navigation.navigate("Directory", {
          id: item.value.id,
          path: item.value.lastPath,
        });
  const manage = (item: Item) => {
    const buttons: any[] = [{ text: "取消", style: "cancel" }];
    if (item.kind === "resource") {
      if (mode === "recent")
        buttons.push({
          text: "从最近移除",
          onPress: () => {
            void library.forget(item.value.id).then(refresh).catch(showError);
          },
        });
      buttons.push({
        text: "删除本地副本",
        style: "destructive",
        onPress: () => {
          void removeResource(library, item.value)
            .then(refresh)
            .catch(showError);
        },
      });
    } else
      buttons.push({
        text: "移除目录记录",
        style: "destructive",
        onPress: () => {
          void library
            .removeFolder(item.value.id)
            .then(refresh)
            .catch(showError);
        },
      });
    Alert.alert(
      "name" in item.value ? item.value.name : item.value.title,
      "只管理应用中的记录和副本，原文件不会被删除。",
      buttons,
    );
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {mode !== "offline" && (
        <View style={styles.actions}>
          <Action
            icon="file-plus"
            label="打开文件"
            primary
            onPress={() => {
              void choose(false);
            }}
            disabled={!!busy}
          />
          <Action
            icon="folder-plus"
            label="添加文件夹"
            onPress={() => {
              void choose(true);
            }}
            disabled={!!busy}
          />
        </View>
      )}
      {busy && <Busy label={busy} />}
      <Text style={[styles.hint, { color: colors.muted }]}>
        {mode === "offline"
          ? "保存的网页直接从手机打开，无需等待网络。"
          : mode === "files"
            ? "文件保留离线副本；授权目录可直接继续浏览。"
            : "继续上次阅读。长按条目可管理记录与副本。"}
      </Text>
      <FlatList
        data={items}
        onEndReached={() => {
          void loadMore();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? <Busy label="正在加载更多资料…" /> : null
        }
        keyExtractor={(item) => item.kind + item.value.id}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={() => {
          void refresh().catch(showError);
        }}
        ListEmptyComponent={
          <Empty
            title={mode === "offline" ? "还没有离线网页" : "资料库还很安静"}
            detail={
              mode === "offline"
                ? "在浏览页面打开文章，再点击保存离线。"
                : "打开 Markdown、PDF 或添加一个文件夹开始阅读。"
            }
          />
        }
        renderItem={({ item }) =>
          item.kind === "folder" ? (
            <Row
              title={item.value.name}
              subtitle={"文件夹 · " + (item.value.lastPath || "根目录")}
              icon="folder"
              onPress={() => open(item)}
              onLongPress={() => manage(item)}
            />
          ) : (
            <Row
              title={item.value.title}
              subtitle={`${item.value.type === "pdf" ? "PDF" : item.value.type === "markdown" ? "Markdown" : "离线网页"} · ${item.value.type === "pdf" ? `第 ${item.value.position.page ?? 1} 页` : `${Math.round((item.value.position.progress ?? 0) * 100)}%`} · ${formatSize(item.value.size)}${item.value.warnings.length ? " · 有资源缺失" : ""}`}
              icon={item.value.type === "web" ? "globe" : "file-text"}
              onPress={() => open(item)}
              onLongPress={() => manage(item)}
            />
          )
        }
      />
    </View>
  );
}
