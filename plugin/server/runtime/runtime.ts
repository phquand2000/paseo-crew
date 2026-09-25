import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { renderPrompt } from "../catalog/content.ts";
import { type Kit, type SensorSpec, TEAM_SERVER, seatOf, watchPatterns } from "../catalog/kit.ts";
import { type ModelCache, applyModels, fetchModels, listingProviders } from "../catalog/models.ts";
import { applyRole, seatBin, seatEnv } from "../catalog/launch.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { placeGuides, seatDir, seedRecords, sweepSnapshots } from "../catalog/seats.ts";
import { stampKit } from "../upkeep/migrate.ts";
import { type IndexedProxy, indexedProxies } from "../catalog/servers.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "../core/paths.ts";
import type { AgentConfig, HookAgent, Host, HostHooks, Judge, PermissionRequested, Seats, SessionOpen, TurnEnded, Workspaces } from "../core/ports.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { laneOfLead, laneOnHold, loadLedger, openAsksTo, taskOfPeer } from "../desk/ledger.ts";
import { TOOLS } from "../desk/tools/registry.ts";
import { letters } from "../desk/letters.ts";
import { appendRecord } from "../desk/records.ts";
import { type Project, gateCommands, loadConfig, projectOf } from "../desk/project.ts";
import { SettingsControl } from "./control.ts";
import { type Trouble, watchView } from "./watch-view.ts";
import { codeIndex } from "./code-index.ts";
import { type Letter, Outbox, type Rules } from "./outbox.ts";
import { Patrol } from "./patrol.ts";
import { Seating } from "./seating.ts";
import { replyFile, spoolDirs, takeRequests, writeReply } from "./spool.ts";
import { TeamSource } from "./team-source.ts";
import { TurnRules } from "./turns.ts";
import { type Fact, callsTo } from "./watch/facts.ts";
import { decide } from "./watch/findings.ts";
import { type SeatContext, type SeatWatch, type WatchedSeat, Watches } from "./watch/watches.ts";
import { malformed } from "./timeline.ts";
import { errorText } from "../core/errors.ts";

const TROUBLES = 10;


type RuntimeOptions = { outboxFile?: string; codeIndex?: (proxy: IndexedProxy) => CodeIndex; reloadDaemon?: () => Promise<boolean>; sensor?: (spec: SensorSpec, key: string) => Judge };

export class Runtime implements HostHooks {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly control: SettingsControl;
  private readonly spool = spoolDir();
  private readonly calls = new Map<string, { id: string; replied: boolean }[]>();
  private readonly seats: Seats;
  private readonly workspaces: Workspaces;
  private readonly source: TeamSource;
  private readonly seating: Seating;
  private readonly turns: TurnRules;
  private readonly patrol: Patrol;
  private readonly watches: Watches;
  private readonly troubles = new Map<string, Trouble[]>();
  private readonly offline = new Set<string>();
  private readonly makeIndex: (proxy: IndexedProxy) => CodeIndex;
  private readonly reload: () => Promise<boolean>;
  private readonly host: Host;
  private modelsAsked = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private tick: ReturnType<typeof setTimeout> | undefined;

  constructor(kit: Kit, host: Host, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.host = host;
    this.makeIndex = options.codeIndex ?? codeIndex;
    this.reload = options.reloadDaemon ?? reloadDaemon;
    this.seats = host.seats;
    this.workspaces = host.workspaces;
    this.source = new TeamSource(kit);
    this.seating = new Seating(kit, this.source, { node: nodeBin(), spool: this.spool });
    this.outbox = new Outbox(
      options.outboxFile ?? outboxPath(),
      (to, list) => this.compose(to, list),
      this.seats,
      this.outboxRules(kit),
    );
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
    this.turns = new TurnRules({ kit, desk: this.desk, seats: this.seats, remember, log: (project, line) => this.log(project, line) });
    this.watches = new Watches({
      kit,
      seats: this.seats,
      context: (seat) => this.watchContext(seat),
      found: (watch, facts) => this.watchFound(watch, facts),
      spoke: (seat, text) => void this.turns.spoke(seat, text).catch((error: unknown) => console.error("seatworks-v2: a word the Human wrote to a seat could not be passed on:", error)),
    });
    this.patrol = new Patrol({ kit, source: this.source, desk: this.desk, seats: this.seats, outbox: this.outbox, turns: this.turns, watches: this.watches, remember });
    this.control = new SettingsControl({
      kit,
      source: this.source,
      seating: this.seating,
      reconcile: () => this.reconcileProviders(),
      models: () => this.refreshModels(),
      seats: this.seats,
      held: () => this.outbox.letters(),
      watch: (project) => watchView(project, this.troubles.get(project.slug) ?? [], this.source.teamFor(project), kit),
      human: this.desk.human,
    });
  }

