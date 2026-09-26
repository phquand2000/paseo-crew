import type { Layer } from "../../../shared/settings.ts";
import type {
  CatalogView,
  ModelsRefreshed,
  Parsed,
  SettingsRead,
  TeamRead,
  WriteResult,
} from "../../../shared/views.ts";
import type { Kit } from "../../catalog/kit/kit.ts";
import { seatProblems } from "../../catalog/seat/seats.ts";
import { layerValues, readShown, withKeys, withoutKeys, writeLayer } from "../../catalog/team/settings.ts";
import { type Team, resolveTeam } from "../../catalog/team/team.ts";
import { guidesDir } from "../../core/paths.ts";
import type { Project } from "../../desk/project/project.ts";
import type { TeamSource } from "../team-source.ts";
import { describeCatalog } from "./catalog-view.ts";
import { type Check, doctor } from "./doctor.ts";
import { parseMcp } from "./mcp-paste.ts";
import { unknownProject } from "./projects.ts";
import type { SettingsRpc } from "./rpc.ts";
import { describeTeam } from "./team-view.ts";

type Target = { file: string; project?: Project };

type SettingsDeps = {
  kit: Kit;
  source: TeamSource;
  changed: () => void;
  reconcile: () => void;
  models: () => Promise<Record<string, { at: string; error: string | null; models: unknown[] }>>;
};

/** The machine's and a project's settings on the panel: read, checked against the team they make, and saved. */
export class SettingsPanel implements SettingsRpc {
  private readonly deps: SettingsDeps;

  constructor(deps: SettingsDeps) {
    this.deps = deps;
  }

  catalog(): CatalogView {
    return describeCatalog(this.deps.kit);
  }

  readSettings(slug?: string): SettingsRead {
    const machine = withoutKeys(slug ? this.deps.source.machineLayer() : {});
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", revision: "", error: target, machine };
    return { ...readShown(target.file), machine };
  }

  writeSettings(slug: string | undefined, revision: string, values: unknown): WriteResult {
    const { kit, source, changed, reconcile } = this.deps;
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", error: target };
    const resolve = (layer: Layer) =>
      target.project ? resolveTeam(kit, source.machineLayer(), layer) : resolveTeam(kit, layer);
    const paths = { guides: guidesDir(), state: target.project?.state ?? "$SEATWORKS_STATE" };
    const unbuildable = (team: Team) => Object.keys(team.roles).flatMap((role) => seatProblems(kit, team, role, paths));
    const check = (layer: Layer) => {
      const team = resolve(layer);
      if (team.errors.length > 0) return team.errors;
      // Only what this save introduces is refused: a bad rule refuses a seat's whole build, long after the save.
      const already = new Set(unbuildable(resolve(layerValues(target.file))));
      return unbuildable(team).filter((problem) => !already.has(problem));
    };
    const result = writeLayer(target.file, revision, withKeys(values, layerValues(target.file)), check);
    if (result.status === "saved") {
      changed();
      if (!target.project) reconcile();
    }
    return result.status === "saved" ? { ...result, values: withoutKeys(result.values) } : result;
  }

  parseMcp(text: string): Parsed {
    return parseMcp(text);
  }

  team(slug?: string): TeamRead {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return { error: unknownProject(slug) };
    return describeTeam(this.deps.kit, this.deps.source.teamFor(project), project);
  }

  async doctor(slug?: string): Promise<Check[]> {
    const project = slug ? this.deps.source.named(slug) : undefined;
    if (slug && !project) return [{ id: "project", ok: false, detail: unknownProject(slug) }];
    return doctor(this.deps.kit, this.deps.source.teamFor(project));
  }

  async refreshModels(): Promise<ModelsRefreshed> {
    const cache = await this.deps.models();
    return Object.fromEntries(
      Object.entries(cache).map(([id, entry]) => [
        id,
        { at: entry.at, error: entry.error, count: entry.models.length },
      ]),
    );
  }

  private target(slug?: string): Target | string {
    if (!slug) return { file: this.deps.source.machineFile() };
    const project = this.deps.source.named(slug);
    if (!project) return unknownProject(slug);
    return { file: this.deps.source.projectFile(project), project };
  }
}
