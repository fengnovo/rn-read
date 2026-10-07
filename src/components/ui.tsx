import React from "react";
import {
  Pressable,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { usePalette } from "../app/context";
import { cancelled } from "../services/documents";

/** 忽略系统文件选择器的主动取消，其余错误统一用原生提示呈现。 */
export function showError(error: unknown) {
  if (!cancelled(error))
    Alert.alert(
      "无法完成操作",
      error instanceof Error ? error.message : String(error),
    );
}

/** 可复用操作按钮；iconOnly 仍保留 label 作为无障碍描述。 */
export function Action({
  label,
  onPress,
  icon,
  disabled = false,
  primary = false,
  iconOnly = false,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>["name"];
  disabled?: boolean;
  primary?: boolean;
  iconOnly?: boolean;
}) {
  const { colors } = usePalette();
  const iconTarget =
    Platform.select({ ios: 44, android: 48, default: 48 }) ?? 48;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        iconOnly && {
          width: iconTarget,
          minWidth: iconTarget,
          height: iconTarget,
          minHeight: iconTarget,
          paddingHorizontal: 0,
          paddingVertical: 0,
          borderWidth: 0,
          borderRadius: iconTarget / 2,
        },
        {
          backgroundColor: iconOnly
            ? "transparent"
            : primary
              ? colors.primary
              : colors.card,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
      hitSlop={iconOnly ? { top: 2, bottom: 2, left: 2, right: 2 } : undefined}
    >
      {icon && (
        <Feather
          accessible={false}
          name={icon}
          size={iconOnly ? 22 : 20}
          color={
            iconOnly
              ? colors.primary
              : primary
                ? colors.onPrimary
                : colors.primary
          }
        />
      )}
      {!iconOnly && (
        <Text
          style={{
            color: primary ? colors.onPrimary : colors.text,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** 空列表的统一插画、标题和说明布局。 */
export function Empty({ title, detail }: { title: string; detail: string }) {
  const { colors } = usePalette();
  return (
    <View style={styles.empty}>
      <Feather
        accessible={false}
        name="book-open"
        color={colors.muted}
        size={40}
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text
        style={{ color: colors.muted, lineHeight: 24, textAlign: "center" }}
      >
        {detail}
      </Text>
    </View>
  );
}

/** 长任务的统一进度提示；label 由调用页面提供具体阶段。 */
export function Busy({ label }: { label: string }) {
  const { colors } = usePalette();
  return (
    <View
      accessibilityRole="progressbar"
      style={[styles.busy, { backgroundColor: colors.card }]}
    >
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.text, flex: 1 }}>{label}</Text>
    </View>
  );
}

/** 资料库和目录列表的统一条目；长按回调由页面提供管理菜单。 */
export function Row({
  title,
  subtitle,
  icon,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}，${subtitle}`}
      accessibilityHint={onLongPress ? "长按显示管理操作" : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={[styles.fileIcon, { backgroundColor: colors.bg }]}>
        <Feather
          accessible={false}
          name={icon}
          size={24}
          color={colors.primary}
        />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          numberOfLines={2}
          style={{ fontSize: 16, fontWeight: "600", color: colors.text }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}
        >
          {subtitle}
        </Text>
      </View>
      <Feather
        accessible={false}
        name="chevron-right"
        size={20}
        color={colors.muted}
      />
    </Pressable>
  );
}

/** 页面共享的布局样式，颜色由组件根据当前系统主题注入。 */
export const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  row: {
    padding: 14,
    gap: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 80,
  },
  fileIcon: {
    width: 44,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16 },
  empty: { padding: 36, gap: 16, alignItems: "center" },
  emptyTitle: { fontSize: 20, fontWeight: "600" },
  busy: { padding: 16, flexDirection: "row", gap: 12, alignItems: "center" },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    fontSize: 14,
    fontWeight: "600",
  },
  hint: { paddingHorizontal: 16, paddingBottom: 12, lineHeight: 22 },
});

/** 用适合列表展示的单位格式化字节数。 */
export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
