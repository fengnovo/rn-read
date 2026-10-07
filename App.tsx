import React from "react";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { ServicesProvider, usePalette } from "./src/app/context";
import type { RootStack, Tabs } from "./src/app/navigation";
import { LibraryScreen } from "./src/screens/LibraryScreen";
import { DirectoryScreen } from "./src/screens/DirectoryScreen";
import { ReaderScreen, DiagramScreen } from "./src/screens/ReaderScreen";
import { BrowserScreen } from "./src/screens/BrowserScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { Action } from "./src/components/ui";
const Stack = createNativeStackNavigator<RootStack>(),
  Tab = createBottomTabNavigator<Tabs>();
const Recent = () => <LibraryScreen mode="recent" />,
  Files = () => <LibraryScreen mode="files" />,
  Offline = () => <LibraryScreen mode="offline" />;
function Home() {
  const { colors } = usePalette();
  return (
    <Tab.Navigator
      initialRouteName="Recent"
      screenOptions={({ route, navigation }) => ({
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="存储管理"
            onPress={() => navigation.getParent()?.navigate("Settings")}
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather
              name="settings"
              accessible={false}
              color={colors.primary}
              size={22}
            />
          </Pressable>
        ),
        tabBarIcon: ({ color, size }) => (
          <Feather
            accessible={false}
            color={color}
            size={size}
            name={
              {
                Recent: "clock",
                Files: "folder",
                Offline: "download",
                Browser: "globe",
              }[route.name] as "clock"
            }
          />
        ),
      })}
    >
      <Tab.Screen
        name="Recent"
        component={Recent}
        options={{ title: "最近阅读" }}
      />
      <Tab.Screen name="Files" component={Files} options={{ title: "文件" }} />
      <Tab.Screen
        name="Offline"
        component={Offline}
        options={{ title: "离线" }}
      />
      <Tab.Screen
        name="Browser"
        component={BrowserScreen}
        options={{ title: "浏览" }}
      />
    </Tab.Navigator>
  );
}
function Navigation() {
  const { dark, colors } = usePalette();
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      theme={{
        ...base,
        colors: {
          ...base.colors,
          background: colors.bg,
          card: colors.card,
          text: colors.text,
          border: colors.border,
          primary: colors.primary,
        },
      }}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="Home"
          component={Home}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Reader"
          component={ReaderScreen}
          options={{ title: "阅读" }}
        />
        <Stack.Screen
          name="Directory"
          component={DirectoryScreen}
          options={{ title: "文件夹" }}
        />
        <Stack.Screen
          name="Diagram"
          component={DiagramScreen}
          options={({navigation})=>({
            title: "图表",
            presentation: "fullScreenModal",
            headerBackTitle: "返回",
            headerLeft:()=> <Action label="关闭" icon="x" onPress={()=>navigation.goBack()}/>,
          })}
        />
        <Stack.Screen
          name="BrowserPage"
          component={BrowserScreen}
          options={{ title: "浏览网页" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: "存储管理" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <Navigation />
      </ServicesProvider>
    </SafeAreaProvider>
  );
}
