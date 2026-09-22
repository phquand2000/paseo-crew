import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { Avatar, Button, Rule } from "./bits.tsx";
import type { Catalog, ProjectRow, TeamView } from "./data.ts";

export const MACHINE = "machine";

type Props = {
  projects: ProjectRow[];
  nameOf(slug: string, root: string): string;
  catalog: Catalog;
  team: TeamView;
  waiting: number;
  theme: PluginTheme;
  disabled: boolean;
  onOpen(target: string): void;
  onSetup(): void;
};

export function ProjectList({ projects, nameOf, catalog, team, waiting, theme, disabled, onOpen, onSetup }: Props) {
  const styles = useMemo(
    () => ({
      header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 16 },
      titles: { flex: 1, gap: 4 },
      title: { color: theme.colors.foreground, fontSize: 20, fontWeight: "600" as const },
      sub: { color: theme.colors.foregroundMuted, fontSize: 12 },
      card: { borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, overflow: "hidden" as const },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 64 },
      labels: { flex: 1, gap: 4 },
      name: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
      trailing: { color: theme.colors.foregroundMuted, fontSize: 12 },
      chevron: { color: theme.colors.foregroundMuted, fontSize: 16 },
    }),
    [theme],
  );

  // The team names a harness by id; every other screen shows the catalog's label for it.
  const labelled = new Map(catalog.harnesses.map((harness) => [harness.id, harness.label]));
  const agents = [...new Set(Object.values(team.roles).map((seat) => labelled.get(seat.harness) ?? seat.harness))].join(" · ");
  const row = (key: string, letter: string, name: string, detail: string, trailing: string, target: string, last: boolean) => (
    <View key={key}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={disabled} style={styles.row} onPress={() => onOpen(target)}>
        <Avatar letter={letter} theme={theme} />
        <View style={styles.labels}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      {last ? null : <Rule theme={theme} />}
    </View>
  );

  return (
    <View style={{ gap: 24 }}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.title}>Seatworks</Text>
          <Text style={styles.sub}>Pick a project, or edit the defaults this machine uses.</Text>
        </View>
        <Button label="Add project" tone="accent" theme={theme} disabled={disabled} onPress={onSetup} />
      </View>
      <View style={styles.card}>
        {row("machine", "M", "Machine defaults", "Used by every project that sets nothing of its own", agents, MACHINE, projects.length === 0)}
        {projects.map((project, index) =>
          row(project.slug, nameOf(project.slug, project.root).slice(0, 1), nameOf(project.slug, project.root), project.root, "", project.slug, index === projects.length - 1),
        )}
      </View>
      <Text style={styles.sub}>{waiting > 0 ? `${waiting} more repository${waiting === 1 ? "" : " choices"} Paseo knows can be set up.` : "Set up any repository on this machine with Add project."}</Text>
    </View>
  );
}
