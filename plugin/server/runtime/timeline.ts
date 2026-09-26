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
