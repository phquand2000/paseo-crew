import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { renderPrompt } from "../catalog/content.ts";
import { type Kit, type RoleSpec, can, seatOf } from "../catalog/kit.ts";
import { type AgentConfig, type SessionOpen, applyRole, seatEnv } from "../catalog/launch.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { ensureLink, seatDir, seedRecords } from "../catalog/seats.ts";
import { type IndexedProxy, type Team, indexedProxies, jevOn, watchOn } from "../catalog/team.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "../core/paths.ts";
import { seatsOn, workspacesOn } from "../core/paseo-adapter.ts";
import type { PaseoApi } from "../core/paseo.ts";
import type { Seats, Workspaces } from "../core/ports.ts";
import type { CodeIndex } from "../desk/context.ts";
import { Desk } from "../desk/desk.ts";
import { type Ledger, type Sibling, alongside, laneOfLead, loadLedger, openAsksTo, taskOfPeer } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, gateCommands, loadConfig, projectOf } from "../desk/project.ts";
import { SettingsControl } from "./control.ts";
import { codeIndex } from "./code-index.ts";
import { type Letter, Outbox } from "./outbox.ts";
import { Patrol } from "./patrol.ts";
import { registerRpc } from "./rpc.ts";
import { Seating } from "./seating.ts";
import { spoolDirs, takeRequests, writeReply } from "./spool.ts";
import { TeamSource } from "./team-source.ts";
import { TurnRules } from "./turns.ts";
import { FACT_TITLES, type Fact } from "./watch/facts.ts";
import { type Finding, type Verdict, decide } from "./watch/findings.ts";
import { weigh } from "./watch/jev/rules.ts";
import { keepAssessment, lastKept, readTally } from "./watch/jev/assessments.ts";
import { Assessor, type Reading, type SensorError, type Sensing } from "./watch/jev/sensor.ts";
import { stepText } from "./watch/trail.ts";
import { type SeatContext, type SeatWatch, type WatchedSeat, Watches } from "./watch/watches.ts";
import { Reader } from "./watch/seat/reader.ts";
import { malformed } from "./timeline.ts";
import { loadIncidents } from "../desk/incidents.ts";
import type { WatchSignal, WatchView } from "../../shared/views.ts";
import { errorText } from "../core/errors.ts";

type EventName = keyof PluginLifecycleEvents;

/** How much recent trouble a screen is shown. It is a live view, not a second log. */
const TROUBLES = 10;

