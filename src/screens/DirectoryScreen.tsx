import React, { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStack } from "../app/navigation";
import type { Folder } from "../core/types";
import type { DocumentEntry } from "../../modules/document-access";
import { useServices, usePalette } from "../app/context";
import {
  Action,
  Busy,
  Empty,
  Row,
  styles,
  showError,
  formatSize,
} from "../components/ui";
export function DirectoryScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStack, "Directory">) {
  const { library, documents, ready } = useServices(),
    { colors } = usePalette();
  const path = route.params.path ?? "";
  const [folder, setFolder] = useState<Folder | null>(null),
    [entries, setEntries] = useState<DocumentEntry[]>([]),
    [busy, setBusy] = useState("读取目录…"),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setBusy("读取目录…");
    setError("");
    void (async () => {
      await ready;
      const f = (await library.folders()).find((f) => f.id === route.params.id);
      if (!f) throw Error("目录记录已移除");
      const data = await documents.list(f, path);
      if (live) {
        setFolder(f);
        setEntries(data);
        navigation.setOptions({ title: f.name });
      }
    })()
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy("");
      });
    return () => {
      live = false;
    };
  }, [route.params.id, path, library, documents, ready, navigation]);
  const open = async (entry: DocumentEntry) => {
    if (!folder) return;
    const target = [path, entry.name].filter(Boolean).join("/");
    if (entry.isDirectory) {
      navigation.push("Directory", { id: folder.id, path: target });
      return;
    }
    setBusy("正在保存本地副本…");
    try {
      const resource = await documents.openRelative(folder, target);
      navigation.navigate("Reader", { id: resource.id });
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.section, { color: colors.text }]}>
        {path || "根目录"}
      </Text>
      {path && (
        <View style={styles.actions}>
          <Action
            label="上一级"
            icon="corner-left-up"
            onPress={() =>
              navigation.replace("Directory", {
                id: route.params.id,
                path: path.split("/").slice(0, -1).join("/"),
              })
            }
          />
        </View>
      )}
      {busy && <Busy label={busy} />}
      <FlatList
        contentContainerStyle={styles.list}
        data={entries}
        keyExtractor={(e) => e.identity}
        ListEmptyComponent={
          !busy ? (
            <Empty
              title={error ? "目录暂时无法访问" : "目录为空"}
              detail={
                error
                  ? "检查网络或重新授权此目录。" + error
                  : "这个目录还没有文件。"
              }
            />
          ) : null
        }
        renderItem={({ item }) => (
          <Row
            title={item.name}
            icon={item.isDirectory ? "folder" : "file-text"}
            subtitle={
              item.isDirectory
                ? "文件夹"
                : item.size === null
                  ? "文件"
                  : formatSize(item.size)
            }
            onPress={() => {
              void open(item);
            }}
          />
        )}
      />
      {error && (
        <View style={styles.actions}>
          <Action
            label="重新选择目录"
            onPress={() => {
              void documents
                .chooseFolder(route.params.id)
                .then((f) => navigation.replace("Directory", { id: f.id }))
                .catch(showError);
            }}
          />
        </View>
      )}
    </View>
  );
}
