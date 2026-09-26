import { existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Kit, can, rolesThatCan, seatOf } from "../catalog/kit.ts";
import { layerValues, readShown, withKeys, withoutKeys, writeLayer } from "../catalog/settings.ts";
import type { Layer } from "../../shared/settings.ts";
import { type Team, resolveTeam } from "../catalog/team.ts";
import { gitCommonDir } from "../core/git.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import { seatProblems } from "../catalog/seats.ts";
import { guidesDir, home, stateRoot, worktreeRoot } from "../core/paths.ts";
import { createHash } from "node:crypto";
import { flowView } from "../desk/flow.ts";
import type { Human } from "../desk/human.ts";
import type { Added, CatalogView, CleanView, FlowRead, MigrateView, ModelsRefreshed, Parsed, Paths, ProjectRow, Removed, SettingsRead, StatusView, TeamRead, UpdateView, WatchView, WriteResult } from "../../shared/views.ts";
import { removeGarbage, scanGarbage } from "../upkeep/clean.ts";
import { type LiveSeat, migrate, migrationPlan } from "../upkeep/migrate.ts";
import { applyUpdate, checkUpdate, npmInstall, reloadSoon } from "../upkeep/update.ts";
import { contentChanges, decide } from "../upkeep/content.ts";
import { loadLedger, readLedger } from "../desk/ledger.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { statusPage } from "../desk/views/status.ts";
import { describeCatalog } from "./catalog-view.ts";
import { listFolders } from "./folders.ts";
import { parseMcp } from "./mcp-paste.ts";
import { describeTeam } from "./team-view.ts";
import { HumanPanel } from "./human.ts";
import { type Check, doctor } from "./doctor.ts";
import type { Control } from "./rpc.ts";
import type { TeamSource } from "./team-source.ts";
import { errorText } from "../core/errors.ts";

type Target = { file: string; project?: Project };

const unknownProject = (slug: string) => `No project named ${slug} has been seen on this machine.`;

type ControlDeps = {
  kit: Kit;
  source: TeamSource;
  /** The team or its skills changed: seats are built again, and shown the sets their fields take now. */
  changed: () => void;
  reconcile: () => void;
  models: () => Promise<Record<string, { at: string; error: string | null; models: unknown[] }>>;
  seats: Seats;
  held: () => { to: string; text: string; at: number; until: number }[];
  watch: (project: Project, seats: Iterable<SeatView>) => WatchView;
  human: Human;
};

export class SettingsControl implements Control {
  readonly human: HumanPanel;
  private readonly deps: ControlDeps;

  constructor(deps: ControlDeps) {
    this.deps = deps;
    this.human = new HumanPanel(deps.source, deps.human);
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
    const resolve = (layer: Layer) => (target.project ? resolveTeam(kit, source.machineLayer(), layer) : resolveTeam(kit, layer));
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

  projects(): ProjectRow[] {
    return this.deps.source.known().map((project) => ({ slug: project.slug, root: project.root }));
  }

  addProject(root: string): Added {
    const path = root.trim();
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) return { error: `${path || "That path"} is not a directory on this machine.` };
    const project = projectOf(path);
    this.deps.source.record(project);
    // record() only logs failures; an attach whose slug cannot be found leaves every screen for it dead.
    if (!this.deps.source.named(project.slug)) return { error: `${project.root} could not be put on record; see the daemon log.` };
    return { slug: project.slug, root: project.root };
  }

