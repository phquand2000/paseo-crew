import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";

export type Timeline = PluginLifecycleEvents["agent.turn_ended"]["timeline"];

export function outputText(timeline: Timeline): string {
  let text = "";
  for (const item of timeline) {
    if (item.type === "user_message") text = "";
    else if (item.type === "assistant_message" && typeof item.text === "string") text += item.text;
  }
  return text;
}

export function lastUserText(timeline: Timeline): string {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index];
    if (item && item.type === "user_message" && typeof item.text === "string") return item.text;
  }
  return "";
}
