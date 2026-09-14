import { createHash } from "node:crypto";
import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import type { RoleSpec } from "./kit.ts";
import { type Block, blocks, clip, isRequest } from "./markers.ts";
import { letters } from "./messages.ts";
import { type Timeline, deniedCall, outputText } from "./timeline.ts";

export type TurnInput = {
  role: RoleSpec;
  agent: { id: string; title: string | null; parentAgentId: string | null };
  turnId: string | null;
  outcome: PluginTurnOutcome;
  timeline: Timeline;
};

export type Outgoing = { to: string; key: string; text: string };
export type Decision = { letters: Outgoing[]; requests: Block[] | null };

const HANDBACK_LIMIT = 3500;

function key(...parts: (string | null)[]): string {
  return createHash("sha1").update(parts.map((part) => part ?? "").join("\n")).digest("hex").slice(0, 16);
}

export function decide(input: TurnInput): Decision {
  const { role, agent, outcome, timeline, turnId } = input;
  if (outcome.kind === "canceled") return { letters: [], requests: null };
  const text = outputText(timeline);
  const found = role.reports === "blocks" ? blocks(text) : [];
  const requests = role.reports === "blocks" ? found.filter(isRequest) : null;
  const parent = agent.parentAgentId;
  if (!parent) return { letters: [], requests };
  const out: Outgoing[] = [];
  if (outcome.kind === "failed") {
    out.push({ to: parent, key: key(agent.id, turnId, "failed", outcome.error.message), text: letters.failed(agent.title, agent.id, role.role, outcome.error.message) });
    return { letters: out, requests };
  }
  const denied = deniedCall(timeline);
  if (denied) out.push({ to: parent, key: key(agent.id, turnId, "denied", denied), text: letters.denied(agent.title, agent.id, role.role, denied) });
  if (role.reports === "blocks" && found.length > 0) {
    const body = clip(found.map((block) => block.text).join("\n\n"), HANDBACK_LIMIT).text;
    out.push({ to: parent, key: key(agent.id, "blocks", body), text: letters.fromLead(agent.title, agent.id, body) });
  }
  if (role.reports === "handback" && text.trim().length > 0) {
    const body = clip(text.trim(), HANDBACK_LIMIT).text;
    out.push({ to: parent, key: key(agent.id, "handback", body), text: letters.handback(agent.title, agent.id, body) });
  }
  return { letters: out, requests };
}
