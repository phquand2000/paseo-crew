import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { Check } from "./data.ts";

type Props = {
  project?: string;
  theme: PluginTheme;
  checks: Check[] | null;
  onChecks(checks: Check[]): void;
  runDoctor(): Promise<Check[]>;
  readStatus(slug: string): Promise<{ text: string; error?: string }>;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const GROUPS = ["This machine", "Agents", "Servers"] as const;

const groupOf = (id: string): (typeof GROUPS)[number] => (id.startsWith("harness:") ? "Agents" : id.startsWith("mcp:") ? "Servers" : "This machine");

export function HealthSection({ project, theme, checks, onChecks, runDoctor, readStatus }: Props) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      report: { padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface2 },
      text: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
      heading: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
      headingText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.6 },
      good: { color: theme.colors.statusSuccess, fontSize: 12, fontWeight: "500" as const },
      bad: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "500" as const },
    }),
    [theme],
  );

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (problem) {
      setError(message(problem));
    } finally {
      setBusy(false);
    }
  };

  const all = checks ?? [];
  const failing = all.filter((check) => !check.ok);
  const summary = all.length === 0 ? "Agents, tools and servers." : failing.length === 0 ? `All ${all.length} pass. Everything the team needs is here.` : `${all.length - failing.length} of ${all.length} pass. ${failing.length} needs work.`;

  return (
    <SettingsSection title="Health" info="What this machine still needs before the team can work.">
      <SettingsCard>
        <SettingsAction
          label="Doctor"
          hint={summary}
          error={error}
          actionLabel={busy ? "Checking" : "Run"}
          disabled={busy}
          onPress={() => void run(async () => onChecks(await runDoctor()))}
        />
        {GROUPS.map((group) => {
          const mine = all.filter((check) => groupOf(check.id) === group);
          if (mine.length === 0) return null;
          return (
            <View key={group}>
              <View style={styles.heading}>
                <Text style={styles.headingText}>{group.toUpperCase()}</Text>
              </View>
              {mine.map((check) => (
                <SettingsRow key={check.id} label={check.id} hint={check.detail}>
                  <Text style={check.ok ? styles.good : styles.bad}>{check.ok ? "OK" : "Needs work"}</Text>
                </SettingsRow>
              ))}
            </View>
          );
        })}
      </SettingsCard>
      {project ? (
        <SettingsCard>
          <SettingsAction
            label="Status"
            hint="Lanes, tasks and open asks right now."
            actionLabel={busy ? "Reading" : "Read"}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const answer = await readStatus(project);
                setStatus(answer.error ?? answer.text);
              })
            }
          />
          {status ? (
            <View style={styles.report}>
              <Text style={styles.text}>{status.trim()}</Text>
            </View>
          ) : null}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
