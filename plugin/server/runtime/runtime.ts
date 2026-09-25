import { mkdirSync } from "node:fs";
import { renderPrompt } from "../catalog/content.ts";
import { type Kit, SEAT_KEY, type SensorSpec, seatOf } from "../catalog/kit.ts";
import { type ModelCache, applyModels, fetchModels, listingProviders } from "../catalog/models.ts";
import { applyRole, seatBin, seatEnv } from "../catalog/launch.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { placeGuides, seatDir, seedRecords, sweepSnapshots } from "../catalog/seats.ts";
import { stampKit } from "../upkeep/migrate.ts";
import { type IndexedProxy, choicesFor, indexedProxies } from "../catalog/servers.ts";
import { deskSocket, guidesDir, home, nodeBin, outboxPath, stateRoot } from "../core/paths.ts";
import type { AgentConfig, HookAgent, Host, HostHooks, Judge, PermissionRequested, Seats, SessionOpen, TurnEnded, Workspaces } from "../core/ports.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { laneOnHold, loadLedger, openAsksTo } from "../desk/ledger.ts";
import { TOOLS } from "../desk/tools/registry.ts";
import { letters } from "../desk/letters.ts";
import { appendRecord } from "../desk/records.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { SettingsControl } from "./control.ts";
import { watchView } from "./watch-view.ts";
import { codeIndex } from "./code-index.ts";
import { type Letter, Outbox, type Rules } from "./outbox.ts";
import { Patrol } from "./patrol.ts";
import { SeatKeys } from "./keys.ts";
import { Seating } from "./seating.ts";
import { TeamSocket } from "./team-socket.ts";
import { TeamSource } from "./team-source.ts";
import { Watching } from "./watching.ts";
import { TurnRules } from "./turns.ts";
import { Watches } from "./watch/watches.ts";
import { errorText } from "../core/errors.ts";

type RuntimeOptions = { outboxFile?: string; codeIndex?: (proxy: IndexedProxy) => CodeIndex; reloadDaemon?: () => Promise<boolean>; sensor?: (spec: SensorSpec, key: string) => Judge };

export class Runtime implements HostHooks {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly control: SettingsControl;
  private readonly keys = new SeatKeys();
  private readonly socket: TeamSocket;
  private readonly seats: Seats;
  private readonly workspaces: Workspaces;
  private readonly source: TeamSource;
  private readonly seating: Seating;
  private readonly turns: TurnRules;
  private readonly patrol: Patrol;
  private readonly watches: Watches;
  private readonly watching: Watching;
  private readonly offline = new Set<string>();
  private readonly makeIndex: (proxy: IndexedProxy) => CodeIndex;
  private readonly reload: () => Promise<boolean>;
  private readonly host: Host;
  private modelsAsked = false;
  private tick: ReturnType<typeof setTimeout> | undefined;

  constructor(kit: Kit, host: Host, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.host = host;
    this.makeIndex = options.codeIndex ?? codeIndex;
    this.reload = options.reloadDaemon ?? reloadDaemon;
    this.seats = host.seats;
    this.workspaces = host.workspaces;
    this.source = new TeamSource(kit);
    this.seating = new Seating(kit, this.source, { node: nodeBin(), socket: deskSocket() });
    this.outbox = new Outbox(options.outboxFile ?? outboxPath(), (to, list) => this.compose(to, list), this.seats, this.outboxRules(kit));
    const log = (project: Project, line: string) => this.log(project, line);
    const remember = (project: Project) => this.remember(project);
    this.desk = new Desk({
      kit,
      tools: TOOLS,
      outbox: this.outbox,
      seats: this.seats,
      workspaces: this.workspaces,
      log,
      teamFor: (project) => this.source.teamFor(project),
      indexesFor: (project) => this.indexesFor(project),
      sensor: options.sensor,
    });
    this.socket = this.teamSocket();
    this.turns = new TurnRules({ kit, desk: this.desk, seats: this.seats, remember, log });
    this.watching = new Watching({ kit, source: this.source, desk: this.desk, watches: () => this.watches });
    this.watches = new Watches({
      kit,
      seats: this.seats,
      context: (seat) => this.watching.context(seat),
      found: (watch, facts) => this.watching.found(watch, facts),
      spoke: (seat, text) => void this.turns.spoke(seat, text).catch((error: unknown) => console.error("seatworks-v2: a word the Human wrote to a seat could not be passed on:", error)),
    });
    this.patrol = new Patrol({ kit, source: this.source, desk: this.desk, seats: this.seats, outbox: this.outbox, turns: this.turns, watches: this.watches, remember });
    this.control = new SettingsControl({
      kit,
      source: this.source,
      changed: () => this.teamChanged(),
      reconcile: () => this.reconcileProviders(),
      models: () => this.refreshModels(),
      seats: this.seats,
      held: () => this.outbox.letters(),
      watch: (project) => watchView(project, this.watching.troublesOf(project), this.source.teamFor(project), kit),
      human: this.desk.human,
    });
  }

