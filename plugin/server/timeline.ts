import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type Timeline = PluginLifecycleEvents["agent.turn_ended"]["timeline"];

type Item = { type: string; text?: unknown; status?: unknown; error?: unknown; name?: unknown; detail?: unknown };

function items(timeline: Timeline): Item[] {
  return timeline as unknown as Item[];
}

function lastUserIndex(list: Item[]): number {
  for (let index = list.length - 1; index >= 0; index--) if (list[index]?.type === "user_message") return index;
  return -1;
}

export function outputText(timeline: Timeline): string {
  const list = items(timeline);
  return list
    .slice(lastUserIndex(list) + 1)
    .filter((item) => item.type === "assistant_message" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
}

const REFUSED = /permission|denied|not allowed|refused|blocked by/i;

export function deniedCall(timeline: Timeline, quietChars = 200): string | undefined {
  const list = items(timeline);
  const turn = list.slice(lastUserIndex(list) + 1);
  let lastTool = -1;
  for (let index = turn.length - 1; index >= 0; index--) {
    if (turn[index]?.type === "tool_call") {
      lastTool = index;
      break;
    }
  }
  if (lastTool < 0) return undefined;
  const call = turn[lastTool];
  if (!call || call.status !== "failed" || !REFUSED.test(JSON.stringify(call.error ?? ""))) return undefined;
  const after = turn
    .slice(lastTool + 1)
    .filter((item) => item.type === "assistant_message" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("");
  if (after.trim().length > quietChars) return undefined;
  const detail = (call.detail ?? {}) as Record<string, unknown>;
  const what = typeof detail.command === "string" ? detail.command : typeof detail.filePath === "string" ? detail.filePath : "";
  return [String(call.name ?? "tool"), what].filter(Boolean).join(": ");
}
