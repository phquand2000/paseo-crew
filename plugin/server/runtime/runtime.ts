import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginServerContext } from "@getpaseo/plugin/server";
import { renderPrompt } from "../catalog/content.ts";
import { Desk, hash } from "../desk/desk.ts";
import { type Check, doctor } from "./doctor.ts";
import { type Ide, ideClient } from "./ide.ts";
import { type HarnessSpec, type Kit, type RoleSpec, headlessRole, providerId, seatOf, supportsRole } from "../catalog/kit.ts";
import { applyRole, seatEnv } from "../catalog/launch.ts";
import { activeTasks, laneOfLead, loadLedger, openAsksFrom, openAsksTo, taskOfPeer } from "../desk/ledger.ts";
import { clip, letters } from "../desk/letters.ts";
import { type Letter, Outbox, type PaseoApi } from "./outbox.ts";
import { guidesDir, home, nodeBin, outboxPath, spoolDir, stateRoot } from "../core/paths.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { applyReconcile, reloadDaemon } from "../catalog/providers.ts";
import { type Control, registerRpc } from "./rpc.ts";
import { ensureLink, materialize, seatDir, seedRecords } from "../catalog/seats.ts";
import { type Layer, MachineLayerSchema, ProjectLayerSchema, type ReadResult, type WriteResult, layerValues, readLayer, writeLayer } from "../catalog/settings.ts";
import { spoolDirs, takeRequests, writeReply } from "./spool.ts";
import { type SeatView, statusText } from "../desk/status.ts";
import { readJson, writeJson } from "../core/store.ts";
import { type Team, eligibleRoles, ideUrl, resolveTeam, rulesFor, serversFor, skillDirsFor, transportOf, withHarness } from "../catalog/team.ts";
import { deniedCall, lastToolCall, outputText } from "./timeline.ts";
import { URGENT, parseVerdicts, runWatcher, watcherPrompt } from "./watcher.ts";

type EventName = keyof PluginLifecycleEvents;
type Watch = { project: Project; lane: string; agent: string; role: string; where: string; text: string };

const watchFile = () => join(stateRoot(), "watch-queue.json");

const CUES =
  /\b(but|hold on|wait(ing)? (for|on)|actually|turns out|not sure|workaround|for now|instead|revert(ed)?|rm -rf|reset --hard|force[- ]push|drop (table|database)|skip(ped|ping)?|flaky|once .{1,40} lands?|let me know|should i|is (this|that) (ok|allowed)|shim|adapter|compat(ibility)?|bridge|backward|legacy|temporar(y|ily)|stub|placeholder|re-?export)\b|chờ|đợi|tạm dừng|dừng lại|không chắc|hóa ra|hoá ra|sai rồi|bỏ qua|tạm thời|tương thích|xóa|xoá/i;

export type RuntimeOptions = { outboxFile?: string; ideClient?: (url: string) => Ide | null; reloadDaemon?: () => Promise<boolean> };

export class Runtime implements Control {
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
  private readonly makeIde: (url: string) => Ide | null;
  private readonly reload: () => Promise<boolean>;
  private readonly watchQueue: Watch[] = [];
  private readonly seated = new Set<string>();
  private readonly remembered = new Set<string>();
  private readonly turnStart = new Map<string, number>();
  private readonly lastEnding = new Map<string, string>();
  private readonly idleFlag = new Map<string, string>();
  private readonly goneFlag = new Set<string>();

  constructor(kit: Kit, options: RuntimeOptions = {}) {
    this.kit = kit;
    this.makeIde = options.ideClient ?? ((url) => ideClient(url));
    this.reload = options.reloadDaemon ?? reloadDaemon;
    this.outbox = new Outbox(options.outboxFile ?? outboxPath(), (to, list) => this.compose(to, list));
    this.desk = new Desk(
      kit,
      this.outbox,
      (project, line) => this.log(project, line),
      (project) => this.teamFor(project),
      (project) => this.ideFor(project),
    );
    const saved = readJson<Watch[]>(watchFile(), []);
    if (Array.isArray(saved)) this.watchQueue.push(...saved);
  }

