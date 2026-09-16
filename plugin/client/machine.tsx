import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
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

  return (
    <SettingsSection title="Machine" info="What this machine still needs, and what the project is doing.">
      <SettingsCard>
        <SettingsAction
          label="Doctor"
          hint="Checks the agents, tools and servers this team needs."
          error={error}
          actionLabel={busy ? "Checking" : "Run"}
          disabled={busy}
          onPress={() => void run(async () => setChecks(await runDoctor()))}
        />
        {(checks ?? []).map((check) => (
          <SettingsRow key={check.id} label={`${check.ok ? "OK" : "Needs work"} · ${check.id}`} hint={check.detail} />
        ))}
      </SettingsCard>
      {project ? (
        <SettingsCard>
          <SettingsAction
            label="Status"
            hint={`What ${project} is doing right now.`}
            actionLabel={busy ? "Reading" : "Read"}
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const answer = await readStatus(project);
                setStatus(answer.error ?? answer.text);
              })
            }
          />
          {status ? <Text style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 }}>{status}</Text> : null}
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
