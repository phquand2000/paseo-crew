import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { Empty } from "./bits.tsx";
import { reportRpc } from "../../shared/rpc.ts";
import type { ReportItem } from "../../shared/views.ts";
import { useProjectRead } from "../state/reads.ts";

const ago = (minutes: number): string => (minutes < 1 ? "just now" : minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`);

function Part({ title, hint, items, none }: { title: string; hint: string; items: ReportItem[]; none?: string }) {
  if (items.length === 0 && !none) return null;
  return (
    <SettingsCard>
      <SettingsRow label={title} hint={items.length === 0 ? none : hint} />
      {items.map((item) => (
        <SettingsRow key={item.title} label={item.title} hint={`${item.detail} · ${ago(item.minutes)}`} />
      ))}
    </SettingsCard>
  );
}

function ProjectReport({ project, theme }: { project: string; theme: PluginTheme }) {
  const { value, error, reload } = useProjectRead(reportRpc, project);
  if (error) return <SettingsCard><Empty theme={theme} title="The report could not be read" body={error} /></SettingsCard>;
  if (!value) return <SettingsCard><Empty theme={theme} title="Reading the record" body="The last day of this project, from its ledger and incidents." /></SettingsCard>;
  return (
    <>
      <Part title="Needs you" hint="On Flow, where you answer them." items={value.needs} none="Nothing waits for you." />
      <Part title="Went ahead on its recommendation" hint="Questions you have not answered that could be undone; tell the Supervisor to turn one back." items={value.ahead} />
      <Part title="Landed" hint="On the base in your copy; push it when you are ready." items={value.landed} />
      <Part title="Beyond a lane" hint="What could not be undone, and what was done about it." items={value.beyond} />
      <SettingsCard>
        {value.numbers.map((row) => (
          <SettingsRow key={row.title} label={row.title} hint={row.detail}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{row.value}</Text>
          </SettingsRow>
        ))}
        <SettingsAction label="Read it again" hint="It is read once when you open this tab." actionLabel="Read" onPress={reload} />
      </SettingsCard>
    </>
  );
}

/** The project's last day for the Human, from its record alone: no agent writes a word of it. */
export function ReportSection({ project, theme }: { project?: string; theme: PluginTheme }) {
  return (
    <SettingsSection title="Report" info="Read from the record, not written by an agent: the last day of this project.">
      {project ? <ProjectReport project={project} theme={theme} /> : <SettingsCard><Empty theme={theme} title="A report is a project's" body="Open a project to read its last day." /></SettingsCard>}
    </SettingsSection>
  );
}