  /** Where seats' team servers reach the desk: known by their keys, shown their roles' choices, their calls answered. */
  private teamSocket(): TeamSocket {
    return new TeamSocket(deskSocket(), {
      agentOf: (key) => this.keys.agentOf(key),
      choices: (role, cwd) => choicesFor(this.kit, this.source.teamFor(projectOf(cwd)), role),
      // A reloaded plugin has Paseo's API only once a hook or a panel call brings it: a call waits for it rather than fail to reach a seat.
      answer: (request, cancelled) => this.host.reached().then(() => this.desk.answer(request, { cancelled })).catch((error) => ({ ok: false, text: `The desk failed: ${errorText(error)}` })),
      mailLost: (request, reply) => this.desk.mailLost(request, reply),
    });
  }

  /** The team or its skills changed: seats are built again, and shown the choices their fields take now. */
  private teamChanged(): void {
    this.seating.forget();
    this.socket.refresh();
  }

  prepare(): void {
    try {
      mkdirSync(stateRoot(), { recursive: true });
      placeGuides(this.kit);
      sweepSnapshots();
      stampKit(this.kit, home());
    } catch (error) {
      console.error("seatworks-v2: could not prepare the state directory:", error);
    }
    for (const problem of this.source.teamFor().errors) console.error(`seatworks-v2: settings: ${problem}`);
    this.reconcileProviders();
  }

  /** A panel call is the first sign someone looks at the models, so the first one of a load asks the agents for them. */
  panelCalled(): void {
    if (this.modelsAsked) return;
    this.modelsAsked = true;
    this.refreshModels().catch((error) => console.error("seatworks-v2: could not list the agents' models:", error));
  }

  /** A seat with tools is given a key, which its team server shows the desk to say which seat calls. */
  create(config: AgentConfig, env: Record<string, string> = {}): { config: AgentConfig; env: Record<string, string> } {
    const seat = seatOf(this.kit, config.provider);
    if (!seat) return { config, env };
    const project = projectOf(config.cwd);
    this.remember(project);
    const team = this.seating.ensure(seat.role.role, seat.harness, project);
    const render = (role: Parameters<typeof renderPrompt>[1]) => renderPrompt(this.kit, role, seat.harness.id, { guides: guidesDir(), state: project.state });
    const key = seat.role.tools ? this.keys.issue() : undefined;
    const applied = applyRole(this.kit, team, config, render, project.state, this.seating.servers(team, seat.role.role, key));
    return { config: applied, env: key ? { ...env, [SEAT_KEY]: key } : env };
  }

  async created(agent: HookAgent): Promise<void> {
    this.watches.follow(agent);
  }

  async archived(agent: HookAgent): Promise<void> {
    this.keys.forget(agent.id);
    this.outbox.archived(agent.id);
    this.turns.forget(agent.id);
    this.watches.drop(agent.id);
    this.desk.archived(projectOf(agent.cwd), agent.id, this.watches.watched(agent.provider));
  }

  start(): void {
    this.socket.listen();
    // The cadence is read every time round, so changing it in settings takes hold without a reload.
    const patrol = () => {
      if (this.host.connected()) this.patrol.tick().then(() => this.offline.clear(), (error) => this.tickFailed(error));
      this.tick = setTimeout(patrol, Math.max(5, this.source.teamFor().attention.tickSeconds) * 1000);
    };
    this.tick = setTimeout(patrol, this.source.teamFor().attention.tickSeconds * 1000);
  }

  private tickFailed(error: unknown): void {
    console.error("seatworks-v2: tick failed:", error);
    if (!/not connected|client closed|transport/i.test(errorText(error))) return;
    for (const project of this.desk.projects.values()) {
      if (this.offline.has(project.slug)) continue;
      this.offline.add(project.slug);
      this.desk.event(project, { kind: "watch.offline", error: errorText(error) });
    }
  }

