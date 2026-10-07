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
type LibraryItem =
  { kind: "resource"; value: Resource } | { kind: "folder"; value: Folder };

/** 把资源类型、阅读位置和离线状态组合成列表中的辅助说明。 */
function describeResource(resource: Resource) {
  const typeLabel =
    resource.type === "pdf"
      ? "PDF"
      : resource.type === "markdown"
        ? "Markdown"
        : "离线网页";
  const readingPosition =
    resource.type === "pdf"
      ? `第 ${resource.position.page ?? 1} 页`
      : `${Math.round((resource.position.progress ?? 0) * 100)}%`;
  const resourceWarnings = resource.warnings.length ? "有资源缺失" : null;

  return [
    typeLabel,
    readingPosition,
    formatSize(resource.size),
    resourceWarnings,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 展示最近阅读、已导入文件或离线网页，并负责分页、导入与副本管理。 */
export function LibraryScreen({
  mode,
}: {
  mode: "recent" | "files" | "offline";
}) {
  const { library, documents, ready } = useServices(),
    { colors } = usePalette();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [items, setItems] = useState<LibraryItem[]>([]),
    [busy, setBusy] = useState("");
  const mounted = useRef(true),
    // 刷新后到达的旧分页结果会失效，避免列表顺序倒退或重复追加。
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
  /** 重新读取当前 tab 的首屏，并使先前正在执行的分页请求失效。 */
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
      const displayItems: LibraryItem[] = [
        ...resources.map((value) => ({ kind: "resource" as const, value })),
        ...folders.map((value) => ({ kind: "folder" as const, value })),
      ];
      setItems(
        displayItems.sort(
          (left, right) => right.value.lastOpenedAt - left.value.lastOpenedAt,
        ),
      );
    } finally {
      if (request === revision.current) loading.current = false;
    }
  }, [library, mode]);
  /** 文件/离线页滚动到底部时读取下一页，并按 id 去除重叠结果。 */
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
      setItems((existingItems) => {
        const ids = new Set(
          existingItems
            .filter((item) => item.kind === "resource")
            .map((item) => item.value.id),
        );
        return [
          ...existingItems,
          ...rows
            .filter((resource) => !ids.has(resource.id))
            .map((value) => ({ kind: "resource" as const, value })),
        ].sort(
          (left, right) => right.value.lastOpenedAt - left.value.lastOpenedAt,
        );
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
  const choose = async (chooseDirectory: boolean) => {
    setBusy(chooseDirectory ? "正在授权目录…" : "正在导入文件与图片…");
    try {
      await ready;
      if (chooseDirectory) {
        const folder = await documents.chooseFolder();
        navigation.navigate("Directory", { id: folder.id });
      } else {
        const resource = await documents.chooseFile();
        navigation.navigate("Reader", { id: resource.id });
      }
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const open = (item: LibraryItem) =>
    item.kind === "resource"
      ? navigation.navigate("Reader", { id: item.value.id })
      : navigation.navigate("Directory", {
          id: item.value.id,
          path: item.value.lastPath,
        });
  const manage = (item: LibraryItem) => {
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
              subtitle={describeResource(item.value)}
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
