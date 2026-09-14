import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { type PaseoApi, on } from "./hooks.ts";
import { type Kit, entrySeat, home, projectRoot, roleOf } from "./kit.ts";
import { type Log, writeLog } from "./log.ts";
import { PROJECT_FILE, type Project, projectAt } from "./project.ts";

export type Feature = { register(server: PluginServerContext, runtime: Runtime): void };

export type Letter = {
  id: string;
  root: string;
  role: string;
  agentId?: string;
  text: string;
  fields: string;
  urgent?: boolean;
  at: number;
};

export type Posted = "sent" | "held" | "logged";

type Placed = { id: string; provider: string; cwd: string };
type Handle = ReturnType<PaseoApi["agents"]["ref"]>;

const TURN_GRACE_MS = 10 * 60_000;
const KEEP_MS = 7 * 24 * 3_600_000;

export function busy(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

export type RuntimeOptions = { kit: () => Kit | undefined; log?: Log; outbox?: string };

export class Runtime {
  readonly kit: () => Kit | undefined;
  private readonly writeLine: Log;
  private readonly outbox: string;
  private readonly awaiting = new Map<string, number>();
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly reported = new Set<string>();
  private counter = 0;

  constructor(options: RuntimeOptions) {
    this.kit = options.kit;
    this.writeLine = options.log ?? writeLog;
    this.outbox = options.outbox ?? join(home, ".paseo", "seatworks", "outbox.json");
  }

  register(server: PluginServerContext): void {
    on(server, "delivery", "agent.turn_ended", async ({ agent }, { paseo }) => {
      this.awaiting.delete(agent.id);
      await this.pump(paseo, agent);
    });
    on(server, "delivery", "agent.archived", ({ agent }) => {
      this.awaiting.delete(agent.id);
      this.drop((letter) => letter.agentId === agent.id);
    });
  }

  log(root: string, line: string): void {
    if (root) this.writeLine(root, line);
  }

  project(root: string): Project {
    const project = projectAt(root, this.kit());
    for (const problem of project.problems) {
      const key = `${root}\n${problem}`;
      if (this.reported.has(key)) continue;
      this.reported.add(key);
      console.error(`seatworks ${join(root, PROJECT_FILE)} ${problem}`);
      this.log(root, `${PROJECT_FILE}  ${problem}`);
    }
    return project;
  }

  letters(): Letter[] {
    try {
      const stored = JSON.parse(readFileSync(this.outbox, "utf-8")) as Letter[];
      return Array.isArray(stored) ? stored.filter((letter) => Date.now() - letter.at < KEEP_MS) : [];
    } catch {
      return [];
    }
  }

  private save(letters: Letter[]): void {
    mkdirSync(dirname(this.outbox), { recursive: true });
    const staging = `${this.outbox}.${process.pid}.tmp`;
    writeFileSync(staging, `${JSON.stringify(letters, null, 2)}\n`);
    renameSync(staging, this.outbox);
  }

  private drop(test: (letter: Letter) => boolean): Letter[] {
    const all = this.letters();
    const gone = all.filter(test);
    if (gone.length > 0) this.save(all.filter((letter) => !test(letter)));
    return gone;
  }

  private lane<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (this.lanes.get(key) ?? Promise.resolve()).then(run, run);
    this.lanes.set(key, next.catch(() => undefined));
    return next;
  }

  private occupied(agentId: string, handle: Handle): { byPermission: boolean; byTurn: boolean } {
    const since = this.awaiting.get(agentId);
    return {
      byPermission: (handle.pendingPermissions?.length ?? 0) > 0,
      byTurn: busy(handle.status) || (since !== undefined && Date.now() - since < TURN_GRACE_MS),
    };
  }

  async findSeat(paseo: PaseoApi, root: string, role: string) {
    const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
    return entries
      .map((entry) => entry.agent)
      .filter((agent) => !agent.archivedAt && roleOf(agent.provider) === role && projectRoot(agent.cwd) === root)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  }

  private async target(paseo: PaseoApi, letter: Pick<Letter, "root" | "role" | "agentId">): Promise<Placed | undefined> {
    if (!letter.agentId) return this.findSeat(paseo, letter.root, letter.role);
    const handle = paseo.agents.ref(letter.agentId);
    await handle.refresh();
    const snapshot = handle.current();
    return snapshot && !snapshot.archivedAt ? snapshot : undefined;
  }

  async post(paseo: PaseoApi, letter: Omit<Letter, "id" | "at">): Promise<Posted> {
    const target = await this.target(paseo, letter);
    if (!target) {
      this.log(letter.root, `${letter.fields}  -> logged`);
      return "logged";
    }
    const stored: Letter = { ...letter, id: `${Date.now()}-${process.pid}-${++this.counter}`, at: Date.now() };
    this.save([...this.letters(), stored]);
    const sent = await this.pump(paseo, target);
    if (sent.has(stored.id) || !this.letters().some((entry) => entry.id === stored.id)) return "sent";
    this.log(letter.root, `${letter.fields}  -> held`);
    return "held";
  }

  pump(paseo: PaseoApi, target: Placed): Promise<Set<string>> {
    return this.lane(target.id, async () => {
      const root = projectRoot(target.cwd) ?? "";
      const role = roleOf(target.provider);
      const mine = this.letters().filter(
        (letter) => letter.agentId === target.id || (!letter.agentId && letter.role === role && letter.root === root),
      );
      if (mine.length === 0) return new Set<string>();
      const handle = paseo.agents.ref(target.id);
      await handle.refresh();
      if (handle.archivedAt) return new Set<string>();
      const { byPermission, byTurn } = this.occupied(target.id, handle);
      if (byPermission) return new Set<string>();
      const ready: Letter[] = [];
      for (const letter of mine) {
        if (byTurn && !letter.urgent) continue;
        ready.push(letter);
      }
      if (ready.length === 0) return new Set<string>();
      await handle.send(ready.map((letter) => letter.text).join("\n\n"));
      this.awaiting.set(target.id, Date.now());
      const ids = new Set(ready.map((letter) => letter.id));
      this.drop((letter) => ids.has(letter.id));
      for (const letter of ready) this.log(letter.root, `${letter.fields}  -> sent`);
      return ids;
    });
  }

  sendNow(paseo: PaseoApi, agentId: string, text: string): Promise<boolean> {
    return this.lane(agentId, async () => {
      const handle = paseo.agents.ref(agentId);
      await handle.refresh();
      const { byPermission, byTurn } = this.occupied(agentId, handle);
      if (handle.archivedAt || byPermission || byTurn) return false;
      await handle.send(text);
      this.awaiting.set(agentId, Date.now());
      return true;
    });
  }

  async raise(paseo: PaseoApi, root: string, text: string, fields: string, urgent = false): Promise<Posted> {
    const kit = this.kit();
    const entry = kit ? entrySeat(kit) : undefined;
    if (!entry) {
      this.log(root, `${fields}  -> logged`);
      return "logged";
    }
    return this.post(paseo, { root, role: entry.role, text, fields, urgent });
  }

  later(key: string, ms: number, run: () => Promise<void>): void {
    if (this.timers.has(key)) return;
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        run().catch((error) => console.error(`seatworks ${key} failed:`, error));
      }, ms),
    );
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
