import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { renderPrompt } from "../catalog/content.ts";
import { type Kit, type RoleSpec, can, seatOf } from "../catalog/kit.ts";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "../catalog/launch.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { ensureLink, seatDir, seedRecords } from "../catalog/seats.ts";
import { type IndexedProxy, type Team, indexedProxies } from "../catalog/team.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "../core/paths.ts";
import { seatsOn, workspacesOn } from "../core/paseo-adapter.ts";
import type { PaseoApi } from "../core/paseo.ts";
import type { Seats, Workspaces } from "../core/ports.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { laneOfLead, loadLedger, openAsksTo, taskOfPeer } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, projectOf } from "../desk/project.ts";
import { SettingsControl } from "./control.ts";
import { codeIndex } from "./code-index.ts";
import { type Letter, Outbox } from "./outbox.ts";
import { Patrol } from "./patrol.ts";
import { registerRpc } from "./rpc.ts";
import { Seating } from "./seating.ts";
import { spoolDirs, takeRequests, writeReply } from "./spool.ts";
import { TeamSource } from "./team-source.ts";
import { TurnRules, type Watch } from "./turns.ts";

type EventName = keyof PluginLifecycleEvents;

export type RuntimeOptions = { outboxFile?: string; paseo?: PaseoApi; codeIndex?: (proxy: IndexedProxy) => CodeIndex; reloadDaemon?: () => Promise<boolean> };

export class Runtime {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly control: SettingsControl;
  private readonly spool = spoolDir();
  private readonly seats: Seats;
  private readonly workspaces: Workspaces;
  private readonly source: TeamSource;
  private readonly seating: Seating;
  private readonly turns: TurnRules;
  private readonly patrol: Patrol;
  private readonly makeIndex: (proxy: IndexedProxy) => CodeIndex;
  private readonly reload: () => Promise<boolean>;
  private api: PaseoApi | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private tick: ReturnType<typeof setTimeout> | undefined;

  constructor(kit: Kit, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.api = options.paseo;
    this.makeIndex = options.codeIndex ?? codeIndex;
    this.reload = options.reloadDaemon ?? reloadDaemon;
    this.seats = seatsOn(() => this.api);
    this.workspaces = workspacesOn(() => this.api);
    this.source = new TeamSource(kit);
    this.seating = new Seating(kit, this.source, { node: nodeBin(), spool: this.spool });
    this.outbox = new Outbox(
      options.outboxFile ?? outboxPath(),
      (to, list) => this.compose(to, list),
      this.seats,
      (letter, at) =>
        console.error(`seatworks-v2: a letter for ${letter.to} (${letter.key}) was never taken and has been given up on after ${Math.round((at - letter.at) / 3_600_000)} hours`),
      (seat) => seatOf(kit, seat.provider)?.harness.steers === true,
    );
    const log = (project: Project, line: string) => this.log(project, line);
    const remember = (project: Project) => this.remember(project);
    this.desk = new Desk({
      kit,
      outbox: this.outbox,
      seats: this.seats,
      workspaces: this.workspaces,
      log,
      teamFor: (project) => this.source.teamFor(project),
      indexesFor: (project) => this.indexesFor(project),
    });
    this.turns = new TurnRules({ kit, desk: this.desk, remember, watch: (item) => this.tellWatcher(item), attention: (project) => this.source.teamFor(project).attention });
    this.patrol = new Patrol({ kit, source: this.source, desk: this.desk, seats: this.seats, outbox: this.outbox, turns: this.turns, remember });
    this.control = new SettingsControl({
      kit,
      source: this.source,
      seating: this.seating,
      reconcile: (team) => this.reconcileProviders(team),
      seats: this.seats,
      held: () => this.outbox.letters(),
    });
  }

  private tellWatcher(item: Watch): void {
    if (!this.api || !(item.text.trim() || item.reading.record.length > 0)) return;
    if (!this.source.teamFor(item.project).attention.watch) return;
    void (async () => {
      const seats = await this.seats.open();
      const watcher = await this.desk.ensureWatcher(item.project, seats);
      if (!watcher) return;
      this.desk.recordReading(item.project, item.where, item.reading.notes);
      const { labels } = this.source.teamFor(item.project).attention;
      await this.desk.post(watcher, `ending:${item.agent}:${Date.now()}`, letters.ending(item.where, item.text, item.reading.record, item.agent, labels));
    })().catch((error) => console.error("seatworks-v2: an ending could not reach the Watcher:", error));
  }

  prepare(): void {
    try {
      mkdirSync(stateRoot(), { recursive: true });
      spoolDirs(this.spool);
      ensureLink(guidesDir(), join(this.kit.dir, "content", "guides"));
    } catch (error) {
      console.error("seatworks-v2: could not prepare the state directory:", error);
    }
    const team = this.source.teamFor();
    for (const problem of team.errors) console.error(`seatworks-v2: settings: ${problem}`);
    this.reconcileProviders(team);
  }

