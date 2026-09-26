import type { Kit } from "../catalog/kit/kit.ts";
import { providerId } from "../catalog/kit/roles.ts";
import { type Team, rulesFor, skillDirsFor } from "../catalog/team/team.ts";
import { transportOf } from "../catalog/team/mcp-states.ts";
import type { Project } from "../desk/project.ts";
import type { TeamView } from "../../shared/views.ts";

/** The team as the panel reads it: each role's agent, model, servers, skills and rules, and each server's state. */
export function describeTeam(kit: Kit, team: Team, project?: Project): TeamView {
  return {
    project: project?.slug ?? null,
    errors: team.errors,
    attention: team.attention,
    rules: team.rules,
    mcp: Object.fromEntries(
      Object.entries(team.mcp).map(([id, state]) => [
        id,
        {
          label: state.label,
          enabled: state.enabled,
          roles: state.roles,
          settings: state.settings,
          transport: transportOf(state),
          template: Boolean(state.entry),
          connect: state.connect ?? null,
          rule: state.rule ?? null,
        },
      ]),
    ),
    roles: Object.fromEntries(
      Object.entries(team.roles).map(([name, seat]) => [
        name,
        {
          harness: seat.harness.id,
          provider: providerId(kit, name, seat.harness.id),
          model: seat.model?.id ?? null,
          thinking: seat.thinking ?? null,
          mcp: seat.mcp,
          tools: Object.fromEntries(
            seat.mcp.map((id) => [id, (team.mcp[id]!.tools ?? team.mcp[id]!.entry?.tools)?.[name] ?? []]),
          ),
          skills: [...skillDirsFor(team, name).keys()],
          rules: rulesFor(team, name),
        },
      ]),
    ),
  };
}
