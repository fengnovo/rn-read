import React, { createContext, useContext, useEffect, useState } from "react";
import { openDatabaseAsync } from "expo-sqlite";
import { ActivityIndicator, Text, View, useColorScheme } from "react-native";
import { Library } from "../database/library";
import { Documents } from "../services/documents";
import { OfflinePages } from "../services/offline";
import { initializeFiles } from "../storage/files";
import { recover } from "../services/maintenance";
type Services = {
  library: Library;
  documents: Documents;
  offline: OfflinePages;
  ready: Promise<void>;
};
const Context = createContext<Services | null>(null);
export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const [services, setServices] = useState<Services | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const db = await openDatabaseAsync("rn-read.db");
      const library = new Library(db);
      await library.initialize();
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
export function useServices() {
  const services = useContext(Context);
  if (!services) throw Error("ServicesProvider missing");
  return services;
}
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
