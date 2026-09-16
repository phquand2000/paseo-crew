import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { Check } from "./data.ts";

type Props = {
  project?: string;
  theme: PluginTheme;
  runDoctor(): Promise<Check[]>;
  readStatus(slug: string): Promise<{ text: string; error?: string }>;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function MachineSection({ project, theme, runDoctor, readStatus }: Props) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      report: { padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface1 },
      text: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
      good: { color: theme.colors.statusSuccess, fontSize: 13 },
      bad: { color: theme.colors.statusDanger, fontSize: 13 },
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

  const failing = (checks ?? []).filter((check) => !check.ok);
  return (
    <SettingsSection title="Health" info="What this machine still needs before the team can work.">
      <SettingsCard>
        <SettingsAction
          label="Doctor"
          hint={checks ? (failing.length === 0 ? "Everything the team needs is here." : `${failing.length} of ${checks.length} need work.`) : "Agents, tools and servers."}
          error={error}
          actionLabel={busy ? "Checking" : "Run"}
          disabled={busy}
          onPress={() => void run(async () => setChecks(await runDoctor()))}
        />
        {(checks ?? []).map((check) => (
          <SettingsRow key={check.id} label={check.id} hint={check.detail}>
            <Text style={check.ok ? styles.good : styles.bad}>{check.ok ? "OK" : "Needs work"}</Text>
          </SettingsRow>
        ))}
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
