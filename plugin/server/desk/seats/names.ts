import type { RoleSpec } from "../../catalog/kit/kit.ts";

/**
 * What Paseo shows a seat as. A plugin cannot rename an agent, and a seat has one duty for life, so the name fixed when it
 * starts says that duty: the lane or task, the seat's role, and its title.
 */
export const seatTitle = {
  of: (work: { id: string; title: string }, role: Pick<RoleSpec, "label">) =>
    `${work.id} · ${role.label} · ${work.title}`,
  review: (review: string, of: string) => `${review} · Review ${of}`,
};
