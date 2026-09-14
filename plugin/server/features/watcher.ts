import type { PluginServerContext } from "@getpaseo/plugin/server";
import { type PaseoApi, on } from "../hooks.ts";
import { projectRoot, seatFor, sweepMs, watcherSeat } from "../kit.ts";
import { ATTENTION_HEADER, type AttentionKind, logFields, sweepPrompt } from "../messages.ts";
import type { Runtime } from "../runtime.ts";
import { lastUserText, outputText } from "../timeline.ts";

export type Block = { kind?: AttentionKind; trigger: string; agentId: string; role: string; quote: string; text: string };
export type Step = { block: Block; send?: string; now: boolean };

const ESCALATE_AFTER = 3;

export function attentionBlocks(text: string): Block[] {
  return text
    .split(/^(?=ATTENTION(?: \((?:urgent|log)\))?:)/m)
    .map((block) => block.trim())
    .flatMap((block) => {
      const [, kind, trigger, agentId, role] = ATTENTION_HEADER.exec(block) ?? [];
      if (!trigger || !agentId || !role) return [];
      const quote = /^Quote:[ \t]*(.*)$/m.exec(block)?.[1] || block;
      return [{ kind: kind as AttentionKind | undefined, trigger, agentId, role, quote, text: block }];
    });
}

export function planBlocks(
  blocks: Block[],
  swept: boolean,
  before: Map<string, number>,
): { steps: Step[]; seen: Map<string, number> } {
  const seen = new Map<string, number>();
  const steps = blocks.map((block): Step => {
    if (block.kind !== "log") return { block, send: block.text, now: block.kind === "urgent" };
    const key = `${block.agentId} ${block.trigger}`;
    const count = swept ? (before.get(key) ?? 0) + 1 : 0;
    if (swept) seen.set(key, count);
    if (count < ESCALATE_AFTER) return { block, now: false };
    return { block, send: block.text.replace(/^ATTENTION \(log\):/, "ATTENTION:"), now: false };
  });
  return { steps, seen };
}

export function register(server: PluginServerContext, runtime: Runtime): void {
  const streaks = new Map<string, Map<string, number>>();
  const lastSweep = new Map<string, number>();

  const sweep = async (paseo: PaseoApi, root: string): Promise<void> => {
    const kit = runtime.kit();
    const seat = kit ? watcherSeat(kit) : undefined;
    if (!kit || !seat) return;
    const last = lastSweep.get(root);
    const wait = (last ?? 0) + sweepMs(kit) - Date.now();
    if (wait > 0) return runtime.later(`sweep:${root}`, wait, () => sweep(paseo, root));
    const watcher = await runtime.findSeat(paseo, root, seat.role);
    if (!watcher) return;
    const since = new Date(last ?? Date.now() - 2 * 3_600_000);
    if (!(await runtime.sendNow(paseo, watcher.id, sweepPrompt(since)))) {
      return runtime.later(`sweep:${root}`, 60_000, () => sweep(paseo, root));
    }
    lastSweep.set(root, Date.now());
  };

  on(server, "watcher", "agent.turn_ended", async (event, { paseo }) => {
    const kit = runtime.kit();
    const seat = kit ? seatFor(kit, event.agent.provider) : undefined;
    const root = projectRoot(event.agent.cwd);
    if (!kit || !seat || seat.entry || !root) return;
    if (!seat.sweepMinutes) {
      await sweep(paseo, root);
      return;
    }
    const swept = lastUserText(event.timeline).trimStart().startsWith("SWEEP");
    const blocks = attentionBlocks(outputText(event.timeline));
    const { steps, seen } = planBlocks(blocks, swept, streaks.get(root) ?? new Map());
    for (const { block, send, now } of steps) {
      const fields = logFields(block.agentId, block.role, block.trigger, block.quote);
      if (send === undefined) runtime.log(root, `${fields}  -> logged`);
      else await runtime.raise(paseo, root, send, fields, now);
    }
    if (!swept) return;
    streaks.set(root, seen);
    runtime.log(root, "sweep");
  });
}
