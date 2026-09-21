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

/** `follows` is the label of the role a role follows while nothing is set for it. */
export function sourceLabel(source: Source, layer: "machine" | "project", follows?: string): string {
  if (source === "here") return layer === "machine" ? "Set here" : "Set for this project";
  if (source === "machine") return "From this machine";
  return follows ? `Not set · follows the ${follows}` : "Catalog default";
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

/**
 * A group's heading inside a card, in capitals: THIS MACHINE, WORTH A LOOK. The Health tab drew its
 * own and the watch card needed the same, so there is one.
 */
export function Heading({ text, theme, tone = "muted" }: { text: string; theme: PluginTheme; tone?: "muted" | "danger" }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6 }}>
      <Text style={{ color: tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500", letterSpacing: 0.6, textTransform: "uppercase" }}>{text}</Text>
    </View>
  );
}

/** A row's divider, the card's own border colour. */
export function Rule({ theme }: { theme: PluginTheme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

/** A state marker: running, idle, worth a look, irreversible. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** A small pill for a level or a mark: page, attend, useful, told. */
export function Tag({ text, color, theme }: { text: string; color: string; theme: PluginTheme }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: theme.colors.surface2 }}>
      <Text style={{ color, fontSize: 12, fontWeight: "500" }}>{text}</Text>
    </View>
  );
}

/** A number and what it counts, side by side in one inset strip. */
export function Stats({ items, theme }: { items: { value: string; label: string }[]; theme: PluginTheme }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1, borderRadius: 8, backgroundColor: theme.colors.surface1, overflow: "hidden" }}>
      {items.map((item) => (
        <View key={item.label} style={{ flexGrow: 1, flexBasis: 120, paddingHorizontal: 14, paddingVertical: 12, gap: 2, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "500" }}>{item.value}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A ? beside a title, for what the words on the card mean. Drawn, so it needs no icon set. */
export function Help({ label, theme, onPress }: { label: string; theme: PluginTheme; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? CONTROL.pressed : 1,
      })}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontWeight: "500", lineHeight: 12 }}>?</Text>
    </Pressable>
  );
}

/** A number in a table column: right-aligned, one line, a fixed width so the columns line up. */
export function Cell({ text, width, color, strong }: { text: string; width: number; color: string; strong?: boolean }) {
  return (
    <Text numberOfLines={1} style={{ width, textAlign: "right", color, fontSize: 13, fontWeight: strong ? "500" : "normal" }}>
      {text}
    </Text>
  );
}
