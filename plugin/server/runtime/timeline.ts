import type { HarnessSpec } from "../catalog/kit/kit.ts";
import type { TimelineItem } from "../core/ports.ts";

type Timeline = readonly TimelineItem[];

function lastUserIndex(list: Timeline): number {
  for (let index = list.length - 1; index >= 0; index--) if (list[index]?.type === "user_message") return index;
  return -1;
}

export function lastToolCall(timeline: Timeline): Record<string, unknown> | undefined {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index];
    if (item?.type === "user_message") return undefined;
    if (item?.type === "tool_call")
      return { name: item.name, status: item.status, error: item.error, detail: item.detail };
  }
  return undefined;
}

export function outputText(timeline: Timeline): string {
  return timeline
    .slice(lastUserIndex(timeline) + 1)
    .filter((item) => item.type === "assistant_message" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
}

/** The turn's last assistant message alone: an agent's stop notice follows whatever it said earlier in the turn. */
export function lastWords(timeline: Timeline): string {
  const turn = timeline.slice(lastUserIndex(timeline) + 1);
  for (let index = turn.length - 1; index >= 0; index--) {
    const item = turn[index];
    if (item?.type === "assistant_message" && typeof item.text === "string") return item.text;
  }
  return "";
}

/** Whether the agent stopped on its usage limit, by the words its harness stops with; `resets` is when, as the agent put it. */
export function limitStop(harness: HarnessSpec, said: string): { resets: string | null } | undefined {
  const limit = harness.timeline?.limit;
  const found = limit ? new RegExp(limit, "i").exec(said.trim()) : null;
  return found ? { resets: found.groups?.resets?.trim() || null } : undefined;
}

/** Whether its agent's provider turned the turn away rather than the work failing it, by the words its harness fails with. */
export function troubleOf(harness: HarnessSpec, said: string): "signedOut" | "transient" | undefined {
  const words = harness.timeline;
  if (words?.signedOut && new RegExp(words.signedOut, "i").test(said)) return "signedOut";
  if (words?.transient && new RegExp(words.transient, "i").test(said)) return "transient";
  return undefined;
}

/** The background jobs a harness said it started and has not said finished, oldest first: it wakes the seat as each one ends. */
export function pendingJobs(
  timeline: Timeline,
  background: { launched: string; notified: string } | undefined,
): string[] {
  if (!background) return [];
  const launched = new RegExp(background.launched);
  const pending: string[] = [];
  for (const item of timeline) {
    if (item.type !== "tool_call") continue;
    // A notice names no job, and a call in the foreground may have one too: it settles the oldest, so a doubt reads as none.
    if (item.name === background.notified) {
      pending.shift();
      continue;
    }
    const id = launched.exec(JSON.stringify(item.detail ?? null))?.groups?.id;
    if (id && !pending.includes(id)) pending.push(id);
  }
  return pending;
}

const QUIET_CHARS = 200;

/** What ended the turn on its last tool call: a refusal, or a call that simply never finished. */
type LastCall = { what: string; refused: boolean };

export function deniedCall(timeline: Timeline, refused: string): LastCall | undefined {
  const turn = timeline.slice(lastUserIndex(timeline) + 1);
  let lastTool = -1;
  for (let index = turn.length - 1; index >= 0; index--) {
    if (turn[index]?.type === "tool_call") {
      lastTool = index;
      break;
    }
  }
  if (lastTool < 0) return undefined;
  const call = turn[lastTool];
  if (!call) return undefined;
  const denied = call.status === "failed" && new RegExp(refused, "i").test(JSON.stringify(call.error ?? ""));
  const unanswered =
    call.status !== "completed" && turn.slice(lastTool + 1).every((item) => item.type !== "assistant_message");
  if (!denied && !unanswered) return undefined;
  const after = turn
    .slice(lastTool + 1)
    .filter((item) => item.type === "assistant_message" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
  if (after.trim().length > QUIET_CHARS) return undefined;
  const detail = (call.detail ?? {}) as Record<string, unknown>;
  const what =
    typeof detail.command === "string" ? detail.command : typeof detail.filePath === "string" ? detail.filePath : "";
  return { what: [toolName(call), what].filter(Boolean).join(": "), refused: denied };
}

const QUOTE_CHARS = 300;

const toolName = (item: TimelineItem): string => (typeof item.name === "string" ? item.name : "tool");

type Malformed = { tool: string; quote: string };

/** Tool calls whose input was not JSON, by the marks the harness leaves on them: it refused them, so nothing else reports them. */
export function malformed(timeline: Timeline, unparsed: { input: string; error: string } | undefined): Malformed[] {
  if (!unparsed) return [];
  const notJson = new RegExp(unparsed.error);
  // This turn only: Paseo hands the whole session, so one bad call would be found again every turn.
  return timeline.slice(lastUserIndex(timeline) + 1).flatMap((item) => {
    if (item.type !== "tool_call" || item.status !== "failed") return [];
    // The input only, never `output`: a tool's own output may print these strings legitimately.
    const sent = JSON.stringify((item.detail as { input?: unknown } | undefined)?.input ?? null);
    const said = JSON.stringify(item.error ?? null).replace(/\\[nrt]/g, " ");
    if (!sent.includes(unparsed.input) && !notJson.test(said)) return [];
    return [{ tool: toolName(item), quote: (notJson.test(said) ? said : sent).slice(0, QUOTE_CHARS) }];
  });
}
