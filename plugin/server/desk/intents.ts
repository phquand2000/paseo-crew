import { readJson, writeJson } from "../core/store.ts";

/** A call a seat was told to stop waiting for: its answer was to come as mail. */
type Promised = { agent: string; tool: string; started: number };

type Kept = { archive: string[]; promised: Promised[] };

const same = (a: Promised, b: Promised) => a.agent === b.agent && a.tool === b.tool && a.started === b.started;

/** What the desk said it would do once a turn ends or a slow call finishes, on disk: a stop in between would forget it. */
export class Intents {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  private read(): Kept {
    return readJson<Kept>(this.file, { archive: [], promised: [] });
  }

  private save(kept: Kept): void {
    writeJson(this.file, kept);
  }

  toArchive(): string[] {
    return this.read().archive;
  }

  archiveLater(agentId: string): void {
    const kept = this.read();
    if (!kept.archive.includes(agentId)) this.save({ ...kept, archive: [...kept.archive, agentId] });
  }

  archived(agentId: string): void {
    const kept = this.read();
    if (kept.archive.includes(agentId)) this.save({ ...kept, archive: kept.archive.filter((id) => id !== agentId) });
  }

  promised(): Promised[] {
    return this.read().promised;
  }

  promise(promised: Promised): void {
    const kept = this.read();
    if (!kept.promised.some((entry) => same(entry, promised)))
      this.save({ ...kept, promised: [...kept.promised, promised] });
  }

  kept(promised: Promised): void {
    const kept = this.read();
    if (kept.promised.some((entry) => same(entry, promised)))
      this.save({ ...kept, promised: kept.promised.filter((entry) => !same(entry, promised)) });
  }
}
