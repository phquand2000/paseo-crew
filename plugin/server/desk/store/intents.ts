import { isRecord } from "../../core/json.ts";
import { KeptFile } from "../../core/store.ts";

/** A call a seat was told to stop waiting for: its answer was to come as mail. */
type Promised = { agent: string; tool: string; started: number };

type Kept = { archive: string[]; promised: Promised[] };

const same = (a: Promised, b: Promised) => a.agent === b.agent && a.tool === b.tool && a.started === b.started;

const isKept = (value: unknown): value is Kept =>
  isRecord(value) && Array.isArray(value.archive) && Array.isArray(value.promised);

/** What the desk said it would do once a turn ends or a slow call finishes, on disk: a stop in between would forget it. */
export class Intents {
  private readonly file: KeptFile<Kept>;

  constructor(file: string) {
    this.file = new KeptFile<Kept>(file, { archive: [], promised: [] }, isKept);
  }

  toArchive(): string[] {
    return this.file.quiet()?.archive ?? [];
  }

  archiveLater(agentId: string): void {
    this.file.change((kept) =>
      kept.archive.includes(agentId) ? undefined : { ...kept, archive: [...kept.archive, agentId] },
    );
  }

  archived(agentId: string): void {
    this.file.change((kept) =>
      kept.archive.includes(agentId) ? { ...kept, archive: kept.archive.filter((id) => id !== agentId) } : undefined,
    );
  }

  promised(): Promised[] {
    return this.file.quiet()?.promised ?? [];
  }

  promise(promised: Promised): void {
    this.file.change((kept) =>
      kept.promised.some((entry) => same(entry, promised))
        ? undefined
        : { ...kept, promised: [...kept.promised, promised] },
    );
  }

  kept(promised: Promised): void {
    this.file.change((kept) =>
      kept.promised.some((entry) => same(entry, promised))
        ? { ...kept, promised: kept.promised.filter((entry) => !same(entry, promised)) }
        : undefined,
    );
  }
}
