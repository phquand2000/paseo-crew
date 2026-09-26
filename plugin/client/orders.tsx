import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { Empty } from "./bits.tsx";
import { ordersRpc } from "../shared/rpc.ts";
import type { OrdersView } from "../shared/views.ts";
import { useProjectRead } from "./reads.ts";

const HOMES: Record<string, string> = {
  onBranch: "On the branch your copy is on, carried on where it is.",
  newBranch: "On a new branch off the base, in your own copy.",
  isolate: "In a copy of their own; yours is left alone.",
};

function Orders({ orders, theme }: { orders: OrdersView; theme: PluginTheme }) {
  const { fault, askFirst, riskRules, ownRules, laneHome, concept } = orders;
  return (
    <>
      <SettingsCard>
        {fault ? <SettingsRow label="Your standing orders cannot be read" error={`${fault} Until they are fixed, every landing waits for you.`} /> : null}
        <SettingsRow label="Asked first" hint={askFirst.length > 0 ? "A landing that changes any of these waits for you on Flow. Nothing else makes one wait." : "Nothing: no landing waits for you."} />
        {askFirst.map((path) => (
          <SettingsRow key={path} label={path} />
        ))}
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label={`Risk rules · ${ownRules ? "this project's own" : "the kit's"}`} hint="A rule never holds a landing: its question goes to every review of a change there, and its rehearsal runs with the gate." />
        {riskRules.map((rule) => (
          <SettingsRow key={rule.paths.join()} label={rule.paths.join(", ")} hint={`${rule.reviewQuestion}${rule.rehearse ? ` Rehearsed by ${rule.rehearse}.` : " No rehearsal."}`} />
        ))}
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label="Where lanes work" hint={laneHome ? (HOMES[laneHome] ?? laneHome) : "Asked of you when your copy makes it a question."} />
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label="What the project does" hint={concept ? `CONTEXT.md, as the Supervisor wrote down what you settled; changed ${concept.minutes} min ago.` : "Nothing written yet: the Supervisor writes CONTEXT.md as you settle what the project does."} />
        {concept ? (
          <View style={{ padding: 16 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}>{`${concept.text}${concept.more ? "\n…" : ""}`}</Text>
          </View>
        ) : null}
      </SettingsCard>
    </>
  );
}

function ProjectOrders({ project, theme }: { project: string; theme: PluginTheme }) {
  const { value, error, reload } = useProjectRead(ordersRpc, project);
  if (error) return <SettingsCard><Empty theme={theme} title="The orders could not be read" body={error} /></SettingsCard>;
  if (!value) return <SettingsCard><Empty theme={theme} title="Reading the project" body="Your standing orders and what the project does." /></SettingsCard>;
  return (
    <>
      <Orders orders={value} theme={theme} />
      <SettingsCard>
        <SettingsAction label="Read them again" hint="They are read once when you open this tab." actionLabel="Read" onPress={reload} />
      </SettingsCard>
    </>
  );
}

/** What the Human settled for a project, to read: they change it by telling the Supervisor, who keeps it. */
export function OrdersSection({ project, theme }: { project?: string; theme: PluginTheme }) {
  return (
    <SettingsSection title="Orders" info="What you asked of this project. Tell the Supervisor to change it.">
      {project ? <ProjectOrders project={project} theme={theme} /> : <SettingsCard><Empty theme={theme} title="Orders are a project's" body="Open a project to read what you asked of it." /></SettingsCard>}
    </SettingsSection>
  );
}
