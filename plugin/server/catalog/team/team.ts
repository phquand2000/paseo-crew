import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Layer } from "../../../shared/settings.ts";
import type { Attention } from "../../../shared/views.ts";
import type { HarnessSpec, Kit, SensorSpec } from "../kit/kit.ts";
import { type McpState, resolveMcp } from "./mcp-states.ts";
import { type RoleSeat, presetOn, resolveRole } from "./role-seats.ts";
import { can } from "../kit/roles.ts";

/** Who answers the watch's questions, as the settings chose: a sensor, and its key where a settings layer keeps one, or a seat of a role that can judge. */
type JudgeChoice = { id: string; sensor: SensorSpec; key?: string } | { id: string; role: string };

/** The kit as the machine's and the project's settings leave it: each role's seat, the MCP servers, attention and the judge. */
export type Team = {
  roles: Record<string, RoleSeat>;
  mcp: Record<string, McpState>;
  attention: Attention;
  judge?: JudgeChoice;
  rules: string;
  errors: string[];
};

/** `unread` layers are reported, since resolving to nothing looked like a complete team the owner never wrote. */
export function resolveTeam(kit: Kit, machine: Layer = {}, project: Layer = {}, unread: string[] = []): Team {
  const errors: string[] = [...unread];
  const layers = [machine, project];
  layers.forEach((layer, index) => {
    const where = index === 0 ? "The machine settings" : "The project settings";
    for (const name of Object.keys(layer.roles ?? {}))
      if (!kit.roles.some((role) => role.role === name)) errors.push(`${where} name an unknown role ${name}`);
  });
  const mcp = resolveMcp(kit, layers, errors);
  const roles = resolveRoles(kit, layers, mcp, errors);
  const attention = { ...kit.attention, ...stripUndefined(machine.attention), ...stripUndefined(project.attention) };
  return {
    roles,
    mcp,
    attention,
    judge: judgeOf(kit, attention.judge, layers, errors),
    rules: [machine.rules, project.rules].filter((text) => text && text.trim()).join("\n\n"),
    errors,
  };
}

/** Each role's seat; a role that follows another starts from what that role has in force. */
function resolveRoles(
  kit: Kit,
  layers: Layer[],
  mcp: Record<string, McpState>,
  errors: string[],
): Record<string, RoleSeat> {
  const own: Record<string, RoleSeat> = {};
  for (const role of kit.roles) {
    if (role.follows !== undefined) continue;
    const seat = resolveRole(kit, role, layers, mcp, errors);
    if (seat) own[role.role] = seat;
  }
  const roles: Record<string, RoleSeat> = {};
  for (const role of kit.roles) {
    const followed = role.follows === undefined ? undefined : own[role.follows];
    const origin = followed
      ? { harness: followed.harness.id, model: followed.model?.id, thinking: followed.thinking }
      : undefined;
    const seat = role.follows === undefined ? own[role.role] : resolveRole(kit, role, layers, mcp, errors, origin);
    if (seat) roles[role.role] = seat;
  }
  return roles;
}

function judgeOf(kit: Kit, id: string, layers: Layer[], errors: string[]): JudgeChoice | undefined {
  if (id === "off") return undefined;
  const sensor = kit.sensors[id];
  const judges = kit.roles.filter((role) => can(role, "judge")).map((role) => role.role);
  if (!sensor) {
    if (judges.includes(id)) return { id, role: id };
    errors.push(
      `The watch is set to be judged by ${id}, which is neither off, a sensor the kit knows nor a role that can judge (${[...Object.keys(kit.sensors), ...judges].join(", ") || "none"})`,
    );
    return undefined;
  }
  const key = layers
    .map((layer) => layer.sensor?.[id]?.key)
    .filter(Boolean)
    .at(-1);
  return { id, sensor, ...(key ? { key } : {}) };
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** The team with one role moved to another harness: its preset where the harness is its own, else that harness's default. */
export function withHarness(team: Team, roleName: string, harness: HarnessSpec): Team {
  const seat = team.roles[roleName];
  if (!seat || seat.harness.id === harness.id) return team;
  const roles = Object.values(team.roles).map((entry) => entry.role);
  const { model, thinking } = presetOn(seat.role, harness, roles);
  return { ...team, roles: { ...team.roles, [roleName]: { ...seat, harness, model, thinking } } };
}

/** A server needing what the project lacks (an IDE's folder) is switched off, or a Peer is told to use a tool that cannot answer. */
export function servingProject(team: Team, root: string): Team {
  const lacking = new Set(
    Object.values(team.mcp)
      .filter((state) => state.enabled && (state.entry?.requires ?? []).some((path) => !existsSync(join(root, path))))
      .map((state) => state.id),
  );
  if (lacking.size === 0) return team;
  return {
    ...team,
    mcp: Object.fromEntries(
      Object.entries(team.mcp).map(([id, state]) => [id, lacking.has(id) ? { ...state, enabled: false } : state]),
    ),
    roles: Object.fromEntries(
      Object.entries(team.roles).map(([name, seat]) => [
        name,
        { ...seat, mcp: seat.mcp.filter((id) => !lacking.has(id)) },
      ]),
    ),
  };
}

export function rulesFor(team: Team, roleName: string): string {
  const seat = team.roles[roleName];
  if (!seat) return "";
  const parts: string[] = [];
  for (const id of seat.mcp) {
    const state = team.mcp[id]!;
    const { entry } = state;
    const lines: string[] = [];
    const rule = state.rule ?? (entry?.rule ? readFileSync(join(entry.dir, entry.rule), "utf-8").trim() : "");
    if (rule.trim()) lines.push(rule.trim());
    const tools = entry?.kind === "proxy" ? ((state.tools ?? entry.tools)?.[roleName] ?? []) : [];
    if (tools.length > 0) lines.push(`Your ${state.label} tools: ${tools.map((tool) => `\`${tool}\``).join(", ")}.`);
    const note = entry?.roleNotes?.[roleName];
    if (note) lines.push(note);
    if (lines.length > 0) parts.push(lines.join("\n\n"));
  }
  if (team.rules) parts.push(`## Rules from the Human\n\n${team.rules.trim()}`);
  if (seat.rules) parts.push(`## Rules from the Human, for the ${seat.role.label}\n\n${seat.rules}`);
  return parts.length > 0 ? `# Working rules\n\n${parts.join("\n\n")}\n` : "";
}

export function skillDirsFor(team: Team, roleName: string): Map<string, string> {
  const found = new Map<string, string>();
  const seat = team.roles[roleName];
  if (!seat) return found;
  for (const id of seat.mcp) {
    const { entry } = team.mcp[id]!;
    if (entry) for (const skill of entry.skills ?? []) found.set(skill, join(entry.dir, "skills", skill));
  }
  return found;
}