  machineSettingsFile(): string {
    return join(stateRoot(), "settings.json");
  }

  projectSettingsFile(project: Project): string {
    return join(project.state, "settings.json");
  }

  teamFor(project?: Project): Team {
    const machine = layerValues(this.machineSettingsFile(), MachineLayerSchema);
    const local = project ? layerValues(this.projectSettingsFile(project), ProjectLayerSchema) : {};
    return resolveTeam(this.kit, machine, local);
  }

  private ideFor(project: Project): Ide | null {
    const url = ideUrl(this.teamFor(project));
    return url ? this.makeIde(url) : null;
  }

  private settingsKey(project?: Project): string {
    const machine = readLayer(this.machineSettingsFile(), MachineLayerSchema).revision;
    const local = project ? readLayer(this.projectSettingsFile(project), ProjectLayerSchema).revision : "";
    return `${machine}:${local}`;
  }

  private rememberProject(project: Project): void {
    this.desk.projects.set(project.slug, project);
    if (this.remembered.has(project.slug)) return;
    try {
      mkdirSync(project.state, { recursive: true });
      writeJson(join(project.state, "meta.json"), { root: project.root, slug: project.slug });
      this.remembered.add(project.slug);
    } catch (error) {
      console.error("seatworks-v2: could not record the project:", error);
    }
  }

  private knownProjects(): Project[] {
    const root = join(stateRoot(), "projects");
    if (!existsSync(root)) return [];
    const found: Project[] = [];
    for (const slug of readdirSync(root)) {
      const meta = readJson<{ root?: string; slug?: string }>(join(root, slug, "meta.json"), {});
      if (typeof meta.root === "string" && meta.slug === slug) found.push({ root: meta.root, slug, state: join(root, slug) });
    }
    return found.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private projectNamed(slug: string): Project | undefined {
    return this.knownProjects().find((project) => project.slug === slug);
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
    const team = this.teamFor();
    for (const problem of team.errors) console.error(`seatworks-v2: settings: ${problem}`);
    const watcher = headlessRole(this.kit);
    const seat = watcher ? team.roles[watcher.role] : undefined;
    if (watcher && seat) this.ensureSeat(watcher.role, seat.harness);
    this.reconcileProviders(team);
  }

  private reconcileProviders(team: Team): void {
    try {
      const changed = applyReconcile(this.kit, team);
      if (changed.length > 0) {
        console.log(`seatworks-v2: config updated (${changed.join(", ")}); reloading the daemon`);
        void this.reload();
      }
    } catch (error) {
      console.error("seatworks-v2: could not reconcile role providers:", error);
    }
  }

  private ensureSeat(roleName: string, harness: HarnessSpec, project?: Project): Team {
    const team = withHarness(this.teamFor(project), roleName, harness);
    const key = `${roleName}|${harness.id}|${project?.slug ?? ""}|${this.settingsKey(project)}`;
    if (this.seated.has(key)) return team;
    try {
      const servers = serversFor(this.kit, team, roleName, { node: this.node, spool: this.spool });
      const changes = materialize(this.kit, team, roleName, home(), project, servers);
      if (changes.length > 0) console.log(`seatworks-v2: seat ${roleName} on ${harness.id}${project ? ` for ${project.slug}` : ""} updated: ${changes.join(", ")}`);
      this.seated.add(key);
    } catch (error) {
      console.error(`seatworks-v2: seat ${roleName} on ${harness.id} could not be built:`, error);
    }
    return team;
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
    registerRpc(server, this);

    server.before("agent.create", ({ request }, context) => {
      this.api = context.paseo;
      const seat = seatOf(this.kit, request.config.provider);
      if (!seat) return request;
      const project = projectOf(request.config.cwd);
      this.rememberProject(project);
      const team = this.ensureSeat(seat.role.role, seat.harness, project);
      const config = applyRole(
        this.kit,
        team,
        request.config,
        (entry) => renderPrompt(this.kit, entry, { guides: guidesDir(), state: project.state }),
        project.state,
        serversFor(this.kit, team, seat.role.role, { node: this.node, spool: this.spool }),
      );
      return { ...request, config };
    });

    server.before("agent.session_open", ({ request }, context) => {
      this.api = context.paseo;
      const seat = seatOf(this.kit, request.provider);
      if (!seat) return request;
      const project = projectOf(request.cwd);
      this.rememberProject(project);
      try {
        seedRecords(this.kit, project.state);
      } catch (error) {
        console.error("seatworks-v2: could not seed project records:", error);
      }
      this.ensureSeat(seat.role.role, seat.harness, project);
      return seatEnv(this.kit, request, seatDir(this.kit, seat.role, seat.harness, home(), project), project);
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
      const role = seatOf(this.kit, agent.provider)?.role;
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
      }, this.teamFor().attention.tickSeconds * 1000),
    );
  }

