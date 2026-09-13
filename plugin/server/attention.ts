import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type Kit, type Seat, projectRoot, roleOf, seatFor } from "./kit";

type PaseoApi = PluginHookContext["paseo"];
type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];
type TurnStarted = PluginLifecycleEvents["agent.turn_started"];
type Queued = { text: string; sent?: () => void };
type Pushback = { root: string; role: string; quote: string; at: number };

const MARKERS: { trigger: string; what: string; pattern: RegExp }[] = [
  { trigger: "decision", what: "a ruling was recorded", pattern: /^[ \t>*-]*DECISION:.*$/gm },
  { trigger: "detour", what: "a missing foundation paused a slice", pattern: /^[ \t>*-]*DETOUR:.*$/gm },
  { trigger: "handoff", what: "a handoff block was written", pattern: /^[ \t>*#-]*HANDOFF\b.*$/gm },
];
const PUSHBACK = /^[ \t>*`-]*(REOPEN_REQUEST|DEPENDENCY_REQUEST|BLOCKED)\b.*$/m;
const HEADER = /^ATTENTION(?: \((urgent|log)\))?: (.+?) in (\S+) \(([^)]+)\)[ \t]*$/m;

const queued = new Map<string, Queued[]>();
const lastSweep = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const streaks = new Map<string, Map<string, number>>();
const pushbacks = new Map<string, Pushback>();

const pad = (value: number) => String(value).padStart(2, "0");

function clock(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function logLine(root: string, line: string): void {
  const now = new Date();
  const dir = join(root, ".seatworks", "records", "attention");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${day}.md`), `${clock(now)}  ${line}\n`);
  } catch (error) {
    console.error("attention log write failed", error);
  }
}

function quoted(text: string): string {
  return `"${text.trim().split("\n")[0].replace(/"/g, "'").slice(0, 160)}"`;
}

function busy(status: string | null): boolean {
  return status === "running" || status === "initializing";
}

function later(key: string, ms: number, run: () => Promise<void>): void {
  if (timers.has(key)) return;
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void run().catch((error) => console.error(`${key} failed`, error));
    }, ms),
  );
}

export async function deliver(
  paseo: PaseoApi,
  agentId: string,
  text: string,
  now = false,
  sent?: () => void,
): Promise<void> {
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  if (now || !busy(handle.status)) {
    await handle.send(text);
    sent?.();
    return;
  }
  queued.set(agentId, [...(queued.get(agentId) ?? []), { text, sent }]);
}

async function flush(paseo: PaseoApi, agentId: string): Promise<void> {
  const waiting = queued.get(agentId);
  if (!waiting || waiting.length === 0) return;
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  if (busy(handle.status)) return;
  queued.delete(agentId);
  await handle.send(waiting.map((entry) => entry.text).join("\n\n"));
  for (const entry of waiting) entry.sent?.();
}

export async function findSeat(paseo: PaseoApi, root: string, role: string) {
  const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
  return entries
    .map((entry) => entry.agent)
    .filter((agent) => !agent.archivedAt && roleOf(agent.provider) === role && projectRoot(agent.cwd) === root)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

async function raise(paseo: PaseoApi, kit: Kit, root: string, text: string, fields: string, now = false): Promise<void> {
  const entry = kit.seats.find((seat) => seat.entry);
  const supervisor = entry ? await findSeat(paseo, root, entry.role) : undefined;
  if (!supervisor) {
    logLine(root, `${fields}  -> logged`);
    return;
  }
  let sent = false;
  await deliver(paseo, supervisor.id, text, now, () => {
    sent = true;
    logLine(root, `${fields}  -> sent`);
  });
  if (!sent) logLine(root, `${fields}  -> held`);
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
    .split(/^(?=ATTENTION(?: \((?:urgent|log)\))?:)/m)
    .map((block) => block.trim())
    .filter((block) => HEADER.test(block));
}

function every(kit: Kit): number {
  return (kit.seats.find((seat) => seat.sweepMinutes)?.sweepMinutes ?? 10) * 60_000;
}

async function overdue(paseo: PaseoApi, kit: Kit, agentId: string): Promise<void> {
  const entry = pushbacks.get(agentId);
  if (!entry) return;
  pushbacks.delete(agentId);
  const minutes = Math.round((Date.now() - entry.at) / 60_000);
  await raise(
    paseo,
    kit,
    entry.root,
    `ATTENTION: unanswered pushback in ${agentId} (${entry.role})\nWhat: no prompt reached it for ${minutes} minutes after it pushed back\nQuote: ${entry.quote}\nWhere: activity around ${clock(new Date(entry.at))}`,
    `${agentId} (${entry.role})  unanswered pushback  ${quoted(entry.quote)}`,
  );
}

async function markers(paseo: PaseoApi, kit: Kit, root: string, event: TurnEnded, seat: Seat): Promise<void> {
  const text = outputText(event.timeline);
  for (const marker of MARKERS) {
    const lines = (text.match(marker.pattern) ?? []).map((line) => line.trim());
    if (lines.length === 0) continue;
    await raise(
      paseo,
      kit,
      root,
      `ATTENTION: ${marker.trigger} in ${event.agent.id} (${seat.role})\nWhat: ${marker.what}\nQuote: ${lines.slice(0, 10).join("\n")}\nWhere: activity around ${clock()}`,
      `${event.agent.id} (${seat.role})  ${marker.trigger}  ${quoted(lines[0])}`,
    );
  }
  const pushback = PUSHBACK.exec(text);
  if (!pushback) return;
  pushbacks.set(event.agent.id, { root, role: seat.role, quote: pushback[0].trim(), at: Date.now() });
  later(`pushback:${event.agent.id}`, 2 * every(kit), () => overdue(paseo, kit, event.agent.id));
}

function lastUserText(timeline: TurnEnded["timeline"]): string {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index];
    if (item.type === "user_message" && typeof item.text === "string") return item.text;
  }
  return "";
}

