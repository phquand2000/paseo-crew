import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { stateRoot } from "../core/paths.ts";
import { readJson, writeJson } from "../core/store.ts";

/**
 * Which agent each seat's key belongs to. A key is made as the seat is created, before Paseo names the agent, and bound
 * when it does; kept on disk, since a resumed seat's team server starts again with the key it was created with.
 */
export class SeatKeys {
  private readonly file: string;

  constructor(root = stateRoot()) {
    this.file = join(root, "keys.json");
  }

  issue(): string {
    return randomBytes(24).toString("hex");
  }

  bind(agent: string, key: string): void {
    this.save({ ...this.all(), [agent]: key });
  }

  keyOf(agent: string): string | undefined {
    return this.all()[agent];
  }

  agentOf(key: string): string | undefined {
    return key ? Object.entries(this.all()).find(([, held]) => held === key)?.[0] : undefined;
  }

  forget(agent: string): void {
    const all = this.all();
    if (!(agent in all)) return;
    delete all[agent];
    this.save(all);
  }

  private all(): Record<string, string> {
    return readJson<Record<string, string>>(this.file, {});
  }

  private save(all: Record<string, string>): void {
    writeJson(this.file, all);
  }
}
