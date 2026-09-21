import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

export type Tab = { id: string; label: string; count?: number };

export function TabBar({ tabs, active, theme, disabled, onPick }: {
  tabs: Tab[];
  active: string;
  theme: PluginTheme;
  disabled?: boolean;
  onPick(id: string): void;
}) {
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, flexShrink: 1, maxWidth: "100%" as const, gap: 2, padding: 2, minHeight: 32, borderRadius: 8, backgroundColor: theme.colors.surface1 },
      tab: { minHeight: 28, justifyContent: "center" as const, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
      on: { backgroundColor: theme.colors.surface2 },
      label: { color: theme.colors.foregroundMuted, fontSize: 14 },
      labelOn: { color: theme.colors.foreground },
    }),
    [theme],
  );
  return (
    <View style={styles.row}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: Boolean(disabled) }}
            accessibilityLabel={tab.label}
            disabled={disabled}
            style={[styles.tab, on ? styles.on : null]}
            onPress={() => onPick(tab.id)}
          >
            <Text style={[styles.label, on ? styles.labelOn : null]}>{typeof tab.count === "number" ? `${tab.label}  ${tab.count}` : tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