  private watchContext(seat: WatchedSeat): SeatContext | undefined {
    const found = seatOf(this.kit, seat.provider);
    if (!found) return undefined;
    const project = projectOf(seat.cwd);
    const attention = this.source.teamFor(project).attention;
    let scope: string[] | undefined;
    let placed = false;
    try {
      const ledger = loadLedger(project.state);
      const task = taskOfPeer(ledger, seat.id);
      scope = task?.kind !== "code" ? undefined : task.mode === "parallel" ? task.holds : ledger.lanes[task.lane]?.writeSet;
      placed = Boolean(task ?? laneOfLead(ledger, seat.id));
    } catch (error) {
      this.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: errorText(error) });
    }
    return {
      placed,
      rules: {
        ...watchPatterns(this.kit, attention),
        desk: callsTo(found.harness.mcpCall, found.harness.mcpServerField, TEAM_SERVER),
        gates: gateCommands(seat.cwd, loadConfig(project.state).gate, this.kit.ecosystem),
        cwd: seat.cwd,
        temp: tmpdir(),
        scope,
        repeatsAt: attention.repeatsAt,
        recoverWithin: 10,
      },
      handedBack: (at) => {
        try {
          const handback = taskOfPeer(loadLedger(project.state), seat.id)?.handback;
          return handback && handback.at >= at && !handback.gate ? handback.outcome : undefined;
        } catch {
          return undefined;
        }
      },
    };
  }

  private noticed(watch: SeatWatch, facts: Fact[]): void {
    if (this.watches.get(watch.seat.id) !== watch) return;
    const moment = { facts, instruction: watch.window.instruction(), turn: watch.turnId };
    this.desk.notice(projectOf(watch.seat.cwd), watch.seat, decide(facts), moment).catch((error) => console.error("seatworks-v2: what the watch noticed could not be recorded:", error));
  }

  /** Trouble nobody is mailed about, kept where a screen can show it rather than only in the log. */
  private troubled(project: Project, kind: string, detail: string): void {
    const list = this.troubles.get(project.slug) ?? [];
    list.push({ kind, at: Date.now(), detail });
    if (list.length > TROUBLES) list.splice(0, list.length - TROUBLES);
    this.troubles.set(project.slug, list);
  }

  /** A call the harness refused because its input was not JSON; it never reaches the desk, so only this reports it. */
  private malformedCalls(event: TurnEnded): void {
    const seat = seatOf(this.kit, event.agent.provider);
    if (!seat?.role.tools) return;
    const project = projectOf(event.agent.cwd);
    for (const call of malformed(event.timeline, seat.harness.timeline?.unparsed)) {
      this.desk.event(project, { kind: "call.malformed", agent: event.agent.id, role: seat.role.role, tool: call.tool, error: call.quote });
      this.troubled(project, "call.malformed", `the ${seat.role.label}'s ${call.tool} was written with an input that is not JSON, and never reached the desk`);
    }
  }

  private watchFound(watch: SeatWatch, facts: Fact[]): void {
    const project = projectOf(watch.seat.cwd);
    for (const fact of facts) this.desk.event(project, { kind: "watch.fact", agent: watch.seat.id, fact: fact.kind, level: fact.level, quote: fact.quote });
    this.noticed(watch, facts);
  }

  prepare(): void {
    try {
      mkdirSync(stateRoot(), { recursive: true });
      spoolDirs(this.spool);
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

  create(config: AgentConfig): AgentConfig {
    const seat = seatOf(this.kit, config.provider);
    if (!seat) return config;
    const project = projectOf(config.cwd);
    this.remember(project);
    const team = this.seating.ensure(seat.role.role, seat.harness, project);
    const render = (role: Parameters<typeof renderPrompt>[1]) => renderPrompt(this.kit, role, seat.harness.id, { guides: guidesDir(), state: project.state });
    return applyRole(this.kit, team, config, render, project.state, this.seating.servers(team, seat.role.role));
  }

  async created(agent: HookAgent): Promise<void> {
    this.watches.follow(agent);
  }

  async archived(agent: HookAgent): Promise<void> {
    this.outbox.archived(agent.id);
    this.turns.forget(agent.id);
    this.watches.drop(agent.id);
    this.desk.archived(projectOf(agent.cwd), agent.id, this.watches.watched(agent.provider));
  }

  start(): void {
    this.timers.push(setInterval(() => this.serveSpool(), 500));
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
    this.watches.dispose();
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
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
    return seatEnv(this.kit, request, seatDir(this.kit, seat.role, seat.harness, home(), project), project, seatBin(this.kit));
  }

  async turnStarted(agent: HookAgent): Promise<void> {
    this.turns.started(agent.id);
    this.outbox.turnStarted(agent.id);
  }

  async turnEnded(event: TurnEnded): Promise<void> {
    this.outbox.turnEnded(event.agent.id);
    this.malformedCalls(event);
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
      calling: (agentId) => this.waitedOn(agentId).length > 0,
      holding: (seat) => Boolean(seat.cwd && laneOnHold(projectOf(seat.cwd).state, seat.id)),
    };
  }

  private waitedOn(agentId: string): { id: string; replied: boolean }[] {
    const live = (this.calls.get(agentId) ?? []).filter((call) => !call.replied || existsSync(replyFile(this.spool, call.id)));
    if (live.length > 0) this.calls.set(agentId, live);
    else this.calls.delete(agentId);
    return live;
  }

  private serveSpool(): void {
    if (!this.host.connected()) return;
    let requests;
    try {
      requests = takeRequests(this.spool);
    } catch (error) {
      console.error("seatworks-v2: spool read failed:", error);
      return;
    }
    for (const request of requests) {
      const call = { id: request.id, replied: false };
      this.calls.set(request.agent, [...this.waitedOn(request.agent), call]);
      this.desk
        .answer(request)
        .catch((error) => ({ ok: false, text: `The desk failed: ${errorText(error)}` }))
        .then((reply) => writeReply(this.spool, request.id, reply))
        .catch((error) => console.error("seatworks-v2: spool reply failed:", error))
        .finally(() => {
          call.replied = true;
        });
    }
  }
}
