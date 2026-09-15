import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readJson, writeJson } from "./store.ts";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { renderPrompt } from "./content.ts";
import { Desk, hash } from "./desk.ts";
import { type Kit, type RoleSpec, defaultModel, codeServer, harnessOf, roleOf, seatRoles, teamServer } from "./kit.ts";
import { applyRole, seatEnv } from "./launch.ts";
import { activeTasks, laneOfLead, loadLedger, openAsksFrom, openAsksTo, taskOfPeer } from "./ledger.ts";
import { clip, letters } from "./letters.ts";
import { type Letter, Outbox, type PaseoApi } from "./outbox.ts";
import { type Ide, ideClient } from "./ide.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "./paths.ts";
import { type Project, loadConfig, projectOf } from "./project.ts";
import { applyReconcile, reloadDaemon } from "./providers.ts";
import { ensureLink, materialize, seatDir, seedRecords } from "./seats.ts";
import { spoolDirs, takeRequests, writeReply } from "./spool.ts";
import { type SeatView, statusText } from "./status.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";
import { URGENT, parseVerdicts, runWatcher, watcherPrompt } from "./watcher.ts";

type EventName = keyof PluginLifecycleEvents;
type Watch = { project: Project; lane: string; agent: string; role: string; where: string; text: string };

const watchFile = () => join(stateRoot(), "watch-queue.json");

const CUES =
  /\b(but|hold on|wait(ing)? (for|on)|actually|turns out|not sure|workaround|for now|instead|revert(ed)?|rm -rf|reset --hard|force[- ]push|drop (table|database)|skip(ped|ping)?|flaky|once .{1,40} lands?|let me know|should i|is (this|that) (ok|allowed)|shim|adapter|compat(ibility)?|bridge|backward|legacy|temporar(y|ily)|stub|placeholder|re-?export)\b|chờ|đợi|tạm dừng|dừng lại|không chắc|hóa ra|hoá ra|sai rồi|bỏ qua|tạm thời|tương thích|xóa|xoá/i;

export class Runtime {
  readonly kit: Kit;
  readonly outbox: Outbox;
  readonly desk: Desk;
  readonly spool = spoolDir();
  readonly node = nodeBin();
  private api: PaseoApi | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private watching = false;
  private watchFailures = 0;
  private readonly watchQueue: Watch[] = [];
  private readonly seated = new Set<string>();
  private readonly turnStart = new Map<string, number>();
  private readonly lastEnding = new Map<string, string>();
  private readonly idleFlag = new Map<string, string>();
  private readonly goneFlag = new Set<string>();

  constructor(kit: Kit, outboxFile = outboxPath(), ide: Ide | null = kit.code.ide ? ideClient(kit.code.ide) : null) {
    this.kit = kit;
    this.outbox = new Outbox(outboxFile, (to, list) => this.compose(to, list));
    this.desk = new Desk(kit, this.outbox, (project, line) => this.log(project, line), ide);
    const saved = readJson<Watch[]>(watchFile(), []);
    if (Array.isArray(saved)) this.watchQueue.push(...saved);
  }

  private saveWatchQueue(): void {
    try {
      writeJson(watchFile(), this.watchQueue);
    } catch (error) {
      console.error("seatworks-v2: watch queue write failed:", error);
    }
  }

  prepare(): void {
    try {
      mkdirSync(stateRoot(), { recursive: true });
      spoolDirs(this.spool);
      ensureLink(guidesDir(), join(this.kit.dir, "content", "guides"));
    } catch (error) {
      console.error("seatworks-v2: could not prepare the state directory:", error);
    }
    for (const role of this.kit.roles) this.ensureSeat(role);
    try {
      const changed = applyReconcile(this.kit);
      if (changed.length > 0) {
        console.log(`seatworks-v2: config updated (${changed.join(", ")}); reloading the daemon`);
        void reloadDaemon();
      }
    } catch (error) {
      console.error("seatworks-v2: could not reconcile role providers:", error);
    }
  }

  servers(role: RoleSpec) {
    return { ...teamServer(this.kit, role, this.spool, this.node), ...codeServer(this.kit, role, this.node) };
  }

  ensureSeat(role: RoleSpec): void {
    if (this.seated.has(role.role)) return;
    try {
      const changes = materialize(this.kit, role, home(), this.servers(role));
      if (changes.length > 0) console.log(`seatworks-v2: seat ${role.role} updated: ${changes.join(", ")}`);
      this.seated.add(role.role);
    } catch (error) {
      console.error(`seatworks-v2: seat ${role.role} could not be built:`, error);
    }
  }

