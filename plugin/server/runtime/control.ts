import { existsSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type Kit, can, providerId, reloadTeam, rolesThatCan, seatOf, supportsRole } from "../catalog/kit.ts";
import { type Connect, type Layer, MachineLayerSchema, ProjectLayerSchema, type SettingsView, type WriteResult, layerValues, readLayer, withKey, withoutKey, writeLayer } from "../catalog/settings.ts";
import { type Team, resolveTeam, rulesFor, skillDirsFor, templateRoles, transportOf } from "../catalog/team.ts";
import { gitCommonDir } from "../core/git.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import { seatProblems } from "../catalog/seats.ts";
import { guidesDir, home, stateRoot, worktreeRoot } from "../core/paths.ts";
import { createHash } from "node:crypto";
import { flowView } from "../desk/flow.ts";
import type { CleanView, MigrateView, UpdateView, WatchView } from "../../shared/views.ts";
import { removeGarbage, scanGarbage } from "../upkeep/clean.ts";
import { type LiveSeat, migrate, migrationPlan } from "../upkeep/migrate.ts";
import { applyUpdate, checkUpdate, npmInstall, reloadSoon } from "../upkeep/update.ts";
import { contentChanges, decide } from "../upkeep/content.ts";
import { loadLedger, readLedger } from "../desk/ledger.ts";
import { type Project, gitRoot, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import { type Check, doctor } from "./doctor.ts";
import type { Control } from "./rpc.ts";
import type { Seating } from "./seating.ts";
import type { TeamSource } from "./team-source.ts";
import { errorText } from "../core/errors.ts";

type Target = { file: string; schema: typeof MachineLayerSchema | typeof ProjectLayerSchema; project?: Project };

const unknownProject = (slug: string) => `No project named ${slug} has been seen on this machine.`;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A vendor's README writes a port or a flag as a number, and a snippet is pasted as it was found.
// Everything here ends up in a process environment or a header, where it is text either way; what
// has no text form is named back rather than dropped, since a server saved without its token is a
// server that fails later for no visible reason.
const scalar = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;

/** The words, or — as a string — the one that is not a word. */
const words = (value: unknown): string[] | string | undefined => {
  if (value === undefined || value === null) return undefined;
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    const text = scalar(item);
    if (text === undefined) return JSON.stringify(item);
    out.push(text);
  }
  return out;
};

