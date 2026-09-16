import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { TabBar } from "./tabs.tsx";

export type DetailTab = "team" | "agents" | "servers" | "health";

type Props = {
  title: string;
  subtitle: string;
  tab: DetailTab;
  theme: PluginTheme;
  disabled: boolean;
  onBack(): void;
  onTab(tab: DetailTab): void;
  onDetach?: () => void;
  children: ReactNode;
};

export function Detail({ title, subtitle, tab, theme, disabled, onBack, onTab, onDetach, children }: Props) {
  const styles = useMemo(
    () => ({
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12 },
      back: { minWidth: 32, minHeight: 32, alignItems: "center" as const, justifyContent: "center" as const },
      backText: { color: theme.colors.foregroundMuted, fontSize: 20 },
      titles: { flex: 1, gap: 3 },
      title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "600" as const },
      sub: { color: theme.colors.foregroundMuted, fontSize: 12 },
      detach: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: theme.colors.border, minHeight: 36, justifyContent: "center" as const },
      detachText: { color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "500" as const },
    }),
    [theme],
  );
  return (
    <View style={{ gap: 16 }}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the project list" style={styles.back} onPress={onBack}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.titles}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {onDetach ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Detach Seatworks from this project" disabled={disabled} style={styles.detach} onPress={onDetach}>
            <Text style={styles.detachText}>Detach</Text>
          </Pressable>
        ) : null}
      </View>
      <TabBar
        theme={theme}
        active={tab}
        disabled={disabled}
        onPick={(id) => onTab(id as DetailTab)}
        tabs={[
          { id: "team", label: "Team" },
          { id: "agents", label: "Agents" },
          { id: "servers", label: "Servers" },
          { id: "health", label: "Health" },
        ]}
      />
      {children}
    </View>
  );
}
