import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useServices, usePalette } from "../app/context";
import { Action, Busy, styles, formatSize, showError } from "../components/ui";
import * as files from "../storage/files";

/** 查看应用私有阅读数据占用，并清理可随时重新生成的 WebView 缓存。 */
export function SettingsScreen() {
  const { ready } = useServices(),
    { colors } = usePalette();
  const [sizes, setSizes] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false);
  /** 逐个统计正文、缓存和未完成事务目录的大小。 */
  const refresh = async () => {
    await ready;
    const result: Record<string, number> = {};
    for (const path of ["offline", "imported", "readers", "staging"])
      result[path] = await files.size(path);
    setSizes(result);
  };
  useEffect(() => {
    void refresh().catch(showError);
  }, [ready]);
  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ padding: 24, gap: 24 }}
    >
      <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>
        手机中的阅读资料
      </Text>
      {[
        ["offline", "离线网页"],
        ["imported", "文件副本"],
        ["readers", "阅读缓存"],
        ["staging", "临时文件"],
      ].map(([key, label]) => (
        <View
          key={key}
          style={{ flexDirection: "row", justifyContent: "space-between" }}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
          <Text style={{ color: colors.muted }}>
            {formatSize(sizes[key!] ?? 0)}
          </Text>
        </View>
      ))}
      <Action
        label="清理阅读缓存"
        icon="trash-2"
        disabled={busy}
        onPress={() =>
          Alert.alert(
            "清理阅读缓存",
            "已保存的网页和文件副本会保留；图表下次打开时重新渲染。",
            [
              { text: "取消", style: "cancel" },
              {
                text: "清理",
                onPress: () => {
                  setBusy(true);
                  void ready
                    .then(() => files.remove("readers"))
                    .then(() => files.mkdir("readers"))
                    .then(refresh)
                    .catch(showError)
                    .finally(() => setBusy(false));
                },
              },
            ],
          )
        }
      />
      {busy && <Busy label="正在清理…" />}
      <Text style={{ color: colors.muted, lineHeight: 24 }}>
        {"长按资料条目可删除对应本地副本。" +
          "目录授权不保证云端文件离线可访问；" +
          "导入后的文件副本可以直接从手机打开。"}
      </Text>
    </ScrollView>
  );
}
