import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { deliver, findSeat, logLine } from "./attention";
import { type Kit, projectRoot, seatFor } from "./kit";

type PaseoApi = PluginHookContext["paseo"];
type Requested = PluginLifecycleEvents["agent.permission_requested"];
type Resolved = PluginLifecycleEvents["agent.permission_resolved"];

const routed = new Map<string, { root: string; fields: string }>();

export async function onPermissionRequested(paseo: PaseoApi, kit: Kit, event: Requested): Promise<void> {
  if (event.request.kind !== "question") return;
  const seat = seatFor(kit, event.agent.provider);
  const entry = kit.seats.find((candidate) => candidate.entry);
  const root = projectRoot(event.agent.cwd);
  if (!seat || !entry || !root || seat.role === entry.role) return;
  const fields = `${event.agent.id} (${seat.role})  question`;
  routed.set(event.request.id, { root, fields });
  const owner = await findSeat(paseo, root, entry.role);
  if (!owner) {
    logLine(root, `${fields}  -> no ${entry.role} running, left to the agent that started it`);
    return;
  }
  if (event.agent.parentAgentId === owner.id) {
    logLine(root, `${fields}  -> ${entry.role} started it and was told`);
    return;
  }
  const text = [
    `QUESTION: ${event.agent.id} (${seat.role}) is waiting on a question meant for the Human.`,
    'Choose the answer yourself unless it changes the project\'s concept, and send it with respond_to_permission using the agentId and requestId below: response {"behavior": "allow", "updatedInput": {"questions": <the request\'s questions>, "answers": {<each question\'s text, or "Response" when the request is a select>: <your choice>}}}.',
    `<permission-request>\n${JSON.stringify({ agentId: event.agent.id, requestId: event.request.id, request: event.request }, null, 2)}\n</permission-request>`,
  ].join("\n\n");
  let sent = false;
  await deliver(paseo, owner.id, text, false, () => {
    sent = true;
    logLine(root, `${fields}  -> sent to ${entry.role}`);
  });
  if (!sent) logLine(root, `${fields}  -> held for ${entry.role}`);
}

export function onPermissionResolved(event: Resolved): void {
  const entry = routed.get(event.requestId);
  if (!entry) return;
  routed.delete(event.requestId);
  const resolution = event.resolution as { behavior: string; message?: string; updatedInput?: { answers?: unknown } };
  const said =
    resolution.behavior === "allow"
      ? JSON.stringify(resolution.updatedInput?.answers ?? {}).slice(0, 160)
      : `"${(resolution.message ?? "").slice(0, 160)}"`;
  logLine(entry.root, `${entry.fields}  -> ${resolution.behavior === "allow" ? "answered" : "denied"}  ${said}`);
}