  log(project: Project, line: string): void {
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

  private on<N extends EventName>(
    server: PluginServerContext,
    name: N,
    handler: (event: PluginLifecycleEvents[N], context: PluginHookContext) => Promise<void>,
  ): void {
    server.on(name, async (event, context) => {
      this.api = context.paseo;
      try {
        await handler(event, context);
      } catch (error) {
        console.error(`seatworks-v2: ${name} handler failed:`, error);
      }
    });
  }

  register(server: PluginServerContext): void {
    const direct = (server as unknown as { paseo?: PaseoApi }).paseo;
    if (direct) this.api = direct;

    server.before("agent.create", ({ request }, context) => {
      this.api = context.paseo;
      const role = roleOf(this.kit, request.config.provider);
      if (!role) return request;
      this.ensureSeat(role);
      const project = projectOf(request.config.cwd);
      const config = applyRole(
        this.kit,
        request.config,
        (entry) => renderPrompt(this.kit, entry, { guides: guidesDir(), state: project.state }),
        project.state,
        this.servers(role),
      );
      return { ...request, config };
    });

    server.before("agent.session_open", ({ request }, context) => {
      this.api = context.paseo;
      const role = roleOf(this.kit, request.provider);
      if (!role) return request;
      this.ensureSeat(role);
      const project = projectOf(request.cwd);
      try {
        seedRecords(this.kit, project.state);
      } catch (error) {
        console.error("seatworks-v2: could not seed project records:", error);
      }
      return seatEnv(this.kit, request, (entry) => seatDir(this.kit, entry), project);
    });

    this.on(server, "agent.turn_started", async ({ agent }) => {
      this.turnStart.set(agent.id, Date.now());
    });

    this.on(server, "agent.turn_ended", async (event, { paseo }) => {
      this.outbox.turnEnded(event.agent.id);
      if (this.desk.pendingArchive.has(event.agent.id)) {
        await this.desk.archive(paseo, event.agent.id, true);
        return;
      }
      await this.turnEnded(paseo, event);
      await this.outbox.pump(paseo, event.agent.id);
    });

    this.on(server, "agent.permission_requested", async ({ agent, request }, { paseo }) => {
      const role = roleOf(this.kit, agent.provider);
      if (!role?.team) return;
      const project = projectOf(agent.cwd);
      const what = request.title ?? request.name ?? request.kind;
      if (role.team === "supervisor") {
        this.log(project, `waiting on the Human: ${agent.id} ${what}`);
        return;
      }
      const owner = await this.ownerOf(paseo, project, agent.id, role);
      await this.desk.post(paseo, owner, `permission:${agent.id}:${request.id}`, letters.permission(`${role.label} ${agent.title ?? agent.id}`, what));
    });

    this.on(server, "agent.archived", async ({ agent }) => {
      this.outbox.archived(agent.id);
      this.turnStart.delete(agent.id);
      this.lastEnding.delete(agent.id);
    });

    this.scheduleWatch();
    this.timers.push(
      setInterval(() => this.serveSpool(), 500),
      setInterval(() => {
        this.tick().catch((error) => console.error("seatworks-v2: tick failed:", error));
      }, this.kit.attention.tickSeconds * 1000),
    );
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

  private async ownerOf(paseo: PaseoApi, project: Project, agentId: string, role: RoleSpec): Promise<string | undefined> {
    const ledger = loadLedger(project.state);
    if (role.team === "lead") return this.desk.supervisorFor(paseo, project, laneOfLead(ledger, agentId)?.opener);
    const task = taskOfPeer(ledger, agentId);
    return task ? ledger.lanes[task.lane]?.lead : undefined;
  }

  private async turnEnded(paseo: PaseoApi, event: PluginLifecycleEvents["agent.turn_ended"]): Promise<void> {
    const { agent, outcome, timeline } = event;
    const role = roleOf(this.kit, agent.provider);
    if (!role?.team) return;
    const project = projectOf(agent.cwd);
    this.desk.projects.set(project.slug, project);
    const started = this.turnStart.get(agent.id) ?? Date.now() - 30 * 60_000;
    this.turnStart.delete(agent.id);
    if (outcome.kind === "canceled") return;
    const text = outputText(timeline);
    this.lastEnding.set(agent.id, text);
    if (outcome.kind === "failed") {
      const owner = await this.ownerOf(paseo, project, agent.id, role);
      await this.desk.post(paseo, owner, `failed:${agent.id}:${event.turnId ?? Date.now()}`, letters.failed(`${role.label} ${agent.title ?? agent.id}`, outcome.error.message));
      return;
    }
    const ledger = loadLedger(project.state);
    const recorded = (ledger.agents[agent.id]?.recordedAt ?? 0) >= started;
    if (role.team === "peer" || role.team === "reviewer") {
      const task = taskOfPeer(ledger, agent.id);
      if (!task) return;
      const lane = ledger.lanes[task.lane];
      if (["merged", "cut", "queued", "merging"].includes(task.status)) return;
      if (recorded || task.status === "done") {
        if (lane && CUES.test(text)) this.watch({ project, lane: lane.id, agent: agent.id, role: role.team, where: `the Peer on ${task.id} (${task.title})`, text });
        return;
      }
      const denied = deniedCall(timeline);
      this.desk.event(project, { kind: "turn.silent", task: task.id, denied: denied ?? null, lastCall: JSON.stringify(lastToolCall(timeline) ?? null).slice(0, 600) });
      const updated = await this.desk.setTask(project, task.id, (entry) => {
        entry.silent += 1;
        if (entry.silent >= 2 || denied) entry.status = "stalled";
      });
      if (!updated) return;
      if (updated.status !== "stalled") {
        await this.desk.post(paseo, agent.id, `nudge:${task.id}:${updated.silent}:${Date.now()}`, letters.nudge("done"));
        return;
      }
      await this.desk.post(paseo, lane?.lead, `silent:${task.id}:${updated.silent}`, letters.stalled(task, text, denied));
      this.desk.event(project, { kind: "task.silent", task: task.id, denied: denied ?? null });
      return;
    }
    if (role.team === "lead") {
      const lane = laneOfLead(ledger, agent.id);
      if (!lane) return;
      const busy = activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, agent.id).length > 0;
      if (CUES.test(text) || (!recorded && !busy)) {
        this.watch({ project, lane: lane.id, agent: agent.id, role: "lead", where: `the Lead of ${lane.id} (${lane.title})`, text });
      }
    }
  }

  private watch(item: Watch): void {
    const watcher = this.kit.roles.find((role) => role.headless);
    if (!watcher || !item.text.trim()) return;
    this.watchQueue.push({ ...item, text: clip(item.text.slice(-1500), 1500) });
    this.saveWatchQueue();
    this.scheduleWatch();
  }

  private scheduleWatch(): void {
    if (this.watchTimer || this.watching || this.watchQueue.length === 0) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      this.runWatch().catch((error) => console.error("seatworks-v2: watcher failed:", error));
    }, this.kit.attention.watcherDebounceSeconds * 1000);
  }

  private async runWatch(): Promise<void> {
    const paseo = this.api;
    const watcher = this.kit.roles.find((role) => role.headless);
    const batch = this.watchQueue.splice(0, 10);
    this.saveWatchQueue();
    if (!paseo || !watcher || batch.length === 0) return;
    this.watching = true;
    try {
      const command = harnessOf(this.kit, watcher).headless;
      if (!command) return;
      const instructions = readFileSync(join(this.kit.dir, "content", watcher.prompt), "utf-8");
      const endings = batch.map((item, index) => ({ n: index + 1, agent: item.agent, role: item.role, title: item.where, text: item.text }));
      const seat = { [harnessOf(this.kit, watcher).configDirEnv]: seatDir(this.kit, watcher) };
      const run = await runWatcher(command, watcherPrompt(instructions, endings), defaultModel(watcher)?.id ?? "", this.kit.attention.watcherTimeoutSeconds * 1000, seat);
      const verdicts = run.ok ? parseVerdicts(run.output, endings.length) : [];
      if (verdicts.length === 0) {
        this.watchFailures += 1;
        for (const item of batch) this.log(item.project, `watcher gave no verdicts (${this.watchFailures} in a row): ${clip(run.output.trim(), 300)}`);
        if (this.watchFailures === 3) {
          const first = batch[0]!;
          const lane = loadLedger(first.project.state).lanes[first.lane];
          const to = await this.desk.supervisorFor(paseo, first.project, lane?.opener);
          await this.desk.post(paseo, to, `watcher-down:${Date.now()}`, letters.attention("watcher unavailable", "the team", clip(run.output.trim(), 400)));
        }
        return;
      }
      this.watchFailures = 0;
      for (const verdict of verdicts) {
        const item = batch[verdict.n - 1];
        if (!item) continue;
        this.desk.event(item.project, { kind: "watch", agent: item.agent, label: verdict.label, quote: verdict.quote });
        const raise = URGENT.includes(verdict.label) && (item.role === "lead" || verdict.label !== "unheard-wait");
        if (!raise) continue;
        const lane = loadLedger(item.project.state).lanes[item.lane];
        if (!lane || lane.status !== "open") continue;
        const handle = paseo.agents.ref(item.agent);
        await handle.refresh();
        if (handle.archivedAt) continue;
        const to = await this.desk.supervisorFor(paseo, item.project, lane?.opener);
        await this.desk.post(paseo, to, `attention:${item.agent}:${hash(verdict.label, verdict.quote)}`, letters.attention(verdict.label, item.where, verdict.quote || clip(item.text.trim(), 200)));
      }
    } finally {
      this.watching = false;
      this.scheduleWatch();
    }
  }

  async tick(now = Date.now()): Promise<void> {
    const paseo = this.api;
    if (!paseo) return;
    const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
    const seats = new Map<string, SeatView>();
    for (const entry of entries) {
      const seat = entry.agent as unknown as SeatView;
      if (seat.archivedAt) continue;
      seats.set(seat.id, seat);
      if (roleOf(this.kit, seat.provider)?.team) {
        const project = projectOf(seat.cwd);
        this.desk.projects.set(project.slug, project);
      }
    }
    const { leadIdleMinutes, askRemindMinutes, maxReminders } = this.kit.attention;
    for (const project of this.desk.projects.values()) {
      const ledger = loadLedger(project.state);
      for (const lane of Object.values(ledger.lanes).filter((entry) => entry.status === "open" && entry.lead)) {
        const lead = seats.get(lane.lead!);
        if (!lead || lead.status !== "idle") continue;
        const idle = now - Date.parse(lead.updatedAt);
        if (idle < leadIdleMinutes * 60_000 || this.idleFlag.get(lead.id) === lead.updatedAt) continue;
        if (activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, lead.id).length > 0) continue;
        this.idleFlag.set(lead.id, lead.updatedAt);
        const to = await this.desk.supervisorFor(paseo, project, lane.opener);
        await this.desk.post(paseo, to, `idle:${lane.id}:${lead.updatedAt}`, letters.laneIdle(lane, Math.round(idle / 60_000), this.lastEnding.get(lead.id) ?? ""));
      }
      for (const task of Object.values(ledger.tasks).filter((entry) => ["running", "rework"].includes(entry.status) && entry.peer)) {
        if (seats.has(task.peer!) || this.goneFlag.has(task.id)) continue;
        this.goneFlag.add(task.id);
        await this.desk.setTask(project, task.id, (entry) => {
          entry.status = "stalled";
        });
        await this.desk.post(paseo, ledger.lanes[task.lane]?.lead, `gone:${task.id}`, letters.failed(`the Peer on ${task.id} (${task.title})`, "its agent was closed or archived"));
      }
      const due = Object.values(ledger.asks).filter(
        (ask) => ask.status === "open" && seats.get(ask.to)?.status === "idle" && now - (ask.remindedAt ?? ask.openedAt) >= askRemindMinutes * 60_000,
      );
      for (const ask of due) {
        const age = Math.round((now - ask.openedAt) / 60_000);
        if (ask.reminders < maxReminders) {
          await this.desk.post(paseo, ask.to, `remind:${ask.id}:${ask.reminders}`, letters.reminder(ask, age));
        } else if (ask.fromRole !== "lead" && !ask.escalated) {
          const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
          const to = await this.desk.supervisorFor(paseo, project, lane?.opener);
          await this.desk.post(paseo, to, `escalate:${ask.id}`, letters.escalated(ask, age, ask.lane ?? "the project"));
        } else continue;
        await this.desk.ledger(project, (current) => {
          const entry = current.asks[ask.id];
          if (!entry) return;
          if (entry.reminders < maxReminders) entry.reminders += 1;
          else entry.escalated = true;
          entry.remindedAt = now;
        });
      }
      try {
        const waiting = [...seats.values()].filter(
          (seat) => roleOf(this.kit, seat.provider)?.team === "supervisor" && projectOf(seat.cwd).slug === project.slug && (seat.pendingPermissions?.length ?? 0) > 0,
        );
        mkdirSync(project.state, { recursive: true });
        writeFileSync(join(project.state, "status.md"), statusText(project, loadLedger(project.state), loadConfig(project.state), seats, now, undefined, waiting));
      } catch (error) {
        console.error("seatworks-v2: status write failed:", error);
      }
    }
    const targets = new Set(this.outbox.letters().map((letter) => letter.to));
    for (const to of targets) await this.outbox.pump(paseo, to);
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = undefined;
  }
}
