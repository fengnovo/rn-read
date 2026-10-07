import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: vi.fn() },
  Platform: {
    select: (values: Record<string, unknown>) =>
      values.android ?? values.default,
  },
}));
vi.mock("@expo/vector-icons", async () => {
  const React = await import("react");
  return {
    Feather: (props: unknown) => React.createElement("Feather", props as any),
  };
});
vi.mock("../src/app/context", () => ({
  usePalette: () => ({
    colors: {
      bg: "#fff",
      card: "#fff",
      border: "#ddd",
      text: "#123",
      primary: "#246",
      onPrimary: "#fff",
      muted: "#789",
    },
  }),
}));
vi.mock("../src/services/documents", () => ({ cancelled: () => false }));

import { Action } from "../src/components/ui";

it("renders icon-only actions without visible text while keeping an accessible name and touch target", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      React.createElement(Action, {
        label: "后退",
        icon: "arrow-left",
        iconOnly: true,
        onPress: () => {},
      } as any),
    );
  });
  const pressable = tree.root.findByType("Pressable" as any);

  expect(pressable.props.accessibilityLabel).toBe("后退");
  expect(tree.root.findAllByType("Text" as any)).toHaveLength(0);
  expect(tree.root.findByType("Feather" as any).props.name).toBe("arrow-left");
  expect(
    pressable.props
      .style({ pressed: false })
      .flat()
      .some((style: any) => style?.minWidth >= 48 && style?.minHeight >= 48),
  ).toBe(true);
});
