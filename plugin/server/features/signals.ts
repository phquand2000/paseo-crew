import type { PluginServerContext } from "@getpaseo/plugin/server";
import { on } from "../hooks.ts";
import { projectRoot, seatFor, sweepMs } from "../kit.ts";
import { clock } from "../log.ts";
import { attention, logFields } from "../messages.ts";
import type { Runtime } from "../runtime.ts";
import { outputText } from "../timeline.ts";

export type Marker = { trigger: string; what: string; lines: string[] };

const MARKERS = [
  { trigger: "decision", what: "a ruling was recorded", pattern: /^[ \t>*-]*DECISION:.*$/gm },
  { trigger: "detour", what: "a missing foundation paused a slice", pattern: /^[ \t>*-]*DETOUR:.*$/gm },
  { trigger: "handoff", what: "a handoff block was written", pattern: /^[ \t>*#-]*HANDOFF\b.*$/gm },
];
const PUSHBACK = /^[ \t>*`-]*(REOPEN_REQUEST|DEPENDENCY_REQUEST|BLOCKED)\b.*$/m;

export function findMarkers(text: string): Marker[] {
  return MARKERS.map((marker) => ({
    trigger: marker.trigger,
    what: marker.what,
    lines: (text.match(marker.pattern) ?? []).map((line) => line.trim()),
  })).filter((marker) => marker.lines.length > 0);
}

export function findPushback(text: string): string | undefined {
  return PUSHBACK.exec(text)?.[0].trim();
}

export function register(server: PluginServerContext, runtime: Runtime): void {
  const pushbacks = new Map<string, { root: string; role: string; quote: string; at: number }>();

  on(server, "signals", "agent.turn_started", ({ agent }) => {
    pushbacks.delete(agent.id);
    runtime.cancel(`pushback:${agent.id}`);
  });

  on(server, "signals", "agent.turn_ended", async (event, { paseo }) => {
    const kit = runtime.kit();
    const seat = kit ? seatFor(kit, event.agent.provider) : undefined;
    const root = projectRoot(event.agent.cwd);
    if (!kit || !seat || seat.entry || !root) return;
    const agentId = event.agent.id;
    if (event.outcome.kind === "failed") {
      const message = event.outcome.error.message;
      await runtime.raise(
        paseo,
        root,
        attention({ trigger: "stall", agentId, role: seat.role, what: `its turn failed: ${message}` }),
        logFields(agentId, seat.role, "stall", message),
      );
    }
    if (seat.sweepMinutes) return;
    const text = outputText(event.timeline);
    for (const marker of findMarkers(text)) {
      await runtime.raise(
        paseo,
        root,
        attention({
          trigger: marker.trigger,
          agentId,
          role: seat.role,
          what: marker.what,
          quote: marker.lines.slice(0, 10).join("\n"),
          where: `activity around ${clock()}`,
        }),
        logFields(agentId, seat.role, marker.trigger, marker.lines[0]),
      );
    }
    const quote = findPushback(text);
    if (!quote) return;
    pushbacks.set(agentId, { root, role: seat.role, quote, at: Date.now() });
    runtime.later(`pushback:${agentId}`, 2 * sweepMs(kit), async () => {
      const entry = pushbacks.get(agentId);
      if (!entry) return;
      pushbacks.delete(agentId);
      const minutes = Math.round((Date.now() - entry.at) / 60_000);
      await runtime.raise(
        paseo,
        entry.root,
        attention({
          trigger: "unanswered pushback",
          agentId,
          role: entry.role,
          what: `no prompt reached it for ${minutes} minutes after it pushed back`,
          quote: entry.quote,
          where: `activity around ${clock(new Date(entry.at))}`,
        }),
        logFields(agentId, entry.role, "unanswered pushback", entry.quote),
      );
    });
  });
}
