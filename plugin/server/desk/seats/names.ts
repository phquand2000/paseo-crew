import type { RoleSpec } from "../../catalog/kit/kit.ts";
import { type Ledger, taskOfPeer } from "../../domain/ledger.ts";

/**
 * What Paseo shows a seat as, fixed when it starts since a plugin cannot rename an agent: the lane or task, the seat's
 * role, and its title. A Peer kept for a task it then takes keeps its first name there.
 */
export const seatTitle = {
  of: (work: { id: string; title: string }, role: Pick<RoleSpec, "label">) =>
    `${work.id} · ${role.label} · ${work.title}`,
  review: (review: string, of: string) => `${review} · Review ${of}`,
};

/** What a letter calls a seat: a Peer by the task it works now, which its chat's name may no longer say, and an engineer to whoever reads it. */
export function seatName(ledger: Ledger, agent: { id: string; title?: string | null }, role: RoleSpec): string {
  const task = taskOfPeer(ledger, agent.id);
  if (task && task.kind !== "review") return `the engineer on ${task.id} (${task.title})`;
  return (agent.title ?? `${role.label} ${agent.id}`).replace(/\bPeer\b/g, "engineer");
}
