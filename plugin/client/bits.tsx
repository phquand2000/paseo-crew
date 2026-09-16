import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { Source } from "./data.ts";

/**
 * Paseo's own button geometry, read from the app's control tokens: a small button is
 * CONTROL_HEIGHTS.compact tall, spacing[3] wide, borderRadius.md round, with fontSize.base text at
 * fontWeight.normal. The SDK exports no button, so anything outside a SettingsAction row is drawn
 * here; these numbers keep it the same control.
 */
export const CONTROL = { radius: 6, height: 32, padding: 12, gap: 8, font: 14, pressed: 0.85, faded: 0.5 };

export function sourceLabel(source: Source, layer: "machine" | "project"): string {
  if (source === "here") return layer === "machine" ? "Set here" : "Set for this project";
  if (source === "machine") return "From this machine";
  return "Catalog default";
}

export function Button({ label, theme, tone = "plain", disabled, onPress }: {
  label: string;
  theme: PluginTheme;
  tone?: "plain" | "accent";
  disabled?: boolean;
  onPress(): void;
}) {
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: CONTROL.gap,
        minHeight: CONTROL.height,
        paddingHorizontal: CONTROL.padding,
        borderRadius: CONTROL.radius,
        borderWidth: 1,
        borderColor: tone === "accent" ? theme.colors.accent : theme.colors.border,
        backgroundColor: tone === "accent" ? theme.colors.accent : "transparent",
      },
      label: {
        fontSize: CONTROL.font,
        fontWeight: "normal" as const,
        color: tone === "accent" ? theme.colors.accentForeground : theme.colors.foreground,
      },
    }),
    [theme, tone],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, disabled ? { opacity: CONTROL.faded } : pressed ? { opacity: CONTROL.pressed } : null]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({ letter, theme }: { letter: string; theme: PluginTheme }) {
  return (
    <View
      style={{
        width: CONTROL.height,
        height: CONTROL.height,
        borderRadius: CONTROL.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{letter.toUpperCase()}</Text>
    </View>
  );
}

export function Badge({ label, tone, theme }: { label: string; tone: "good" | "quiet"; theme: PluginTheme }) {
  return (
    <View style={{ paddingHorizontal: CONTROL.padding, paddingVertical: 4, borderRadius: CONTROL.radius, borderWidth: 1, borderColor: theme.colors.border }}>
      <Text style={{ fontSize: 12, color: tone === "good" ? theme.colors.statusSuccess : theme.colors.foregroundMuted }}>{label}</Text>
    </View>
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
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: CONTROL.gap },
      chip: {
        minHeight: CONTROL.height,
        paddingHorizontal: CONTROL.padding,
        borderRadius: CONTROL.radius,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      on: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
      text: { color: theme.colors.foreground, fontSize: CONTROL.font, fontWeight: "normal" as const },
      textOn: { color: theme.colors.accentForeground },
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
            style={({ pressed }) => [styles.chip, on ? styles.on : null, disabled ? { opacity: CONTROL.faded } : pressed ? { opacity: CONTROL.pressed } : null]}
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
      title: { color: theme.colors.foreground, fontSize: 15, fontWeight: "500" as const },
      body: { color: theme.colors.foregroundMuted, fontSize: 14, textAlign: "center" as const },
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
