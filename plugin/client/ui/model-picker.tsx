import type { PluginTheme } from "@getpaseo/plugin";
import { FlatList, Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsRow } from "@getpaseo/plugin/client/ui";
import { useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { CONTROL } from "./bits.tsx";

type Option = { label: string; value: string };

type Props = {
  label: string;
  hint?: string;
  value: string;
  options: Option[];
  theme: PluginTheme;
  disabled?: boolean;
  onValueChange(value: string): void;
};

/** Matches the name or the id, so `glm` finds `zai/glm-5.3` and `sonnet` finds `Claude Sonnet 5`. */
function matching(options: Option[], query: string): Option[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const text = `${option.label} ${option.value}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

const BOX = { width: 420, height: 380, gap: 6, margin: 8 };

/** Searchable and floating like Paseo's own picker: an agent can list hundreds of models, and a transparent modal keeps cards from clipping it. */
export function ModelPicker({ label, hint, value, options, theme, disabled, onValueChange }: Props) {
  const [at, setAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [query, setQuery] = useState("");
  const anchor = useRef<View>(null);
  const window = useWindowDimensions();
  const shown = useMemo(() => matching(options, query), [options, query]);
  const current = options.find((option) => option.value === value);
  const open = at !== null;
  const styles = useMemo(
    () => ({
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: CONTROL.gap,
        minHeight: CONTROL.height,
        width: 220,
        paddingHorizontal: CONTROL.padding,
        borderRadius: CONTROL.radius,
        borderWidth: 1,
        borderColor: open ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      chosen: { flex: 1, color: theme.colors.foreground, fontSize: CONTROL.font },
      box: {
        position: "absolute" as const,
        width: BOX.width,
        maxHeight: BOX.height,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
        shadowColor: "#000",
        shadowOpacity: 0.35,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
      },
      search: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: theme.colors.border },
      input: { flex: 1, paddingVertical: 11, color: theme.colors.foreground, fontSize: CONTROL.font, outlineStyle: "none" as never },
      row: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
      picked: { backgroundColor: theme.colors.surface2 },
      name: { flexShrink: 0, maxWidth: "70%" as const, color: theme.colors.foreground, fontSize: CONTROL.font },
      id: { flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
      none: { padding: 12, color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, open],
  );

  const close = () => {
    setAt(null);
    setQuery("");
  };
  const pick = (next: string) => {
    close();
    if (next !== value) onValueChange(next);
  };
  const toggle = () => {
    if (open) return close();
    anchor.current?.measureInWindow((x, y, width, height) => setAt({ x, y, width, height }));
  };

  // Under the trigger and flush with its right edge, as Paseo's is; above it when the window has no room below.
  const place = at
    ? {
        left: Math.max(BOX.margin, Math.min(at.x + at.width - BOX.width, window.width - BOX.width - BOX.margin)),
        ...(window.height - (at.y + at.height) >= BOX.height + BOX.margin ? { top: at.y + at.height + BOX.gap } : { bottom: window.height - at.y + BOX.gap }),
      }
    : null;

  return (
    <SettingsRow label={label} hint={hint}>
      <View ref={anchor} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? value}`}
          accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
          disabled={disabled}
          onPress={toggle}
          style={[styles.trigger, disabled ? { opacity: CONTROL.faded } : null]}
        >
          <Text style={styles.chosen} numberOfLines={1}>
            {current?.label ?? value}
          </Text>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      <Modal transparent visible={open} animationType="none" onRequestClose={close}>
        <Pressable accessibilityLabel="Close the model list" style={StyleSheet.absoluteFill} onPress={close} />
        {place ? (
          <View style={[styles.box, place]}>
            <View style={styles.search}>
              <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search models…"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
                onSubmitEditing={() => shown.length > 0 && pick(shown[0]!.value)}
              />
            </View>
            <FlatList
              data={shown}
              keyExtractor={(option) => option.value}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={30}
              ListEmptyComponent={<Text style={styles.none}>{`No model matches “${query.trim()}”.`}</Text>}
              renderItem={({ item }) => (
                <Pressable accessibilityRole="button" onPress={() => pick(item.value)} style={({ pressed }) => [styles.row, item.value === value || pressed ? styles.picked : null]}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.label !== item.value ? (
                    <Text style={styles.id} numberOfLines={1}>
                      {item.value}
                    </Text>
                  ) : null}
                </Pressable>
              )}
            />
          </View>
        ) : null}
      </Modal>
    </SettingsRow>
  );
}
