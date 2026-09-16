import { existsSync, statSync } from "node:fs";
import { type Kit, providerId, supportsRole } from "../catalog/kit.ts";
import { type Layer, MachineLayerSchema, ProjectLayerSchema, type SettingsView, type WriteResult, readLayer, writeLayer } from "../catalog/settings.ts";
import { type Team, eligibleRoles, resolveTeam, rulesFor, skillDirsFor, transportOf } from "../catalog/team.ts";
import { type PaseoApi, openSeats } from "../core/paseo.ts";
import { loadLedger } from "../desk/ledger.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import { type Check, doctor } from "./doctor.ts";
import type { Control } from "./rpc.ts";
import type { Seating } from "./seating.ts";
import type { TeamSource } from "./team-source.ts";

type Target = { file: string; schema: typeof MachineLayerSchema | typeof ProjectLayerSchema; project?: Project };

const unknownProject = (slug: string) => `No project named ${slug} has been seen on this machine.`;

export function describeCatalog(kit: Kit): unknown {
  return {
    roles: kit.roles.map((role) => ({
      id: role.role,
      label: role.label,
      description: role.description ?? "",
      team: role.team ?? null,
      headless: Boolean(role.headless),
      defaults: role.defaults,
      harnesses: Object.values(kit.harnesses)
        .filter((harness) => supportsRole(kit, harness, role) && (!role.headless || Boolean(harness.headless)))
        .map((harness) => harness.id),
    })),
    harnesses: Object.values(kit.harnesses).map((harness) => ({
      id: harness.id,
      label: harness.label,
      models: harness.models ?? [],
      thinking: harness.hasThinking !== false,
      transports: harness.mcp.transports,
      headless: Boolean(harness.headless),
    })),
    mcp: Object.values(kit.mcp)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.description ?? "",
        kind: entry.kind,
        transport: transportOf(entry),
        settings: entry.settings,
        defaults: entry.defaults,
        roles: eligibleRoles(entry),
      })),
  };
}

export function describeTeam(kit: Kit, team: Team, project?: Project): unknown {
  return {
    project: project?.slug ?? null,
    errors: team.errors,
    limits: team.limits,
    attention: team.attention,
    rules: team.rules,
    mcp: Object.fromEntries(Object.entries(team.mcp).map(([id, state]) => [id, { enabled: state.enabled, roles: state.roles, settings: state.settings }])),
    roles: Object.fromEntries(
      Object.entries(team.roles).map(([name, seat]) => [
        name,
        {
          harness: seat.harness.id,
          provider: seat.role.headless ? null : providerId(kit, name, seat.harness.id),
          model: seat.model?.id ?? null,
          thinking: seat.thinking ?? null,
          mcp: seat.mcp,
          tools: Object.fromEntries(seat.mcp.map((id) => [id, team.mcp[id]!.entry.tools?.[name] ?? []])),
          skills: [...skillDirsFor(team, name).keys()],
          rules: rulesFor(team, name),
        },
      ]),
    ),
  };
}

export type ControlDeps = {
  kit: Kit;
  source: TeamSource;
  seating: Seating;
  reconcile: (team: Team) => void;
  api: () => PaseoApi | undefined;
};

export class SettingsControl implements Control {
  private readonly deps: ControlDeps;

  constructor(deps: ControlDeps) {
    this.deps = deps;
  }

  catalog(): unknown {
    return describeCatalog(this.deps.kit);
  }

  readSettings(slug?: string): SettingsView {
    const machine = slug ? this.deps.source.machineLayer() : {};
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", revision: "", error: target, machine };
    return { ...readLayer(target.file, target.schema), machine };
  }

  writeSettings(slug: string | undefined, revision: string, values: unknown): WriteResult {
    const { kit, source, seating, reconcile } = this.deps;
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", error: target };
    const check = (layer: Layer) => (target.project ? resolveTeam(kit, source.machineLayer(), layer) : resolveTeam(kit, layer)).errors;
    const result = writeLayer(target.file, target.schema, revision, values, check);
    if (result.status === "saved") {
      seating.forget();
      if (!target.project) reconcile(source.teamFor());
    }
    return result;
  }

  resetSettings(slug: string | undefined, revision: string): WriteResult {
    return this.writeSettings(slug, revision, {});
  }

  projects(): unknown {
    return this.deps.source.known().map((project) => ({ slug: project.slug, root: project.root }));
  }

  addProject(root: string): unknown {
    const path = root.trim();
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) return { error: `${path || "That path"} is not a directory on this machine.` };
    const project = projectOf(path);
    this.deps.source.record(project);
    return { slug: project.slug, root: project.root };
  }

  team(slug?: string): unknown {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return { errors: [unknownProject(slug)] };
    return describeTeam(this.deps.kit, this.deps.source.teamFor(project), project);
  }

  async doctor(slug?: string): Promise<Check[]> {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return [{ id: "project", ok: false, detail: unknownProject(slug) }];
    return doctor(this.deps.kit, this.deps.source.teamFor(project));
  }

  async status(slug: string): Promise<unknown> {
    const project = this.deps.source.named(slug);
    if (!project) return { text: "", error: unknownProject(slug) };
    const api = this.deps.api();
    const seats = new Map(api ? (await openSeats(api)).map((seat) => [seat.id, seat]) : []);
    return { text: statusText(project, loadLedger(project.state), loadConfig(project.state), seats, Date.now()) };
  }

  private target(slug?: string): Target | string {
    if (!slug) return { file: this.deps.source.machineFile(), schema: MachineLayerSchema };
    const project = this.deps.source.named(slug);
    if (!project) return unknownProject(slug);
    return { file: this.deps.source.projectFile(project), schema: ProjectLayerSchema, project };
  }
}