async function watcherBlocks(paseo: PaseoApi, kit: Kit, root: string, event: TurnEnded): Promise<void> {
  const swept = lastUserText(event.timeline).trimStart().startsWith("SWEEP");
  const before = streaks.get(root) ?? new Map<string, number>();
  const seen = new Map<string, number>();
  for (const block of attentionBlocks(outputText(event.timeline))) {
    const [, kind, trigger, agentId, role] = HEADER.exec(block) ?? [];
    if (!trigger) continue;
    const quote = /^Quote:[ \t]*(.*)$/m.exec(block)?.[1] || block;
    const fields = `${agentId} (${role})  ${trigger}  ${quoted(quote)}`;
    if (kind === "log") {
      const key = `${agentId} ${trigger}`;
      const count = swept ? (before.get(key) ?? 0) + 1 : 0;
      if (swept) seen.set(key, count);
      if (count < 3) {
        logLine(root, `${fields}  -> logged`);
        continue;
      }
      await raise(paseo, kit, root, block.replace(/^ATTENTION \(log\):/, "ATTENTION:"), fields);
      continue;
    }
    await raise(paseo, kit, root, block, fields, kind === "urgent");
  }
  if (!swept) return;
  streaks.set(root, seen);
  logLine(root, "sweep");
}

async function sweep(paseo: PaseoApi, kit: Kit, root: string): Promise<void> {
  const seat = kit.seats.find((entry) => entry.sweepMinutes);
  if (!seat) return;
  const last = lastSweep.get(root);
  const wait = (last ?? 0) + every(kit) - Date.now();
  if (wait > 0) return later(`sweep:${root}`, wait, () => sweep(paseo, kit, root));
  const watcher = await findSeat(paseo, root, seat.role);
  if (!watcher) return;
  if (busy(watcher.status)) return later(`sweep:${root}`, 60_000, () => sweep(paseo, kit, root));
  const since = new Date(last ?? Date.now() - 2 * 3_600_000).toISOString();
  lastSweep.set(root, Date.now());
  await paseo.agents.ref(watcher.id).send(`SWEEP since ${since}`);
}

export function onTurnStarted(event: TurnStarted): void {
  pushbacks.delete(event.agent.id);
}

export async function onTurnEnded(paseo: PaseoApi, kit: Kit, event: TurnEnded): Promise<void> {
  await flush(paseo, event.agent.id);
  const seat = seatFor(kit, event.agent.provider);
  const root = projectRoot(event.agent.cwd);
  if (!seat || seat.entry || !root) return;
  if (event.outcome.kind === "failed") {
    const message = event.outcome.error.message;
    await raise(
      paseo,
      kit,
      root,
      `ATTENTION: stall in ${event.agent.id} (${seat.role})\nWhat: its turn failed: ${message}`,
      `${event.agent.id} (${seat.role})  stall  ${quoted(message)}`,
    );
  }
  if (seat.sweepMinutes) {
    await watcherBlocks(paseo, kit, root, event);
    return;
  }
  await markers(paseo, kit, root, event, seat);
  await sweep(paseo, kit, root);
}

export function stopTimers(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
