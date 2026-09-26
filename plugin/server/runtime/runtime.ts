import { mkdirSync } from "node:fs";
import type { Kit, SensorSpec } from "../catalog/kit/kit.ts";
import type { ModelCache } from "../catalog/paseo/models.ts";
import { reloadDaemon } from "../catalog/paseo/providers.ts";
import { type IndexedProxy, choicesFor, indexedProxies } from "../catalog/seat/servers.ts";
import { placeGuides, sweepSnapshots } from "../catalog/seat/snapshots.ts";
import { errorText } from "../core/errors.ts";
import { daemonLog } from "../core/logger.ts";
import { deskSocket, home, nodeBin, outboxPath, stateRoot } from "../core/paths.ts";
import type {
  AgentConfig,
  HookAgent,
  Host,
  HostHooks,
  Judge,
  PermissionRequested,
  SessionOpen,
  TurnEnded,
} from "../core/ports.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { appendRecord } from "../desk/store/records.ts";
import { TOOLS } from "../desk/tools/registry.ts";
import { stampKit } from "../upkeep/migrate.ts";
import { codeIndex } from "./code-index.ts";
import { SettingsControl } from "./control.ts";
import { SeatKeys } from "./keys.ts";
import { composeMail, mailRules } from "./mail-rules.ts";
import { Outbox } from "./outbox.ts";
import { Patrol } from "./patrol.ts";
import { PatrolClock } from "./patrol-clock.ts";
import { ProviderSync } from "./provider-sync.ts";
import { SeatLaunch } from "./seat-launch.ts";
import { Seating } from "./seating.ts";
import { TeamSocket } from "./team-socket.ts";
import { TeamSource } from "./team-source.ts";
import { TurnRules } from "./turns.ts";
import { Watches } from "./watch/watches.ts";
import { watchView } from "./watch-view.ts";
import { Watching } from "./watching.ts";

type RuntimeOptions = {
  outboxFile?: string;
  codeIndex?: (proxy: IndexedProxy) => CodeIndex;
  reloadDaemon?: () => Promise<boolean>;
  sensor?: (spec: SensorSpec, key: string) => Judge;
};

export class Runtime implements HostHooks {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly control: SettingsControl;
  private readonly keys = new SeatKeys();
  private readonly socket: TeamSocket;
  private readonly source: TeamSource;
  private readonly seating: Seating;
  private readonly turns: TurnRules;
  private readonly patrol: Patrol;
  private readonly watches: Watches;
  private readonly watching: Watching;
  private readonly sync: ProviderSync;
  private readonly launch: SeatLaunch;
  private readonly clock: PatrolClock;
  private readonly makeIndex: (proxy: IndexedProxy) => CodeIndex;
  private readonly host: Host;

  constructor(kit: Kit, host: Host, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.host = host;
    this.makeIndex = options.codeIndex ?? codeIndex;
    this.source = new TeamSource(kit);
    this.seating = new Seating(kit, this.source, { node: nodeBin(), socket: deskSocket() });
    const rules = mailRules(kit, (agentId) => this.socket.calling(agentId));
    const compose = (to: string, list: Parameters<typeof composeMail>[2]) => composeMail(host.seats, to, list);
    this.outbox = new Outbox(options.outboxFile ?? outboxPath(), compose, host.seats, rules);
    const log = (project: Project, line: string) => this.log(project, line);
    const remember = (project: Project) => this.remember(project);
    this.desk = new Desk({
      kit,
      tools: TOOLS,
      outbox: this.outbox,
      seats: host.seats,
      workspaces: host.workspaces,
      log,
      teamFor: (project) => this.source.teamFor(project),
      indexesFor: (project) => this.indexesFor(project),
      sensor: options.sensor,
    });
    this.socket = this.teamSocket();
    this.turns = new TurnRules({ kit, desk: this.desk, seats: host.seats, remember, log });
    this.watching = new Watching({ kit, source: this.source, desk: this.desk, watches: () => this.watches });
    this.watches = this.watchesOf(kit);
    this.patrol = new Patrol({
      kit,
      source: this.source,
      desk: this.desk,
      seats: host.seats,
      outbox: this.outbox,
      turns: this.turns,
      watches: this.watches,
      remember,
    });
    this.clock = new PatrolClock({ host, patrol: this.patrol, source: this.source, desk: this.desk });
    const reload = options.reloadDaemon ?? reloadDaemon;
    this.sync = new ProviderSync({
      kit,
      models: host.models,
      source: this.source,
      reload,
      modelsChanged: () => this.seating.forget(),
    });
    this.launch = new SeatLaunch(kit, this.seating, this.keys, remember);
    this.control = this.controlOf(kit);
  }

  private watchesOf(kit: Kit): Watches {
    return new Watches({
      kit,
      seats: this.host.seats,
      context: (seat) => this.watching.context(seat),
      found: (watch, facts) => this.watching.found(watch, facts),
      spoke: (seat, text) =>
        void this.turns
          .spoke(seat, text)
          .catch((error: unknown) =>
            daemonLog.error("a word the Human wrote to a seat could not be passed on:", error),
          ),
    });
  }

  private controlOf(kit: Kit): SettingsControl {
    return new SettingsControl({
      kit,
      source: this.source,
      changed: () => this.teamChanged(),
      reconcile: () => this.sync.reconcile(),
      models: () => this.refreshModels(),
      seats: this.host.seats,
      held: () => this.outbox.held(),
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
      answer: (request, cancelled) =>
        this.host
          .reached()
          .then(() => this.desk.answer(request, { cancelled }))
          .catch((error) => ({ ok: false, text: `The desk failed: ${errorText(error)}` })),
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
      daemonLog.error("could not prepare the state directory:", error);
    }
    for (const problem of this.source.teamFor().errors) daemonLog.error(`settings: ${problem}`);
    this.sync.reconcile();
  }

  /** A panel call is the first sign someone looks at the models, so the first one of a load asks the agents for them. */
  panelCalled(): void {
    this.sync.firstLook();
  }

  create(config: AgentConfig, env: Record<string, string> = {}): { config: AgentConfig; env: Record<string, string> } {
    return this.launch.create(config, env);
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
    this.clock.start();
  }

  dispose(): void {
    this.socket.close();
    this.watches.dispose();
    this.clock.stop();
  }

  sessionOpen(request: SessionOpen): SessionOpen {
    return this.launch.sessionOpen(request);
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

  refreshModels(): Promise<ModelCache> {
    return this.sync.refreshModels();
  }

  private log(project: Project, line: string): void {
    appendRecord(project.state, "attention", `${new Date().toISOString()}  ${line}\n`);
  }
}
