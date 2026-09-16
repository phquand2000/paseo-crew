import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Source } from "./data.ts";

export function sourceLabel(source: Source, layer: "machine" | "project"): string {
  if (source === "here") return layer === "machine" ? "Set here" : "Set for this project";
  if (source === "machine") return "From this machine";
  return "Catalog default";
}

export function Revert({ theme, disabled, onPress }: { theme: PluginTheme; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Revert this to the layer below"
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Revert</Text>
    </Pressable>
  );
}

export function Chips({ options, chosen, theme, disabled, onToggle }: {
  options: { id: string; label: string }[];
  chosen: string[];
  theme: PluginTheme;
  disabled?: boolean;
  onToggle(id: string, on: boolean): void;
}) {
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, paddingVertical: 4 },
      chip: { minHeight: 32, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border },
      on: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      text: { color: theme.colors.foregroundMuted, fontSize: 13 },
      textOn: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const on = chosen.includes(option.id);
        return (
          <Pressable
            key={option.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: Boolean(disabled) }}
            accessibilityLabel={option.label}
            disabled={disabled}
            style={[styles.chip, on ? styles.on : null]}
            onPress={() => onToggle(option.id, !on)}
          >
            <Text style={[styles.text, on ? styles.textOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ title, body, theme }: { title: string; body: string; theme: PluginTheme }) {
  const styles = useMemo(
    () => ({
      box: { padding: 24, gap: 6, alignItems: "center" as const },
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
      body: { color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

export function Facts({ items, theme }: { items: { label: string; value: string }[]; theme: PluginTheme }) {
  const styles = useMemo(
    () => ({
      box: { gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
      line: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: 16 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      value: { color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1, textAlign: "right" as const },
    }),
    [theme],
  );
  return (
    <View style={styles.box}>
      {items.map((item) => (
        <View key={item.label} style={styles.line}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
