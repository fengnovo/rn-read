import React, { useCallback, useRef, useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { usePalette, useServices } from "../app/context";
import type { RootStack } from "../app/navigation";
import type { Bookmark } from "../core/types";
import { Empty, Row, showError, styles } from "../components/ui";

/** 展示收藏的网址；点击重新打开，长按可以从收藏夹中移除。 */
export function FavoritesScreen() {
  const { library, ready } = useServices();
  const { colors } = usePalette();
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const refreshRevision = useRef(0);

  /** 每次进入收藏页时读取 SQLite，保证刚添加或移除的条目及时出现。 */
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    await ready;
    const latestBookmarks = await library.bookmarks();
    if (refreshRevision.current === revision) setBookmarks(latestBookmarks);
  }, [library, ready]);

  useFocusEffect(
    useCallback(() => {
      void refresh().catch(showError);
      return () => {
        refreshRevision.current++;
      };
    }, [refresh]),
  );

  /** 长按提供移除入口，避免把收藏操作和打开网页混在一个点击动作里。 */
  const manage = (bookmark: Bookmark) => {
    Alert.alert(bookmark.title, bookmark.url, [
      { text: "取消", style: "cancel" },
      {
        text: "取消收藏",
        style: "destructive",
        onPress: () => {
          void library
            .removeBookmark(bookmark.url)
            .then(refresh)
            .catch(showError);
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <FlatList
        data={bookmarks}
        keyExtractor={(bookmark) => bookmark.url}
        contentContainerStyle={styles.list}
        refreshing={false}
        onRefresh={() => {
          void refresh().catch(showError);
        }}
        ListEmptyComponent={
          <Empty
            title="还没有收藏网页"
            detail="在浏览器点收藏按钮，网页就会出现在这里。"
          />
        }
        renderItem={({ item }) => (
          <Row
            title={item.title}
            subtitle={item.url}
            icon="bookmark"
            onPress={() =>
              navigation.navigate("BrowserPage", { url: item.url })
            }
            onLongPress={() => manage(item)}
          />
        )}
      />
    </View>
  );
}