  catalog(): unknown {
    const kit = this.kit;
    return {
      roles: kit.roles.map((role) => ({
        id: role.role,
        label: role.label,
        description: role.description ?? "",
        team: role.team ?? null,
        headless: Boolean(role.headless),
        defaults: role.defaults,
        harnesses: Object.values(kit.harnesses)
          .filter((harness) => supportsRole(kit, harness, role) && (!role.headless || Boolean(harness.headless)))
          .map((harness) => harness.id),
      })),
      harnesses: Object.values(kit.harnesses).map((harness) => ({
        id: harness.id,
        label: harness.label,
        models: harness.models ?? [],
        thinking: harness.hasThinking !== false,
        transports: harness.mcp.transports,
        headless: Boolean(harness.headless),
      })),
      mcp: Object.values(kit.mcp)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        .map((entry) => ({
          id: entry.id,
          label: entry.label,
          description: entry.description ?? "",
          kind: entry.kind,
          transport: transportOf(entry),
          settings: entry.settings,
          defaults: entry.defaults,
          roles: eligibleRoles(entry),
        })),
    };
  }

  private settingsTarget(slug?: string): { file: string; schema: typeof MachineLayerSchema | typeof ProjectLayerSchema; project?: Project } | { error: string } {
    if (!slug) return { file: this.machineSettingsFile(), schema: MachineLayerSchema };
    const project = this.projectNamed(slug);
    if (!project) return { error: `No project named ${slug} has been seen on this machine.` };
    return { file: this.projectSettingsFile(project), schema: ProjectLayerSchema, project };
  }

  readSettings(slug?: string): ReadResult {
    const target = this.settingsTarget(slug);
    if ("error" in target) return { status: "invalid", revision: "", error: target.error };
    return readLayer(target.file, target.schema);
  }

  writeSettings(slug: string | undefined, revision: string, values: unknown): WriteResult {
    const target = this.settingsTarget(slug);
    if ("error" in target) return { status: "invalid", error: target.error };
    const machine = layerValues(this.machineSettingsFile(), MachineLayerSchema);
    const check = (layer: Layer) => (target.project ? resolveTeam(this.kit, machine, layer) : resolveTeam(this.kit, layer)).errors;
    const result = writeLayer(target.file, target.schema, revision, values, check);
    if (result.status === "saved") {
      this.seated.clear();
      if (!target.project) this.reconcileProviders(this.teamFor());
    }
    return result;
  }

  resetSettings(slug: string | undefined, revision: string): WriteResult {
    return this.writeSettings(slug, revision, {});
  }

  projects(): unknown {
    return this.knownProjects().map((project) => ({ slug: project.slug, root: project.root }));
  }

