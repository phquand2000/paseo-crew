import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Kit, headlessRole } from "../catalog/kit.ts";
import { seatDir } from "../catalog/seats.ts";
import { home, stateRoot } from "../core/paths.ts";
import type { PaseoApi } from "../core/paseo.ts";
import { readJson, writeJson } from "../core/store.ts";
import { hash } from "../desk/context.ts";
import type { Desk } from "../desk/desk.ts";
import { loadLedger } from "../desk/ledger.ts";
import { clip, letters } from "../desk/letters.ts";
import type { Project } from "../desk/project.ts";
import type { Seating } from "./seating.ts";
import type { TeamSource } from "./team-source.ts";
import { URGENT, type Verdict, parseVerdicts, runWatcher, watcherPrompt } from "./watcher.ts";

export type Watch = { project: Project; lane: string; agent: string; role: string; where: string; text: string };

export type WatchDeps = {
  kit: Kit;
  source: TeamSource;
  seating: Seating;
  desk: Desk;
  log: (project: Project, line: string) => void;
  api: () => PaseoApi | undefined;
};

const queueFile = () => join(stateRoot(), "watch-queue.json");

export class WatchQueue {
  private readonly deps: WatchDeps;
  private readonly items: Watch[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private failures = 0;

  constructor(deps: WatchDeps) {
    this.deps = deps;
    const saved = readJson<Watch[]>(queueFile(), []);
    if (Array.isArray(saved)) this.items.push(...saved);
  }

  add(item: Watch): void {
    if (!headlessRole(this.deps.kit) || !item.text.trim()) return;
    this.items.push({ ...item, text: clip(item.text.slice(-1500), 1500) });
    this.save();
    this.schedule();
  }

  schedule(): void {
    if (this.timer || this.running || this.items.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.run().catch((error) => console.error("seatworks-v2: watcher failed:", error));
    }, this.deps.source.teamFor().attention.watcherDebounceSeconds * 1000);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private save(): void {
    try {
      writeJson(queueFile(), this.items);
    } catch (error) {
      console.error("seatworks-v2: watch queue write failed:", error);
    }
  }

  private async run(): Promise<void> {
    const { kit, source, seating } = this.deps;
    const paseo = this.deps.api();
    const watcher = headlessRole(kit);
    const team = source.teamFor();
    const seat = watcher ? team.roles[watcher.role] : undefined;
    const batch = this.items.splice(0, 10);
    this.save();
    if (!paseo || !watcher || !seat?.harness.headless || batch.length === 0) return;
    this.running = true;
    try {
      seating.ensure(watcher.role, seat.harness);
      const instructions = readFileSync(join(kit.dir, "content", watcher.prompt), "utf-8");
      const endings = batch.map((item, index) => ({ n: index + 1, agent: item.agent, role: item.role, title: item.where, text: item.text }));
      const env = { [seat.harness.configDirEnv]: seatDir(kit, watcher, seat.harness, home()) };
      const run = await runWatcher(seat.harness.headless, watcherPrompt(instructions, endings), seat.model?.id ?? "", team.attention.watcherTimeoutSeconds * 1000, env);
      const verdicts = run.ok ? parseVerdicts(run.output, endings.length) : [];
      if (verdicts.length === 0) await this.noVerdicts(paseo, batch, run.output);
      else await this.raise(paseo, batch, verdicts);
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  private async noVerdicts(paseo: PaseoApi, batch: Watch[], output: string): Promise<void> {
    const { desk, log } = this.deps;
    this.failures += 1;
    for (const item of batch) log(item.project, `watcher gave no verdicts (${this.failures} in a row): ${clip(output.trim(), 300)}`);
    if (this.failures !== 3) return;
    const first = batch[0]!;
    const lane = loadLedger(first.project.state).lanes[first.lane];
    const to = await desk.supervisorFor(paseo, first.project, lane?.opener);
    await desk.post(paseo, to, `watcher-down:${Date.now()}`, letters.attention("watcher unavailable", "the team", clip(output.trim(), 400)));
  }

  private async raise(paseo: PaseoApi, batch: Watch[], verdicts: Verdict[]): Promise<void> {
    const { desk } = this.deps;
    this.failures = 0;
    for (const verdict of verdicts) {
      const item = batch[verdict.n - 1];
      if (!item) continue;
      desk.event(item.project, { kind: "watch", agent: item.agent, label: verdict.label, quote: verdict.quote });
      const urgent = URGENT.includes(verdict.label) && (item.role === "lead" || verdict.label !== "unheard-wait");
      if (!urgent) continue;
      const lane = loadLedger(item.project.state).lanes[item.lane];
      if (!lane || lane.status !== "open") continue;
      const handle = paseo.agents.ref(item.agent);
      await handle.refresh();
      if (handle.archivedAt) continue;
      const to = await desk.supervisorFor(paseo, item.project, lane.opener);
      await desk.post(paseo, to, `attention:${item.agent}:${hash(verdict.label, verdict.quote)}`, letters.attention(verdict.label, item.where, verdict.quote || clip(item.text.trim(), 200)));
    }
  }
}
