import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { renderPrompt } from "../catalog/content.ts";
import { type Kit, seatOf } from "../catalog/kit.ts";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "../catalog/launch.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { ensureLink, seatDir, seedRecords } from "../catalog/seats.ts";
import { type IndexedProxy, type Team, indexedProxies } from "../catalog/team.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "../core/paths.ts";
import { type PaseoApi, openSeats } from "../core/paseo.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { loadLedger, openAsksTo } from "../desk/ledger.ts";
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
import { TurnRules } from "./turns.ts";

type EventName = keyof PluginLifecycleEvents;

export type RuntimeOptions = { outboxFile?: string; codeIndex?: (proxy: IndexedProxy) => CodeIndex; reloadDaemon?: () => Promise<boolean> };

export class Runtime {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly control: SettingsControl;
  private readonly spool = spoolDir();
  private readonly source: TeamSource;
  private readonly seating: Seating;
  private readonly turns: TurnRules;
  private readonly patrol: Patrol;
  private readonly makeIndex: (proxy: IndexedProxy) => CodeIndex;
  private readonly reload: () => Promise<boolean>;
  private api: PaseoApi | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(kit: Kit, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.makeIndex = options.codeIndex ?? codeIndex;
    this.reload = options.reloadDaemon ?? reloadDaemon;
    this.source = new TeamSource(kit);
    this.seating = new Seating(kit, this.source, { node: nodeBin(), spool: this.spool });
    this.outbox = new Outbox(options.outboxFile ?? outboxPath(), (to, list) => this.compose(to, list));
    const log = (project: Project, line: string) => this.log(project, line);
    const remember = (project: Project) => this.remember(project);
    const api = () => this.api;
    this.desk = new Desk(kit, this.outbox, log, (project) => this.source.teamFor(project), (project) => this.indexesFor(project));
    this.turns = new TurnRules({ kit, desk: this.desk, remember, watch: (item) => this.tellWatcher(item) });
    this.patrol = new Patrol({ kit, source: this.source, desk: this.desk, outbox: this.outbox, turns: this.turns, remember });
    this.control = new SettingsControl({ kit, source: this.source, seating: this.seating, reconcile: (team) => this.reconcileProviders(team), api });
  }

  private tellWatcher(item: { project: Project; agent: string; where: string; text: string }): void {
    const paseo = this.api;
    if (!paseo || !item.text.trim()) return;
    void (async () => {
      const seats = await openSeats(paseo);
      const watcher = await this.desk.ensureWatcher(paseo, item.project, seats);
      if (!watcher) return;
      await this.desk.post(paseo, watcher, `ending:${item.agent}:${Date.now()}`, letters.ending(item.where, item.text));
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
    const direct = (server as unknown as { paseo?: PaseoApi }).paseo;
    if (direct) this.api = direct;
    registerRpc(server, this.control);
    server.before("agent.create", ({ request }, context) => {
      this.api = context.paseo;
      return { ...request, config: this.launchConfig(request.config) };
    });
    server.before("agent.session_open", ({ request }, context) => {
      this.api = context.paseo;
      return this.openSession(request);
    });
    this.on(server, "agent.turn_started", async ({ agent }) => this.turns.started(agent.id));
    this.on(server, "agent.turn_ended", (event, { paseo }) => this.turnEnded(paseo, event));
    this.on(server, "agent.permission_requested", (event, { paseo }) => this.permissionRequested(paseo, event));
    this.on(server, "agent.archived", async ({ agent }) => {
      this.outbox.archived(agent.id);
      this.turns.forget(agent.id);
    });
    this.timers.push(
      setInterval(() => this.serveSpool(), 500),
      setInterval(() => {
        if (this.api) this.patrol.tick(this.api).catch((error) => console.error("seatworks-v2: tick failed:", error));
      }, this.source.teamFor().attention.tickSeconds * 1000),
    );
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
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

  private async turnEnded(paseo: PaseoApi, event: PluginLifecycleEvents["agent.turn_ended"]): Promise<void> {
    this.api ??= paseo;
    this.outbox.turnEnded(event.agent.id);
    if (this.desk.pendingArchive.has(event.agent.id)) {
      await this.desk.archive(paseo, event.agent.id, true);
      return;
    }
    await this.turns.ended(paseo, event);
    await this.outbox.pump(paseo, event.agent.id);
  }

  private async permissionRequested(paseo: PaseoApi, { agent, request }: PluginLifecycleEvents["agent.permission_requested"]): Promise<void> {
    const role = seatOf(this.kit, agent.provider)?.role;
    if (!role?.team) return;
    const project = projectOf(agent.cwd);
    const what = request.title ?? request.name ?? request.kind;
    if (role.team === "supervisor") {
      this.log(project, `waiting on the Human: ${agent.id} ${what}`);
      return;
    }
    const owner = await this.turns.ownerOf(paseo, project, agent.id, role);
    await this.desk.post(paseo, owner, `permission:${agent.id}:${request.id}`, letters.permission(`${role.label} ${agent.title ?? agent.id}`, what));
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
    if (!this.api) return letters.mailbox(items, []);
    try {
      const handle = this.api.agents.ref(to);
      await handle.refresh();
      const cwd = handle.cwd ?? handle.current()?.cwd;
      if (!cwd) return letters.mailbox(items, []);
      return letters.mailbox(items, openAsksTo(loadLedger(projectOf(cwd).state), to));
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
    const paseo = this.api;
    if (!paseo) return;
    let requests;
    try {
      requests = takeRequests(this.spool);
    } catch (error) {
      console.error("seatworks-v2: spool read failed:", error);
      return;
    }
    for (const request of requests) {
      this.desk
        .handle(paseo, request)
        .catch((error) => ({ ok: false, text: `The desk failed: ${error instanceof Error ? error.message : String(error)}` }))
        .then((reply) => writeReply(this.spool, request.id, reply))
        .catch((error) => console.error("seatworks-v2: spool reply failed:", error));
    }
  }
}
