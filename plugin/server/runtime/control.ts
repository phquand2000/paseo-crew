import { existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Kit, providerId, supportsRole } from "../catalog/kit.ts";
import { type Connect, type Layer, MachineLayerSchema, ProjectLayerSchema, type SettingsView, type WriteResult, readLayer, writeLayer } from "../catalog/settings.ts";
import { type Team, resolveTeam, rulesFor, skillDirsFor, templateRoles, transportOf } from "../catalog/team.ts";
import { gitCommonDir } from "../core/git.ts";
import { type PaseoApi, openSeats } from "../core/paseo.ts";
import { worktreeRoot } from "../core/paths.ts";
import { loadLedger } from "../desk/ledger.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import { type Check, doctor } from "./doctor.ts";
import type { Control } from "./rpc.ts";
import type { Seating } from "./seating.ts";
import type { TeamSource } from "./team-source.ts";

type Target = { file: string; schema: typeof MachineLayerSchema | typeof ProjectLayerSchema; project?: Project };

const unknownProject = (slug: string) => `No project named ${slug} has been seen on this machine.`;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strings = (value: unknown): string[] | undefined =>
  typeof value === "string" ? [value] : Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : undefined;

const pairs = (value: unknown): Record<string, string> | undefined =>
  isRecord(value) && Object.values(value).every((item) => typeof item === "string") ? (value as Record<string, string>) : undefined;

function connectFrom(value: unknown): Connect | string {
  if (!isRecord(value)) return "A server needs a JSON object with its connection details.";
  const raw = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const command = [...(strings(value.command) ?? []), ...(strings(value.args) ?? [])];
  const url = typeof value.url === "string" ? value.url : undefined;
  const type = raw === "local" || raw === "stdio" ? "stdio" : raw === "sse" ? "sse" : raw === "remote" || raw === "http" ? "http" : command.length > 0 ? "stdio" : url ? "http" : undefined;
  if (!type) return "Give the server a command to run or a url to reach.";
  if (type === "stdio") {
    if (command.length === 0) return "A local server needs a command to run.";
    const env = pairs(value.env);
    return { type, command, ...(env ? { env } : {}) };
  }
  if (!url) return "A remote server needs a url.";
  const headers = pairs(value.headers);
  return { type, url, ...(headers ? { headers } : {}) };
}

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
        transport: entry.kind === "proxy" ? "stdio" : (entry.server?.type ?? "stdio"),
        settings: entry.settings,
        defaults: entry.defaults,
        roles: templateRoles(entry),
        template: true,
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
          provider: seat.role.headless ? null : providerId(kit, name, seat.harness.id),
          model: seat.model?.id ?? null,
          thinking: seat.thinking ?? null,
          mcp: seat.mcp,
          tools: Object.fromEntries(seat.mcp.map((id) => [id, (team.mcp[id]!.tools ?? team.mcp[id]!.entry?.tools)?.[name] ?? []])),
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

  candidateProjects(roots: string[]): unknown {
    const attached = new Set(this.deps.source.known().map((project) => project.root));
    const worktrees = worktreeRoot();
    const keep: string[] = [];
    for (const given of roots) {
      const path = given.trim();
      if (!path || path === worktrees || path.startsWith(`${worktrees}/`)) continue;
      let real: string;
      try {
        if (!statSync(path).isDirectory()) continue;
        real = realpathSync(path);
      } catch {
        continue;
      }
      if (!gitCommonDir(real)) continue;
      const project = projectOf(real);
      if (project.root !== real || attached.has(project.root)) continue;
      keep.push(given);
    }
    return keep;
  }

  parseMcp(text: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { error: `That is not JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!isRecord(parsed)) return { error: "Paste a JSON object, not a list or a bare value." };
    const map = isRecord(parsed.mcp) ? parsed.mcp : isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
    if (map) {
      const names = Object.keys(map);
      if (names.length !== 1) return { error: `Paste one server at a time; this one names ${names.length}.` };
      const id = names[0]!;
      const connect = connectFrom(map[id]);
      return typeof connect === "string" ? { error: connect } : { id, label: id, connect };
    }
    const direct = connectFrom(parsed);
    if (typeof direct === "string") {
      const names = Object.keys(parsed);
      if (names.length === 1 && isRecord(parsed[names[0]!])) {
        const id = names[0]!;
        const nested = connectFrom(parsed[id]);
        return typeof nested === "string" ? { error: nested } : { id, label: id, connect: nested };
      }
      return { error: direct };
    }
    return { id: "", label: "", connect: direct };
  }

  removeProject(slug: string): unknown {
    const project = this.deps.source.named(slug);
    if (!project) return { error: unknownProject(slug) };
    const ledger = loadLedger(project.state);
    const lanes = Object.keys(ledger.lanes).length;
    const tasks = Object.keys(ledger.tasks).length;
    if (lanes > 0 || tasks > 0) return { error: `${slug} has ${lanes} lane(s) and ${tasks} task(s) on record, so its settings stay. Close the lanes first.` };
    for (const name of ["settings.json", "meta.json"]) rmSync(join(project.state, name), { force: true });
    try {
      if (readdirSync(project.state).length === 0) rmSync(project.state, { recursive: true, force: true });
    } catch {}
    this.deps.seating.forget();
    return { removed: slug };
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
