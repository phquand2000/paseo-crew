import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../../core/json.ts";
import { daemonLog } from "../../core/logger.ts";
import { stateRoot } from "../../core/paths.ts";
import { keptFault, readKept, writeJson } from "../../core/store.ts";

type Bound = Record<string, string>;

const isBound = (value: unknown): value is Bound =>
  isRecord(value) && Object.values(value).every((key) => typeof key === "string");

/**
 * Which agent each seat's key belongs to, bound when Paseo names the agent and kept until it deletes it, since a resumed seat's
 * team server starts again with its key. A file that cannot be read is never written over: binding refuses, look-ups find none.
 */
export class SeatKeys {
  private readonly file: string;
  private told?: string;

  constructor() {
    this.file = join(stateRoot(), "keys.json");
  }

  issue(): string {
    return randomBytes(24).toString("hex");
  }

  bind(agent: string, key: string): void {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("fault" in read) throw keptFault(read.fault);
    writeJson(this.file, { ...read.value, [agent]: key });
  }

  keyOf(agent: string): string | undefined {
    return this.all()[agent];
  }

  agentOf(key: string): string | undefined {
    return key ? Object.entries(this.all()).find(([, held]) => held === key)?.[0] : undefined;
  }

  agents(): string[] {
    return Object.keys(this.all());
  }

  forget(agent: string): void {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("fault" in read || !(agent in read.value)) return;
    const { [agent]: _gone, ...rest } = read.value;
    writeJson(this.file, rest);
  }

  /** A file that stays unreadable is reported once, not at every look-up. */
  private all(): Bound {
    const read = readKept<Bound>(this.file, {}, isBound);
    if ("value" in read) {
      this.told = undefined;
      return read.value;
    }
    if (this.told !== read.fault) daemonLog.error(keptFault(read.fault).message);
    this.told = read.fault;
    return {};
  }
}
