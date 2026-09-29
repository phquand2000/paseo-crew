import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { isRecord } from "../../core/json.ts";
import { stateRoot } from "../../core/paths.ts";
import { KeptFile, keptFault } from "../../core/store.ts";

type Bound = Record<string, string>;

const isBound = (value: unknown): value is Bound =>
  isRecord(value) && Object.values(value).every((key) => typeof key === "string");

/**
 * Which agent each seat's key belongs to, bound when Paseo names the agent and kept until it deletes it, since a resumed seat's
 * team server starts again with its key. A file that cannot be read is never written over: binding refuses, look-ups find none.
 */
export class SeatKeys {
  private readonly file = new KeptFile<Bound>(join(stateRoot(), "keys.json"), {}, isBound);

  issue(): string {
    return randomBytes(24).toString("hex");
  }

  bind(agent: string, key: string): void {
    const read = this.file.read();
    if ("fault" in read) throw keptFault(read.fault);
    this.file.change((all) => ({ ...all, [agent]: key }));
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
    this.file.change((all) => {
      if (!(agent in all)) return undefined;
      const { [agent]: _gone, ...rest } = all;
      return rest;
    });
  }

  private all(): Bound {
    return this.file.quiet() ?? {};
  }
}