  dispose(): void {
    this.socket.close();
    this.watches.dispose();
    if (this.tick) clearTimeout(this.tick);
    this.tick = undefined;
  }

  sessionOpen(request: SessionOpen): SessionOpen {
    const seat = seatOf(this.kit, request.provider);
    if (!seat) return request;
    const project = projectOf(request.cwd);
    this.remember(project);
    try {
      seedRecords(this.kit, project.state);
    } catch (error) {
      console.error("seatworks-v2: could not seed project records:", error);
    }
    this.seating.ensure(seat.role.role, seat.harness, project);
    const opened = seatEnv(this.kit, request, seatDir(this.kit, seat.role, seat.harness, home(), project), project, seatBin(this.kit));
    // Created, the seat brings the key made for it; opened again, it is given back the one it was bound to.
    const key = request.reason === "create" ? request.env[SEAT_KEY] : this.keys.keyOf(request.agentId);
    if (request.reason === "create" && key) this.keys.bind(request.agentId, key);
    return key ? { ...opened, env: { ...opened.env, [SEAT_KEY]: key } } : opened;
  }

  async turnStarted(agent: HookAgent): Promise<void> {
    this.turns.started(agent.id);
    this.outbox.turnStarted(agent.id);
  }

  async turnEnded(event: TurnEnded): Promise<void> {
    this.outbox.turnEnded(event.agent.id);
    this.watching.malformedCalls(event);
    // Wrapped: a throw here left the seat's mail waiting until some unrelated event pumped it.
    try {
      const archiving = this.desk.archiving(event.agent.id);
      if (archiving) await this.desk.archive(event.agent.id, true);
      await this.desk.stopped(event.agent.id);
      if (archiving) return;
      await this.turns.ended(event);
    } finally {
      await this.outbox.pump(event.agent.id);
    }
  }

  permissionRequested(event: PermissionRequested): Promise<void> {
    return this.turns.permission(event);
  }

  private remember(project: Project): void {
    this.desk.projects.set(project.slug, project);
    this.source.record(project);
  }

  private indexesFor(project: Project): CodeIndex[] {
    return indexedProxies(this.source.teamFor(project)).map((proxy) => this.makeIndex(proxy));
  }

  /** Asked once per load and on demand: Paseo keeps a catalog until told to refresh it. */
  async refreshModels(): Promise<ModelCache> {
    const { models } = this.host;
    // Scoped to one directory: unscoped, Paseo probes the agent for every workspace it has ever opened.
    const cwd = stateRoot();
    await Promise.all([...listingProviders(this.kit).values()].map((provider) => models.refresh(provider, cwd)));
    const { cache, changed } = await fetchModels(this.kit, (provider) => models.list(provider, cwd), stateRoot());
    applyModels(this.kit, cache);
    if (changed) {
      this.seating.forget();
      this.reconcileProviders();
    }
    return cache;
  }

  private reconcileProviders(): void {
    try {
      const changed = applyReconcile(this.kit, this.source.teamFor());
      if (changed.length === 0) return;
      console.log(`seatworks-v2: config updated (${changed.join(", ")}); reloading the daemon`);
      void this.reload();
    } catch (error) {
      console.error("seatworks-v2: could not reconcile role providers:", error);
    }
  }

  private log(project: Project, line: string): void {
    appendRecord(project.state, "attention", `${new Date().toISOString()}  ${line}\n`);
  }

  private async compose(to: string, list: Letter[]): Promise<string> {
    const items = list.map((letter) => letter.text);
    try {
      const seat = await this.seats.look(to);
      if (!seat.cwd) return letters.mailbox(items, []);
      return letters.mailbox(items, openAsksTo(loadLedger(projectOf(seat.cwd).state), to));
    } catch {
      return letters.mailbox(items, []);
    }
  }

  /** A call is waited on until the seat's bridge has taken its answer, which it deletes as it reads it. */
  private outboxRules(kit: Kit): Rules {
    return {
      dropped: (letter, at) =>
        console.error(`seatworks-v2: a letter for ${letter.to} (${letter.key}) was never taken and has been given up on after ${Math.round((at - letter.at) / 3_600_000)} hours`),
      steers: (seat) => seatOf(kit, seat.provider)?.harness.steers === true,
      calling: (agentId) => this.socket.calling(agentId),
      holding: (seat) => Boolean(seat.cwd && laneOnHold(projectOf(seat.cwd).state, seat.id)),
    };
  }
}