/** The names and their values, or — as a string — the name whose value has no text form. */
const table = (value: unknown): Record<string, string> | string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return JSON.stringify(value);
  const out: Record<string, string> = {};
  for (const [name, item] of Object.entries(value)) {
    const text = scalar(item);
    if (text === undefined) return name;
    out[name] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

function connectFrom(value: unknown): Connect | string {
  if (!isRecord(value)) return "A server needs a JSON object with its connection details.";
  const raw = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const run = words(value.command);
  if (typeof run === "string") return `The server's command has ${run} in it, which is not text.`;
  const rest = words(value.args);
  if (typeof rest === "string") return `The server's args have ${rest} in them, which is not text.`;
  const command = [...(run ?? []), ...(rest ?? [])];
  const url = typeof value.url === "string" ? value.url : undefined;
  const type = raw === "local" || raw === "stdio" ? "stdio" : raw === "sse" ? "sse" : raw === "remote" || raw === "http" ? "http" : command.length > 0 ? "stdio" : url ? "http" : undefined;
  if (!type) return "Give the server a command to run or a url to reach.";
  if (type === "stdio") {
    if (command.length === 0) return "A local server needs a command to run.";
    const env = table(value.env);
    if (typeof env === "string") return `The server's env gives ${env} a value that is not text.`;
    return { type, command, ...(env ? { env } : {}) };
  }
  if (!url) return "A remote server needs a url.";
  const headers = table(value.headers);
  if (typeof headers === "string") return `The server's headers give ${headers} a value that is not text.`;
  return { type, url, ...(headers ? { headers } : {}) };
}

export function describeCatalog(kit: Kit): unknown {
  return {
    roles: kit.roles.map((role) => ({
      id: role.role,
      label: role.label,
      description: role.description ?? "",
      can: role.can ?? [],
      concern: role.concern ?? null,
      defaults: role.defaults,
      follows: role.follows ?? null,
      harnesses: Object.values(kit.harnesses)
        .filter((harness) => supportsRole(kit, harness, role))
        .map((harness) => harness.id),
    })),
    harnesses: Object.values(kit.harnesses).map((harness) => ({
      id: harness.id,
      label: harness.label,
      models: harness.models ?? [],
      thinking: harness.hasThinking !== false,
      transports: harness.mcp.transports,
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
    sensor: Object.values(kit.sensors)[0] ? { model: Object.values(kit.sensors)[0]!.model } : null,
  };
}

export function describeTeam(kit: Kit, team: Team, project?: Project): unknown {
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
  /** Asks Paseo again for every agent's models. */
  models: () => Promise<Record<string, { at: string; error: string | null; models: unknown[] }>>;
  seats: Seats;
  /** Mail the desk is still holding, so the owner's status page is the one the agents read. */
  held: () => { to: string; text: string; at: number }[];
  /** What the watch is doing right now, which only the runtime following the seats can say. */
  watch: (project: Project, seats: Iterable<SeatView>) => WatchView;
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
    const machine = withoutKey(slug ? this.deps.source.machineLayer() : {});
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", revision: "", error: target, machine };
    const read = readLayer(target.file, target.schema);
    return { ...(read.status === "ready" ? { ...read, values: withoutKey(read.values) } : read), machine };
  }

  writeSettings(slug: string | undefined, revision: string, values: unknown): WriteResult {
    const { kit, source, seating, reconcile } = this.deps;
    const target = this.target(slug);
    if (typeof target === "string") return { status: "invalid", error: target };
    const resolve = (layer: Layer) => (target.project ? resolveTeam(kit, source.machineLayer(), layer) : resolveTeam(kit, layer));
    const paths = { guides: guidesDir(), state: target.project?.state ?? "$SEATWORKS_STATE" };
    const unbuildable = (team: Team) => Object.keys(team.roles).flatMap((role) => seatProblems(kit, team, role, paths));
    const check = (layer: Layer) => {
      const team = resolve(layer);
      if (team.errors.length > 0) return team.errors;
      // What the owner writes in rules is folded into every seat's instructions, so a line naming a
      // word a role must not see refuses that seat's whole build — which used to happen well after
      // the save, with nothing on screen to say so. Only what this save would introduce is refused:
      // something already broken in the kit is not the owner's to fix from a settings screen.
      const already = new Set(unbuildable(resolve(layerValues(target.file, target.schema))));
      return unbuildable(team).filter((problem) => !already.has(problem));
    };
    const result = writeLayer(target.file, target.schema, revision, withKey(values, layerValues(target.file, target.schema)), check);
    if (result.status === "saved") {
      seating.forget();
      if (!target.project) reconcile(source.teamFor());
      return { ...result, values: withoutKey(result.values) };
    }
    return result;
  }

  projects(): unknown {
    return this.deps.source.known().map((project) => ({ slug: project.slug, root: project.root }));
  }

  addProject(root: string): unknown {
    const path = root.trim();
    if (!path || !existsSync(path) || !statSync(path).isDirectory()) return { error: `${path || "That path"} is not a directory on this machine.` };
    const project = projectOf(path);
    this.deps.source.record(project);
    // record() only logs what went wrong, and an attach that answers with a slug the rest of the
    // plugin cannot find leaves every screen for it dead.
    if (!this.deps.source.named(project.slug)) return { error: `${project.root} could not be put on record; see the daemon log.` };
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
      return { error: `That is not JSON: ${errorText(error)}` };
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
    // Live work, not work on record. Nothing ever removes an entry from `lanes` or `tasks` — closing
    // a lane marks it closed and re-labels its tasks, because that record is the provenance — so
    // counting them made Detach impossible for ever after the first lane, under a refusal that told
    // the owner to close lanes they had already closed.
    const ledger = loadLedger(project.state);
    const open = Object.values(ledger.lanes).filter((lane) => lane.status === "open").length;
    // A closed lane still waiting to put the owner's own copy back is live work: detached, the project
    // leaves the round after a restart and the repository stays on that lane's branch for good.
    const restoring = Object.values(ledger.lanes).filter((lane) => lane.restoring).length;
    // A slot row left free by a failed checkout is the desk's pool, not a copy anyone holds. Counting
    // every row made one failed checkout another reason Detach could never work again.
    const copies = Object.values(ledger.slots).filter((slot) => slot.lane || slot.task || slot.releasing).length;
    if (open > 0 || copies > 0 || restoring > 0) {
      const held = [
        open > 0 ? `${open} open lane(s)` : "",
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
    const seats = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    // The same page the agents read. Built without these two arguments, the owner's copy was the one
    // version of this report that could never show a seat waiting on them, or mail nobody has taken —
    // which are the two things on it that are theirs to act on.
    const waiting = [...seats.values()].filter(
      (seat) => can(seatOf(this.deps.kit, seat.provider)?.role, "supervise") && projectOf(seat.cwd).slug === project.slug && (seat.pendingPermissions?.length ?? 0) > 0,
    );
    return { text: statusText(project, loadLedger(project.state), loadConfig(project.state), seats, Date.now(), undefined, waiting, this.deps.held()) };
  }

  async flow(slug: string, since?: string, open?: string[]): Promise<unknown> {
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
    // What the watch is doing is live state, not the ledger, so it is folded in here rather than read
    // by the view — but it is still part of the revision, or the card would freeze whenever the desk's
    // own record happened not to change.
    const watch = this.deps.watch(project, seats.values());
    const revision = createHash("sha1").update(`${view.revision}${JSON.stringify(watch)}`).digest("hex").slice(0, 16);
    return since && since === revision ? { unchanged: true, revision } : { ...view, watch, revision };
  }

  listPaths(path?: string): unknown {
    const asked = path && path.trim() ? path.trim() : homedir();
    let here: string;
    try {
      here = realpathSync(asked);
      if (!statSync(here).isDirectory()) return { error: `${asked} is not a directory on this machine.` };
    } catch {
      return { error: `${asked} is not a directory on this machine.` };
    }
    const parent = dirname(here);
    let children: string[];
    try {
      // A folder can be listed and not readable — a protected one, or another user's. The screen
      // handles a refusal and cannot handle a rejected promise, which left Open doing nothing at all.
      children = readdirSync(here, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => join(here, entry.name));
    } catch {
      return { error: `${asked} is on this machine but could not be read.` };
    }
    // One stat per child, not one git process: 300 folders cost seconds of a blocked event loop, in
    // the same process that is serving the seats' tool calls. A repository has .git, file or folder.
    const looksLikeRepo = (child: string) => existsSync(join(child, ".git"));
    const folders = children
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 300)
      .map((child) => ({ name: child.slice(here.length + 1), path: child, repository: looksLikeRepo(child) }));
    // `repository` answers git's own upward search, so it is true inside a repository as well as at
    // its root — which is right, because attaching from a subdirectory registers the root above it.
    // That root is what the screen has to name: without it the dialog compared the folder being
    // browsed against the projects already set up, so `/repo/src` never said that `/repo` was one.
    const root = gitRoot(here);
    return { path: here, parent: parent === here ? null : parent, repository: Boolean(gitCommonDir(here)), root: root === here ? null : root, folders };
  }

  async refreshModels(): Promise<unknown> {
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
        { where: "machine", file: source.machineFile(), schema: MachineLayerSchema },
        ...known.map((project) => ({ where: project.slug, file: source.projectFile(project), schema: ProjectLayerSchema })),
      ],
      live: await this.live(),
      now: Date.now(),
    };
    const content = await contentChanges(kit, stateRoot());
    if (!apply) return { ...migrationPlan(ctx), content };
    const done = migrate(ctx);
    this.deps.reconcile(source.teamFor());
    return { ...done, content };
  }

  async decide(unit: string, choice: "new" | "mine" | "seen"): Promise<MigrateView> {
    await decide(this.deps.kit, stateRoot(), unit, choice);
    // The team block is read once a load, and a seat's skills when it is built: both follow the answer now.
    reloadTeam(this.deps.kit);
    this.deps.seating.forget();
    return this.migrate(false);
  }

  /** The team's seats Paseo has open, and the project each works in. */
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
    if (!slug) return { file: this.deps.source.machineFile(), schema: MachineLayerSchema };
    const project = this.deps.source.named(slug);
    if (!project) return unknownProject(slug);
    return { file: this.deps.source.projectFile(project), schema: ProjectLayerSchema, project };
  }
}
