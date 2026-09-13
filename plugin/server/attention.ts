import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type Kit, projectRoot, roleOf, seatFor } from "./kit";

type PaseoApi = PluginHookContext["paseo"];
type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

const queued = new Map<string, string[]>();
const lastSweep = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function busy(status: string | null): boolean {
  return status === "running" || status === "initializing";
}

export async function deliver(paseo: PaseoApi, agentId: string, text: string, now = false): Promise<void> {
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  if (now || !busy(handle.status)) {
    await handle.send(text);
    return;
  }
  queued.set(agentId, [...(queued.get(agentId) ?? []), text]);
}

async function flush(paseo: PaseoApi, agentId: string): Promise<void> {
  const waiting = queued.get(agentId);
  if (!waiting || waiting.length === 0) return;
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  if (busy(handle.status)) return;
  queued.delete(agentId);
  await handle.send(waiting.join("\n\n"));
}

async function findSeat(paseo: PaseoApi, root: string, role: string) {
  const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
  return entries
    .map((entry) => entry.agent)
    .filter((agent) => !agent.archivedAt && roleOf(agent.provider) === role && projectRoot(agent.cwd) === root)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export function outputText(timeline: TurnEnded["timeline"]): string {
  let text = "";
  for (const item of timeline) {
    if (item.type === "user_message") text = "";
    else if (item.type === "assistant_message" && typeof item.text === "string") text += item.text;
  }
  return text;
}

export function attentionBlocks(text: string): string[] {
  return text
    .split(/^(?=ATTENTION(?: \(urgent\))?:)/m)
    .map((block) => block.trim())
    .filter((block) => /^ATTENTION(?: \(urgent\))?:/.test(block));
}

async function sweep(paseo: PaseoApi, kit: Kit, root: string): Promise<void> {
  const seat = kit.seats.find((entry) => entry.sweepMinutes);
  if (!seat?.sweepMinutes) return;
  const every = seat.sweepMinutes * 60_000;
  const wait = (lastSweep.get(root) ?? 0) + every - Date.now();
  const later = (ms: number) => {
    if (timers.has(root)) return;
    timers.set(
      root,
      setTimeout(() => {
        timers.delete(root);
        void sweep(paseo, kit, root).catch((error) => console.error("sweep failed", error));
      }, ms),
    );
  };
  if (wait > 0) return later(wait);
  const watcher = await findSeat(paseo, root, seat.role);
  if (!watcher) return;
  if (busy(watcher.status)) return later(60_000);
  lastSweep.set(root, Date.now());
  await paseo.agents.ref(watcher.id).send("SWEEP");
}

export async function onTurnEnded(paseo: PaseoApi, kit: Kit, event: TurnEnded): Promise<void> {
  await flush(paseo, event.agent.id);
  const seat = seatFor(kit, event.agent.provider);
  const root = projectRoot(event.agent.cwd);
  if (!seat || seat.entry || !root) return;
  const entry = kit.seats.find((candidate) => candidate.entry);
  const toEntry = async (text: string, now = false) => {
    if (!entry) return;
    const supervisor = await findSeat(paseo, root, entry.role);
    if (supervisor) await deliver(paseo, supervisor.id, text, now);
  };
  if (event.outcome.kind === "failed") {
    await toEntry(
      `ATTENTION: stall in ${event.agent.id} (${seat.role})\nWhat: its turn failed: ${event.outcome.error.message}`,
    );
  }
  if (seat.sweepMinutes) {
    for (const block of attentionBlocks(outputText(event.timeline))) {
      await toEntry(block, block.startsWith("ATTENTION (urgent):"));
    }
    return;
  }
  await sweep(paseo, kit, root);
}

export function stopTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