  register(server: PluginServerContext): void {
    registerRpc(server, this.control, (paseo) => {
      this.api = paseo;
    });
    server.before("agent.create", ({ request }, context) => {
      this.api = context.paseo;
      return { ...request, config: this.launchConfig(request.config) };
    });
    server.before("agent.session_open", ({ request }, context) => {
      this.api = context.paseo;
      return this.openSession(request);
    });
    this.on(server, "agent.turn_started", async ({ agent }) => this.turnStarted(agent.id));
    this.on(server, "agent.turn_ended", (event) => this.turnEnded(event));
    this.on(server, "agent.permission_requested", (event) => this.permissionRequested(event));
    this.on(server, "agent.archived", async ({ agent }) => {
      this.outbox.archived(agent.id);
      this.turns.forget(agent.id);
    });
    this.timers.push(setInterval(() => this.serveSpool(), 500));
    // The cadence is read every time round, so changing it in settings takes hold without a reload.
    const patrol = () => {
      if (this.api) this.patrol.tick().catch((error) => console.error("seatworks-v2: tick failed:", error));
      this.tick = setTimeout(patrol, Math.max(5, this.source.teamFor().attention.tickSeconds) * 1000);
    };
    this.tick = setTimeout(patrol, this.source.teamFor().attention.tickSeconds * 1000);
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.tick) clearTimeout(this.tick);
    this.tick = undefined;
  }

  private launchConfig(config: AgentConfig): AgentConfig {
    const seat = seatOf(this.kit, config.provider);
    if (!seat) return config;
    const project = projectOf(config.cwd);
    this.remember(project);
    const team = this.seating.ensure(seat.role.role, seat.harness, project);
    const render = (role: Parameters<typeof renderPrompt>[1]) => renderPrompt(this.kit, role, { guides: guidesDir(), state: project.state });
    return applyRole(this.kit, team, config, render, project.state, this.seating.servers(team, seat.role.role));
  }

  private openSession(request: SessionOpen): SessionOpen {
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
    return seatEnv(this.kit, request, seatDir(this.kit, seat.role, seat.harness, home(), project), project);
  }

  private turnStarted(agentId: string): void {
    this.turns.started(agentId);
    this.outbox.turnStarted(agentId);
  }

  private async turnEnded(event: PluginLifecycleEvents["agent.turn_ended"]): Promise<void> {
    this.outbox.turnEnded(event.agent.id);
    // The mail waiting for this seat goes whatever reading its turn ran into. A throw in there — an
    // unreadable ledger, a bad pattern — used to leave every letter for it sitting until some other
    // event happened to pump it. (For a seat being put away, the pump finds it archived and stops.)
    try {
      const archiving = this.desk.pendingArchive.has(event.agent.id);
      if (archiving) await this.desk.archive(event.agent.id, true);
      await this.desk.stopped(event.agent.id);
      if (archiving) return;
      await this.turns.ended(event);
    } finally {
      await this.outbox.pump(event.agent.id);
    }
  }

  private async permissionRequested({ agent, request }: PluginLifecycleEvents["agent.permission_requested"]): Promise<void> {
    const role = seatOf(this.kit, agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(agent.cwd);
    const what = request.title ?? request.name ?? request.kind;
    if (can(role, "supervise")) {
      this.log(project, `waiting on the Human: ${agent.id} ${what}`);
      return;
    }
    const owner = await this.turns.ownerOf(project, agent.id, role);
    await this.desk.post(owner, `permission:${agent.id}:${request.id}`, letters.permission(`${role.label} ${agent.title ?? agent.id}`, request, this.addressOf(project, agent.id, role)));
  }

  /** The id its owner's `message` reaches this seat by. */
  private addressOf(project: Project, agentId: string, role: RoleSpec): string | undefined {
    try {
      const ledger = loadLedger(project.state);
      return can(role, "lead") ? laneOfLead(ledger, agentId)?.id : taskOfPeer(ledger, agentId)?.id;
    } catch {
      return undefined;
    }
  }

  private remember(project: Project): void {
    this.desk.projects.set(project.slug, project);
    this.source.record(project);
  }

  private indexesFor(project: Project): CodeIndex[] {
    return indexedProxies(this.source.teamFor(project)).map((proxy) => this.makeIndex(proxy));
  }

  private reconcileProviders(team: Team): void {
    try {
      const changed = applyReconcile(this.kit, team);
      if (changed.length === 0) return;
      console.log(`seatworks-v2: config updated (${changed.join(", ")}); reloading the daemon`);
      void this.reload();
    } catch (error) {
      console.error("seatworks-v2: could not reconcile role providers:", error);
    }
  }

  private log(project: Project, line: string): void {
    try {
      mkdirSync(project.state, { recursive: true });
      appendFileSync(join(project.state, "attention.log"), `${new Date().toISOString()}  ${line}\n`);
    } catch (error) {
      console.error("seatworks-v2: attention log write failed:", error);
    }
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

  private on<N extends EventName>(server: PluginServerContext, name: N, handler: (event: PluginLifecycleEvents[N], context: PluginHookContext) => Promise<void>): void {
    server.on(name, async (event, context) => {
      this.api = context.paseo;
      try {
        await handler(event, context);
      } catch (error) {
        console.error(`seatworks-v2: ${name} handler failed:`, error);
      }
    });
  }

  private serveSpool(): void {
    if (!this.api) return;
    let requests;
    try {
      requests = takeRequests(this.spool);
    } catch (error) {
      console.error("seatworks-v2: spool read failed:", error);
      return;
    }
    for (const request of requests) {
      this.desk
        .answer(request)
        .catch((error) => ({ ok: false, text: `The desk failed: ${error instanceof Error ? error.message : String(error)}` }))
        .then((reply) => writeReply(this.spool, request.id, reply))
        .catch((error) => console.error("seatworks-v2: spool reply failed:", error));
    }
  }
}
