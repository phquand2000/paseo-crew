import type { AttentionChoice, Layer, McpChoice, RoleChoice } from "../../shared/settings.ts";

export type Source = "here" | "machine" | "default";

export function sourceOf(values: Layer, machine: Layer, pick: (layer: Layer) => unknown, layer: "machine" | "project"): Source {
  if (pick(values) !== undefined) return "here";
  if (layer === "project" && pick(machine) !== undefined) return "machine";
  return "default";
}

function prune<T extends object>(values: Layer, key: "roles" | "mcp", id: string, entry: T): Layer {
  const group = { ...(values[key] as Record<string, T> | undefined) };
  if (Object.keys(entry).length === 0) delete group[id];
  else group[id] = entry;
  const next = { ...values };
  if (Object.keys(group).length === 0) delete next[key];
  else (next[key] as Record<string, T>) = group;
  return next;
}

/** Folds a setup draft into a project's layer; a role moved to another agent must drop the old agent's model, which nothing downstream fences. */
export function foldRoles(into: Layer, draft: Layer, harnessNow: (role: string) => string | undefined): Layer {
  return Object.entries(draft.roles ?? {}).reduce((values, [role, choice]) => {
    // Only a named harness counts as replaced; an unrecorded one is the kit default, whose picked model must survive.
    const now = harnessNow(role);
    const moved = Boolean(choice.harness) && now !== undefined && choice.harness !== now;
    return setRole(values, role, choice, moved);
  }, into);
}

export function setRole(values: Layer, role: string, choice: RoleChoice, newHarness = false): Layer {
  const current = values.roles?.[role] ?? {};
  // A new harness drops the old one's model and thinking, but not the seat's rules: those are the owner's writing.
  const base: RoleChoice = newHarness ? (current.rules ? { rules: current.rules } : {}) : current;
  return prune(values, "roles", role, { ...base, ...choice });
}

/** An emptied list is a narrowing to nobody, so a re-paste keeps it rather than hand the new token to every role. */
export function keptRoles(narrowed: string[] | undefined, reachable: string[]): string[] {
  return narrowed ? narrowed.filter((role) => reachable.includes(role)) : reachable;
}

export type InForce = { id: string; follows?: string | null; defaults: { harness: string; model?: string } };

/** Nearest layer first: draft, project, machine, kit default; skipping the middle two offered the wrong agent's models. */
export function harnessInForce(role: InForce, ...layers: (Layer | undefined)[]): string {
  for (const layer of layers) {
    const named = layer?.roles?.[role.id]?.harness;
    if (named) return named;
  }
  // The kit gave a follower the followed role's defaults, so that role's own walk ends in the same place.
  return role.follows ? harnessInForce({ id: role.follows, defaults: role.defaults }, ...layers) : role.defaults.harness;
}

/** Walked lowest layer up, as the resolver does: a layer naming another agent drops the models chosen below it. */
export function modelInForce(role: InForce, ...nearestFirst: (Layer | undefined)[]): string | undefined {
  // Where the resolver starts it: its defaults, or what the role it follows has in force.
  const followed = role.follows ? { id: role.follows, defaults: role.defaults } : undefined;
  const origin = followed ? { harness: harnessInForce(followed, ...nearestFirst), model: modelInForce(followed, ...nearestFirst) } : role.defaults;
  let harness = origin.harness;
  let model = origin.model;
  for (const layer of [...nearestFirst].reverse()) {
    const choice = layer?.roles?.[role.id];
    if (!choice) continue;
    if (choice.harness && choice.harness !== harness) {
      harness = choice.harness;
      model = choice.harness === origin.harness ? origin.model : undefined;
    }
    if (choice.model) model = choice.model;
  }
  return model;
}

/** The resolver does not fence models against the catalogue, so show the one in force and flag it when the agent does not list it. */
export function modelRow(model: string, models: { id: string; label: string }[]): { value: string; options: { label: string; value: string }[]; stray: boolean } {
  const known = models.map((entry) => ({ label: entry.label, value: entry.id }));
  const stray = Boolean(model) && !models.some((entry) => entry.id === model);
  return { value: model, stray, options: stray ? [...known, { label: model, value: model }] : known };
}

export function setAttention(values: Layer, choice: AttentionChoice): Layer {
  return { ...values, attention: { ...values.attention, ...choice } };
}

export function setFlow(values: Layer, choice: { live?: boolean; everySeconds?: number }): Layer {
  return { ...values, flow: { ...values.flow, ...choice } };
}

/** A pasted server has no kit template to re-enable it, so it is dropped, url and token with it, not marked removed. */
export function dropMcp(values: Layer, id: string): Layer {
  return prune(values, "mcp", id, {});
}

export function setMcp(values: Layer, id: string, choice: McpChoice): Layer {
  const current = values.mcp?.[id] ?? {};
  const settings = { ...current.settings, ...choice.settings };
  const entry: McpChoice = { ...current, ...choice };
  if (Object.keys(settings).length > 0) entry.settings = settings;
  else delete entry.settings;
  return prune(values, "mcp", id, entry);
}

/** A sensor's key set, or with `null` forgotten; the server keeps any other key the values show as KEPT. */
export function withKey(values: Layer, id: string, key: string | null): Layer {
  const { [id]: _was, ...others } = values.sensor ?? {};
  const sensor = key ? { ...others, [id]: { key } } : others;
  return { ...values, sensor: Object.keys(sensor).length > 0 ? sensor : undefined };
}
