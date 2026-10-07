import React, { createContext, useContext, useEffect, useState } from "react";
import { openDatabaseAsync } from "expo-sqlite";
import { ActivityIndicator, Text, View, useColorScheme } from "react-native";
import { Library } from "../database/library";
import { Documents } from "../services/documents";
import { OfflinePages } from "../services/offline";
import { initializeFiles } from "../storage/files";
import { recover } from "../services/maintenance";

/** 所有页面共用的业务服务；ready 在数据库、运行时资源和恢复任务均完成后才结束。 */
type Services = {
  library: Library;
  documents: Documents;
  offline: OfflinePages;
  ready: Promise<void>;
};
const Context = createContext<Services | null>(null);

/** 在应用根部创建一次数据库和服务，并在初始化完成前展示加载状态。 */
export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const [services, setServices] = useState<Services | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const db = await openDatabaseAsync("rn-read.db");
      const library = new Library(db);
      await library.initialize();
      // 文件目录和离线 WebView 运行时代码必须先就绪，之后才扫描并修复中断任务。
      const ready = initializeFiles().then(() => recover(library));
      ready.catch((error) => {
        if (mounted) setError(String(error));
      });
      if (mounted)
        setServices({
          library,
          documents: new Documents(library),
          offline: new OfflinePages(library),
          ready,
        });
    })().catch((e) => {
      if (mounted) setError(String(e));
    });
    return () => {
      mounted = false;
    };
  }, []);
  if (error)
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text accessibilityRole="alert">初始化失败：{error}</Text>
      </View>
    );
  if (!services)
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator accessibilityLabel="正在加载资料库" />
      </View>
    );
  return <Context.Provider value={services}>{children}</Context.Provider>;
}

/** 获取全局服务；缺少 Provider 是程序装配错误，应尽早报出。 */
export function useServices() {
  const services = useContext(Context);
  if (!services) throw Error("ServicesProvider missing");
  return services;
}

/** 返回遵循系统明暗模式的调色板，供页面和通用组件共用。 */
export function usePalette() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    colors: dark
      ? {
          bg: "#152029",
          card: "#1f2e39",
          text: "#edf2f5",
          muted: "#b0bec8",
          border: "#3a4b57",
          primary: "#8ac7ef",
          onPrimary: "#102330",
          danger: "#ff9995",
        }
      : {
          bg: "#f8f7f3",
          card: "#ffffff",
          text: "#20313f",
          muted: "#566878",
          border: "#d9e0e4",
          primary: "#235b82",
          onPrimary: "#ffffff",
          danger: "#ab302b",
        },
  };
}
