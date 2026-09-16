import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

export type Tab = { id: string; label: string; hint?: string };

type Props = {
  tabs: Tab[];
  active: string;
  theme: PluginTheme;
  disabled?: boolean;
  onPick(id: string): void;
};

export function TabBar({ tabs, active, theme, disabled, onPick }: Props) {
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, padding: 4, borderRadius: 10, backgroundColor: theme.colors.surface1 },
      tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
      on: { backgroundColor: theme.colors.surface2 },
      label: { color: theme.colors.foregroundMuted, fontSize: 13 },
      labelOn: { color: theme.colors.foreground, fontWeight: "600" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
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
            <Text style={[styles.label, on ? styles.labelOn : null]}>{tab.label}</Text>
            {tab.hint ? <Text style={styles.hint}>{tab.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