  team(slug?: string): unknown {
    const project = slug ? this.projectNamed(slug) : undefined;
    if (slug && !project) return { errors: [`No project named ${slug} has been seen on this machine.`] };
    const team = this.teamFor(project);
    return {
      project: project?.slug ?? null,
      errors: team.errors,
      limits: team.limits,
      attention: team.attention,
      rules: team.rules,
      mcp: Object.fromEntries(Object.entries(team.mcp).map(([id, state]) => [id, { enabled: state.enabled, roles: state.roles, settings: state.settings }])),
      roles: Object.fromEntries(
        Object.entries(team.roles).map(([name, seat]) => [
          name,
          {
            harness: seat.harness.id,
            provider: seat.role.headless ? null : providerId(this.kit, name, seat.harness.id),
            model: seat.model?.id ?? null,
            thinking: seat.thinking ?? null,
            mcp: seat.mcp,
            tools: Object.fromEntries(seat.mcp.map((id) => [id, team.mcp[id]!.entry.tools?.[name] ?? []])),
            skills: [...skillDirsFor(team, name).keys()],
            rules: rulesFor(team, name),
          },
        ]),
      ),
    };
  }

  async doctor(slug?: string): Promise<Check[]> {
    const project = slug ? this.projectNamed(slug) : undefined;
    if (slug && !project) return [{ id: "project", ok: false, detail: `No project named ${slug} has been seen on this machine.` }];
    return doctor(this.kit, this.teamFor(project));
  }

  async status(slug: string): Promise<unknown> {
    const project = this.projectNamed(slug);
    if (!project) return { text: "", error: `No project named ${slug} has been seen on this machine.` };
    const seats = new Map<string, SeatView>();
    if (this.api) {
      const { entries } = await this.api.agents.list({ filter: { includeArchived: false } });
      for (const entry of entries) {
        const seat = entry.agent as unknown as SeatView;
        if (!seat.archivedAt) seats.set(seat.id, seat);
      }
    }
    return { text: statusText(project, loadLedger(project.state), loadConfig(project.state), seats, Date.now()) };
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
    const role = seatOf(this.kit, agent.provider)?.role;
    if (!role?.team) return;
    const project = projectOf(agent.cwd);
    this.rememberProject(project);
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
    if (!headlessRole(this.kit) || !item.text.trim()) return;
    this.watchQueue.push({ ...item, text: clip(item.text.slice(-1500), 1500) });
    this.saveWatchQueue();
    this.scheduleWatch();
  }

  private scheduleWatch(): void {
    if (this.watchTimer || this.watching || this.watchQueue.length === 0) return;
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      this.runWatch().catch((error) => console.error("seatworks-v2: watcher failed:", error));
    }, this.teamFor().attention.watcherDebounceSeconds * 1000);
  }

  private async runWatch(): Promise<void> {
    const paseo = this.api;
    const watcher = headlessRole(this.kit);
    const team = this.teamFor();
    const seat = watcher ? team.roles[watcher.role] : undefined;
    const batch = this.watchQueue.splice(0, 10);
    this.saveWatchQueue();
    if (!paseo || !watcher || !seat || batch.length === 0) return;
    this.watching = true;
    try {
      const command = seat.harness.headless;
      if (!command) return;
      this.ensureSeat(watcher.role, seat.harness);
      const instructions = readFileSync(join(this.kit.dir, "content", watcher.prompt), "utf-8");
      const endings = batch.map((item, index) => ({ n: index + 1, agent: item.agent, role: item.role, title: item.where, text: item.text }));
      const env = { [seat.harness.configDirEnv]: seatDir(this.kit, watcher, seat.harness, home()) };
      const run = await runWatcher(command, watcherPrompt(instructions, endings), seat.model?.id ?? "", team.attention.watcherTimeoutSeconds * 1000, env);
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
      if (seatOf(this.kit, seat.provider)?.role.team) this.rememberProject(projectOf(seat.cwd));
    }
    const { leadIdleMinutes, askRemindMinutes, maxReminders } = this.teamFor().attention;
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
          (seat) => seatOf(this.kit, seat.provider)?.role.team === "supervisor" && projectOf(seat.cwd).slug === project.slug && (seat.pendingPermissions?.length ?? 0) > 0,
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