/** How many incidents a screen is sent. Its counts stay exact past this; the Supervisor's `incidents` lists them all. */
const INCIDENTS_SHOWN = 200;

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
  private readonly watches: Watches;
  private readonly assessor: Assessor;
  private readonly reader: Reader;
  private readonly sensorNoted = new Map<string, number>();
  private readonly troubles = new Map<string, { kind: string; at: number; detail: string }[]>();
  private readonly offline = new Set<string>();
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
      // Never into a Watcher's turn: a reading steered into one it is halfway through reading is read
      // as part of it. Held, it arrives with the others once that turn is done.
      (seat) => {
        const found = seatOf(kit, seat.provider);
        return found?.harness.steers === true && !can(found.role, "watch");
      },
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
    this.turns = new TurnRules({ kit, desk: this.desk, remember });
    this.assessor = new Assessor({
      sensing: (watch) => this.sensing(watch),
      done: (watch, reading) => this.assessed(watch, reading),
      failed: (watch, error) => this.degraded(watch, error),
    });
    this.reader = new Reader({
      pace: (project) => {
        const attention = this.source.teamFor(project).attention;
        if (attention.by !== "seat") return undefined;
        return { quietMs: attention.watcherQuietSeconds * 1000, everyMs: attention.watcherEveryMinutes * 60_000, chars: attention.watcherChars };
      },
      watcher: async (project) => this.desk.watchers(project, await this.seats.open())[0]?.id,
      post: (to, key, text) => this.desk.post(to, key, text),
    });
    this.watches = new Watches({
      kit,
      seats: this.seats,
      context: (seat) => this.watchContext(seat),
      found: (watch, facts) => this.watchFound(watch, facts),
      on: (seat) => this.watching(projectOf(seat.cwd)),
      // Each reader answers only where the watch is its own: Jev by jev, the Watcher by a seat.
      moment: (watch, urgent) => {
        this.assessor.moment(watch, urgent);
        this.reader.moment(watch, urgent);
      },
      dropped: (id) => {
        this.assessor.drop(id);
        this.reader.drop(id);
      },
    });
    this.patrol = new Patrol({ kit, source: this.source, desk: this.desk, seats: this.seats, outbox: this.outbox, turns: this.turns, watches: this.watches, reader: this.reader, remember });
    this.control = new SettingsControl({
      kit,
      source: this.source,
      seating: this.seating,
      reconcile: (team) => this.reconcileProviders(team),
      seats: this.seats,
      held: () => this.outbox.letters(),
      watch: (project) => this.watchView(project),
    });
  }

  private watchContext(seat: WatchedSeat): SeatContext | undefined {
    const found = seatOf(this.kit, seat.provider);
    if (!found) return undefined;
    const { harness, role } = found;
    const project = projectOf(seat.cwd);
    const attention = this.source.teamFor(project).attention;
    let owned: string[] | undefined;
    let goal: string | null = "";
    // What the Lead told a Peer beyond its goal — a stand-in to write, say — and what is being written
    // beside it in other copies. Without them the sensor read both as the Peer's own invention.
    let context = "";
    let beside: Sibling[] = [];
    try {
      const ledger = loadLedger(project.state);
      const task = taskOfPeer(ledger, seat.id);
      const lane = task ? ledger.lanes[task.lane] : laneOfLead(ledger, seat.id);
      owned = task?.owned;
      if (task) {
        goal = [`Task ${task.id}: ${task.title}`, `Goal: ${task.goal}`, `Acceptance: ${task.acceptance.join("; ")}`, `Out of scope: ${task.outOfScope.join("; ")}`].join("\n");
        context = task.context ?? "";
        beside = alongside(ledger, task);
      }
      else if (lane) goal = [`Lane ${lane.id}: ${lane.title}`, `Outcome: ${lane.outcome}`, `Acceptance: ${lane.acceptance.join("; ")}`, `Out of scope: ${lane.outOfScope.join("; ")}`].join("\n");
    } catch (error) {
      goal = null;
      this.desk.event(project, { kind: "watch.unbriefed", agent: seat.id, error: errorText(error) });
    }
    return {
      goal,
      context,
      beside,
      role: [role.label, role.description].filter(Boolean).join(": "),
      rules: {
        destructive: new RegExp(attention.destructive, "i"),
        testPath: new RegExp(attention.testPath, "i"),
        suppressed: new RegExp(attention.suppressed, "i"),
        exit: harness.exitPattern ? new RegExp(harness.exitPattern) : undefined,
        gates: gateCommands(seat.cwd, loadConfig(project.state).gate),
        cwd: seat.cwd,
        temp: tmpdir(),
        owned,
        repeatsAt: attention.repeatsAt,
        recoverWithin: 10,
      },
      heardSince: (at) => {
        try {
          const handback = taskOfPeer(loadLedger(project.state), seat.id)?.handback;
          return Boolean(handback && handback.at >= at && !handback.gate);
        } catch {
          return false;
        }
      },
    };
  }

  /**
   * The one switch, `attention.by`. By a Watcher seat the watch is always on. By Jev a key is what
   * the watch is made of, so without one there is no watch: no seat is followed, no turn is read,
   * and a lane's history is not gone through either.
   */
  private watching(project: Project): boolean {
    return watchOn(this.source.teamFor(project));
  }

  private sensing(watch: SeatWatch): Sensing | undefined {
    const project = projectOf(watch.seat.cwd);
    const team = this.source.teamFor(project);
    const sensor = team.sensor;
    // Between the key being taken away, or the watch going to a Watcher seat, and the round after.
    if (!sensor || !jevOn(team)) return undefined;
    const brief = watch.brief();
    if (!brief || brief.goal === null) return undefined;
    const { goal, context, beside, role, rules } = brief;
    return { spec: sensor.spec, key: sensor.key, brief: { goal, context, beside, role, gates: rules.gates, workingCopy: watch.seat.cwd }, rules: { exit: rules.exit, destructive: rules.destructive } };
  }

  private assessed(watch: SeatWatch, reading: Reading): void {
    const project = projectOf(watch.seat.cwd);
    const { assessment, views, questions, facts } = reading;
    this.desk.event(project, { kind: "watch.sensor", agent: watch.seat.id, model: assessment.model, id: assessment.id, cost: assessment.cost, answers: assessment.answers, stateChars: JSON.stringify(views).length });
    watch.readings += 1;
    watch.spent += assessment.cost ?? 0;
    watch.readAt = Date.now();
    // Per question, and kept rather than replaced: a screen showing only the last reading says nothing
    // about the turn where something nearly opened an incident. Per question because one overall peak
    // is whatever reads high on every turn — "did it say it is done" — and it hid the one that mattered.
    for (const [question, p] of Object.entries(assessment.answers)) if (p > (watch.peaks.get(question) ?? -1)) watch.peaks.set(question, p);
    const before = watch.reading && watch.reading.turnId === reading.turnId ? watch.reading.answers : undefined;
    watch.reading = { turnId: reading.turnId, answers: assessment.answers };
    const { findings, verdicts } = weigh(assessment, questions, facts, { unclear: reading.spec.unclear, ended: !reading.running, before });
    this.keep(project, watch, reading, findings, verdicts);
    this.judged(watch, verdicts);
    void this.located(watch, reading, findings).then((located) => this.noticed(watch, located));
  }

  /**
   * Each finding a question opened, quoting the step it was about rather than the question itself:
   * the incident then names where to look, and whoever reads it need not search the record for it.
   * A question the sensor answers literally is excused here, in code, when that step speaks of a file
   * a sibling task is writing: what makes such a stand-in expected is the ledger, not the words.
   */
  private async located(watch: SeatWatch, reading: Reading, findings: Finding[]): Promise<Finding[]> {
    const located = await Promise.all(
      findings.map(async (finding) => {
        const question = reading.questions[finding.kind];
        if (!question) return finding;
        const step = await this.assessor.locate(watch, reading, finding.kind);
        if (step?.note && question.excusedBeside) return undefined;
        return step ? { ...finding, quote: `${step.p < 0.5 ? "probably " : ""}${stepText(step)}` } : finding;
      }),
    );
    return located.filter((finding): finding is Finding => finding !== undefined);
  }

  private judged(watch: SeatWatch, verdicts: Verdict[]): void {
    if (verdicts.length === 0 || this.watches.get(watch.seat.id) !== watch) return;
    this.desk.judge(projectOf(watch.seat.cwd), watch.seat, verdicts).catch((error) => console.error("seatworks-v2: what the sensor said of an incident could not be recorded:", error));
  }

  private keep(project: Project, watch: SeatWatch, reading: Reading, findings: Finding[], verdicts: Verdict[]): void {
    const { assessment } = reading;
    const unkept = (error: unknown) => {
      const key = `unkept:${project.slug}`;
      const now = Date.now();
      if (now - (this.sensorNoted.get(key) ?? 0) < 60_000) return;
      this.sensorNoted.set(key, now);
      this.desk.event(project, { kind: "sensor.unkept", error: errorText(error) });
    };
    try {
      keepAssessment(project.state, {
        at: Date.now(),
        askedAt: reading.askedAt,
        seat: watch.seat.id,
        provider: watch.seat.provider,
        turnId: reading.turnId,
        running: reading.running,
        sensor: reading.spec.id,
        model: assessment.model,
        id: assessment.id,
        cost: assessment.cost,
        questions: Object.fromEntries(Object.entries(reading.questions).map(([name, question]) => [name, { view: question.view, instructions: question.instructions, ...(question.criteria ? { criteria: question.criteria } : {}) }])),
        answers: assessment.answers,
        facts: reading.facts.map(({ kind, level, quote }) => ({ kind, level, quote })),
        found: findings.map((finding) => finding.kind),
        verdicts: verdicts.map(({ kind, question, says, p }) => ({ kind, question, says, p })),
        views: reading.views,
      }).catch(unkept);
    } catch (error) {
      unkept(error);
    }
  }

  private noticed(watch: SeatWatch, findings: Finding[]): void {
    if (findings.length === 0 || this.watches.get(watch.seat.id) !== watch) return;
    const project = projectOf(watch.seat.cwd);
    this.desk.notice(project, watch.seat, findings).catch((error) => console.error("seatworks-v2: what the watch noticed could not be recorded:", error));
  }

  private degraded(watch: SeatWatch, error: SensorError): void {
    const project = projectOf(watch.seat.cwd);
    const key = `degraded:${project.slug}`;
    const now = Date.now();
    if (now - (this.sensorNoted.get(key) ?? 0) < 60_000) return;
    this.sensorNoted.set(key, now);
    this.desk.event(project, { kind: "sensor.degraded", agent: watch.seat.id, status: error.status ?? null, error: error.message });
    this.troubled(project, "sensor.degraded", `${watch.seat.id}: ${error.status ?? "no status"} ${error.message}`);
  }

  /** Trouble nobody is mailed about, kept where a screen can show it rather than only in the log. */
  private troubled(project: Project, kind: string, detail: string): void {
    const list = this.troubles.get(project.slug) ?? [];
    list.push({ kind, at: Date.now(), detail });
    if (list.length > TROUBLES) list.splice(0, list.length - TROUBLES);
    this.troubles.set(project.slug, list);
  }

  /**
   * A call the seat's own harness refused before it was made, because the model wrote an input that
   * is not JSON. It never reached the desk, so nothing else here has heard of it: the seat sees the
   * error and usually writes the call again, and until now that was the end of it for everybody else.
   */
  private malformedCalls(event: PluginLifecycleEvents["agent.turn_ended"]): void {
    const role = seatOf(this.kit, event.agent.provider)?.role;
    if (!role?.tools) return;
    const project = projectOf(event.agent.cwd);
    for (const call of malformed(event.timeline)) {
      this.desk.event(project, { kind: "call.malformed", agent: event.agent.id, role: role.role, tool: call.tool, error: call.quote });
      this.troubled(project, "call.malformed", `the ${role.label}'s ${call.tool} was written with an input that is not JSON, and never reached the desk`);
    }
  }

  private watchView(project: Project): WatchView {
    const on = this.watching(project);
    const team = this.source.teamFor(project);
    const questions = team.sensor?.spec.questions ?? {};
    const items = Object.values(loadIncidents(project.state).items);
    const now = Date.now();
    const ago = (at: number) => Math.max(0, Math.round((now - at) / 60_000));
    const titleOf = (kind: string) => questions[kind]?.label ?? FACT_TITLES[kind] ?? kind.replace(/[-_]/g, " ");
    let ledger: Ledger | undefined;
    try {
      ledger = loadLedger(project.state);
    } catch {}

    // What makes a seat worth a look now. An incident still open on it first, the worst of them; else
    // a question past its bar that can open something — one that only judges a fact, like "did it say
    // it is done", reads high on every good turn and would flag them all.
    const signalOf = (watch: SeatWatch): WatchSignal | null => {
      const open = items.filter((item) => item.open && item.seat === watch.seat.id).sort((a, b) => (a.level === b.level ? b.last - a.last : a.level === "page" ? -1 : 1))[0];
      if (open) return { label: titleOf(open.kind), p: open.p ?? null, level: open.level };
      let best: WatchSignal | null = null;
      for (const [name, p] of watch.peaks) {
        const question = questions[name];
        if (!question || question.threshold === undefined || p < question.threshold) continue;
        if (!question.level && !question.agrees?.length) continue;
        if (!best || p > (best.p ?? 0)) best = { label: titleOf(name), p, level: question.level === "page" ? "page" : "attend" };
      }
      return best;
    };
    const placeOf = (id: string) => {
      const task = ledger ? taskOfPeer(ledger, id) : undefined;
      const lane = ledger ? (task ? ledger.lanes[task.lane] : laneOfLead(ledger, id)) : undefined;
      return { lane: lane ? { id: lane.id, title: lane.title } : null, task: task ? { id: task.id, title: task.title } : null };
    };
    const seats = this.watches
      .all()
      .filter((watch) => projectOf(watch.seat.cwd).slug === project.slug)
      .map((watch) => ({
        id: watch.seat.id,
        role: seatOf(this.kit, watch.seat.provider)?.role.role ?? "",
        running: watch.running,
        readings: watch.readings,
        cost: watch.spent,
        minutes: ago(watch.readAt || now),
        ...placeOf(watch.seat.id),
        signal: signalOf(watch),
      }));

    // Most in need of a look first: open and irreversible, open, then what the Supervisor found useful,
    // what it could not judge, and last what it marked noise — newest first within each.
    const rank = (item: (typeof items)[number]) => (item.open ? (item.level === "page" ? 0 : 1) : item.label === "useful" ? 2 : item.label === "unknown" || !item.label ? 3 : 4);
    const incidents = [...items]
      .sort((a, b) => rank(a) - rank(b) || b.last - a.last)
      .slice(0, INCIDENTS_SHOWN)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        title: titleOf(item.kind),
        level: item.level,
        where: item.task ? `Peer on ${item.task}` : item.lane ? `Lead of ${item.lane}` : item.where,
        open: item.open,
        told: item.told !== undefined,
        held: item.open && item.told === undefined ? (item.held ?? null) : null,
        label: item.label ?? null,
        note: (item.note ?? "").slice(0, 240),
        count: item.count,
        minutes: ago(item.last),
      }));
    return {
      on,
      telling: team.attention.watch,
      seats,
      lastRead: lastKept(project.state) ?? null,
      read: readTally(project.state),
      marks: {
        total: items.length,
        open: items.filter((item) => item.open).length,
        held: items.filter((item) => item.open && item.told === undefined).length,
        useful: items.filter((item) => item.label === "useful").length,
        noise: items.filter((item) => item.label === "noise").length,
        unknown: items.filter((item) => item.label === "unknown").length,
      },
      incidents,
      trouble: (this.troubles.get(project.slug) ?? []).map((entry) => ({ kind: entry.kind, minutes: ago(entry.at), detail: entry.detail })).reverse(),
    };
  }

  private watchFound(watch: SeatWatch, facts: Fact[]): void {
    const project = projectOf(watch.seat.cwd);
    for (const fact of facts) this.desk.event(project, { kind: "watch.fact", agent: watch.seat.id, fact: fact.kind, level: fact.level, quote: fact.quote });
    this.noticed(watch, decide(facts));
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
    this.on(server, "agent.created", async ({ agent }) => this.watches.follow(agent));
    this.on(server, "agent.archived", async ({ agent }) => {
      this.outbox.archived(agent.id);
      this.turns.forget(agent.id);
      this.watches.drop(agent.id);
      if (this.watches.watched(agent.provider)) await this.desk.closeIncidents(projectOf(agent.cwd), agent.id);
    });
    this.timers.push(setInterval(() => this.serveSpool(), 500));
    // The cadence is read every time round, so changing it in settings takes hold without a reload.
    const patrol = () => {
      if (this.api) this.patrol.tick().then(() => this.offline.clear(), (error) => this.tickFailed(error));
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
    this.assessor.dispose();
    this.reader.dispose();
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
    this.malformedCalls(event);
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
    this.watches.urgent(agent.id);
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
        .catch((error) => ({ ok: false, text: `The desk failed: ${errorText(error)}` }))
        .then((reply) => writeReply(this.spool, request.id, reply))
        .catch((error) => console.error("seatworks-v2: spool reply failed:", error));
    }
  }
}