  candidateProjects(roots: string[]): string[] {
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

  parseMcp(text: string): Parsed {
    return parseMcp(text);
  }

  async removeProject(slug: string): Promise<Removed> {
    const project = this.deps.source.named(slug);
    if (!project) return { error: unknownProject(slug) };
    // A seat still working in the project records it again on the next round, so detaching it first would not hold.
    let live: string[];
    try {
      live = (await this.deps.seats.open()).filter((seat) => !seat.archivedAt && seatOf(this.deps.kit, seat.provider)?.role.tools && projectOf(seat.cwd).slug === slug).map((seat) => seat.id);
    } catch (error) {
      return { error: `Paseo did not say which seats are working in ${slug} (${errorText(error)}), so its settings stay.` };
    }
    if (live.length > 0) return { error: `${slug} stays: ${live.length} seat${live.length === 1 ? " is" : "s are"} still working in it (${live.join(", ")}): archive ${live.length === 1 ? "it" : "them"} first, since a working seat puts the project back on record.` };
    // Live work only: lanes and tasks are never removed, so counting them made Detach impossible after the first lane.
    const ledger = loadLedger(project.state);
    const open = Object.values(ledger.lanes).filter((lane) => lane.status !== "closed").length;
    // A closed lane still restoring the owner's copy is live: detached, the repo stays on its branch for good.
    const restoring = Object.values(ledger.lanes).filter((lane) => lane.restoring).length;
    // A free slot row left by a failed checkout is the desk's pool, not a copy anyone holds.
    const copies = Object.values(ledger.slots).filter((slot) => slot.lane || slot.task || slot.releasing).length;
    if (open > 0 || copies > 0 || restoring > 0) {
      const held = [
        open > 0 ? `${open} open or waiting lane(s)` : "",
        restoring > 0 ? `${restoring} closed lane(s) whose working copy — the project's own — is not back on its base branch yet: a seat is still writing there, or the copy has changes that stop the switch (see restore.held in events.log)` : "",
        copies > 0 ? `${copies} working cop${copies === 1 ? "y" : "ies"} still checked out` : "",
      ].filter(Boolean);
      return { error: `${slug} has ${held.join(" and ")}, so its settings stay.${open > 0 ? " Close the lanes first." : ""}` };
    }
    for (const name of ["settings.json", "meta.json"]) rmSync(join(project.state, name), { force: true });
    try {
      if (readdirSync(project.state).length === 0) rmSync(project.state, { recursive: true, force: true });
    } catch {}
    this.deps.source.forget(slug);
    this.deps.changed();
    return { removed: slug };
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

  async status(slug: string): Promise<StatusView> {
    const project = this.deps.source.named(slug);
    if (!project) return { text: "", error: unknownProject(slug) };
    const seats = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    return { text: statusPage(this.deps.kit, project, seats, Date.now(), this.deps.held()) };
  }

  async flow(slug: string, since?: string, open?: string[]): Promise<FlowRead> {
    const project = this.deps.source.named(slug);
    if (!project) return { error: unknownProject(slug) };
    const seats = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    const supervises = new Set(rolesThatCan(this.deps.kit, "supervise").map((role) => role.role));
    const seated = [...seats.values()]
      .map((seat) => ({ seat, role: seatOf(this.deps.kit, seat.provider)?.role }))
      .filter(({ seat, role }) => can(role, "supervise") && Boolean(seat.cwd) && projectOf(seat.cwd).slug === project.slug)
      .sort((a, b) => Date.parse(b.seat.updatedAt) - Date.parse(a.seat.updatedAt))
      .map(({ seat, role }) => ({ id: seat.id, role: role!.role }));
    const view = flowView(project, readLedger(project.state), seats, Date.now(), new Set(open ?? []), supervises, seated);
    // Live state, but part of the revision, or the card freezes whenever the ledger does not change.
    const watch = this.deps.watch(project, seats.values());
    const revision = createHash("sha1").update(`${view.revision}${JSON.stringify(watch)}`).digest("hex").slice(0, 16);
    return since && since === revision ? { unchanged: true, revision } : { ...view, watch, revision };
  }

  listPaths(path?: string): Paths {
    return listFolders(path);
  }

  async refreshModels(): Promise<ModelsRefreshed> {
    const cache = await this.deps.models();
    return Object.fromEntries(Object.entries(cache).map(([id, entry]) => [id, { at: entry.at, error: entry.error, count: entry.models.length }]));
  }

  async clean(remove?: string[]): Promise<CleanView> {
    const { kit, source } = this.deps;
    const ctx = { kit, home: home(), known: source.known(), teamFor: (project: Project) => source.teamFor(project), live: await this.live() };
    if (!remove) return { items: await scanGarbage(ctx), removed: [], failed: [] };
    const cleaned = await removeGarbage(ctx, remove);
    for (const project of ctx.known) if (!source.named(project.slug)) source.forget(project.slug);
    return cleaned;
  }

  async update(apply: boolean, fetch = true): Promise<UpdateView> {
    const counts = new Map<string, number>();
    for (const seat of await this.live()) counts.set(seat.slug, (counts.get(seat.slug) ?? 0) + 1);
    const busy = [...counts].map(([slug, count]) => `${slug} ${count} seat${count === 1 ? "" : "s"}`);
    const ctx = { dir: this.deps.kit.dir, managedRoot: join(home(), ".paseo", "plugins"), busy, install: npmInstall, reload: reloadSoon };
    return apply ? applyUpdate(ctx) : checkUpdate(ctx, fetch);
  }

  async migrate(apply: boolean): Promise<MigrateView> {
    const { kit, source } = this.deps;
    const known = source.known();
    const ctx = {
      kit,
      home: home(),
      known,
      settings: [
        { where: "machine", file: source.machineFile() },
        ...known.map((project) => ({ where: project.slug, file: source.projectFile(project) })),
      ],
      live: await this.live(),
      now: Date.now(),
    };
    const content = await contentChanges(kit, stateRoot());
    if (!apply) return { ...migrationPlan(ctx), content };
    const done = migrate(ctx);
    this.deps.reconcile();
    return { ...done, content };
  }

  async decide(unit: string, choice: "new" | "mine" | "seen"): Promise<MigrateView> {
    await decide(this.deps.kit, stateRoot(), unit, choice);
    // A seat's skills are read when it is built: the next one follows the answer.
    this.deps.changed();
    return this.migrate(false);
  }

  private async live(): Promise<LiveSeat[]> {
    const seats = await this.deps.seats.open();
    return seats.flatMap((seat) => {
      const found = seatOf(this.deps.kit, seat.provider);
      if (!found) return [];
      const name = [found.role.label, found.harness.label, seat.title].filter(Boolean).join(" · ");
      return [{ provider: seat.provider.split("/")[0]!, slug: projectOf(seat.cwd).slug, createdAt: seat.createdAt, name }];
    });
  }

  private target(slug?: string): Target | string {
    if (!slug) return { file: this.deps.source.machineFile() };
    const project = this.deps.source.named(slug);
    if (!project) return unknownProject(slug);
    return { file: this.deps.source.projectFile(project), project };
  }
}
