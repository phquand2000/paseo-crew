import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Block } from "./markers.ts";
import { readJson, writeJson } from "./store.ts";

export type Ask = {
  id: string;
  agentId: string;
  title: string;
  kind: string;
  text: string;
  openedAt: number;
  remindedAt?: number;
  reminders: number;
};

export function askId(agentId: string, block: Pick<Block, "kind" | "text">): string {
  return `${agentId}:${createHash("sha1").update(`${block.kind}\n${block.text}`).digest("hex").slice(0, 12)}`;
}

export function settle(
  asks: Ask[],
  agentId: string,
  title: string,
  requests: Pick<Block, "kind" | "text">[],
  now: number,
): { asks: Ask[]; opened: Ask[]; closed: Ask[] } {
  const mine = asks.filter((ask) => ask.agentId === agentId);
  const others = asks.filter((ask) => ask.agentId !== agentId);
  const kept: Ask[] = [];
  const opened: Ask[] = [];
  for (const request of requests) {
    const id = askId(agentId, request);
    if (kept.some((ask) => ask.id === id)) continue;
    const existing = mine.find((ask) => ask.id === id);
    if (existing) kept.push({ ...existing, title });
    else {
      const ask: Ask = { id, agentId, title, kind: request.kind, text: request.text.slice(0, 1200), openedAt: now, reminders: 0 };
      kept.push(ask);
      opened.push(ask);
    }
  }
  const closed = mine.filter((ask) => !kept.some((entry) => entry.id === ask.id));
  return { asks: [...others, ...kept], opened, closed };
}

export function dueReminders(asks: Ask[], now: number, remindMs: number, maxReminders: number): Ask[] {
  return asks.filter((ask) => ask.reminders < maxReminders && now - (ask.remindedAt ?? ask.openedAt) >= remindMs);
}

export function markReminded(asks: Ask[], ids: Set<string>, now: number): Ask[] {
  return asks.map((ask) => (ids.has(ask.id) ? { ...ask, remindedAt: now, reminders: ask.reminders + 1 } : ask));
}

export function dropAgent(asks: Ask[], agentId: string): Ask[] {
  return asks.filter((ask) => ask.agentId !== agentId);
}

export function asksFile(state: string): string {
  return join(state, "asks.json");
}

export function loadAsks(state: string): Ask[] {
  const stored = readJson<Ask[]>(asksFile(state), []);
  return Array.isArray(stored) ? stored : [];
}

export function saveAsks(state: string, asks: Ask[]): void {
  writeJson(asksFile(state), asks);
}
