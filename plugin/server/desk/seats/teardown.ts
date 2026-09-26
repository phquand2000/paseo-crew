import { dropMerged } from "../../core/git.ts";
import type { DeskBase } from "../base.ts";
import { loadLedger } from "../store/ledger.ts";
import type { OwnCopy } from "../copies/own-copy.ts";
import type { Project } from "../project.ts";
import type { Slots } from "../copies/slots.ts";
import { recordEvent } from "../store/event-log.ts";

/** What putting a lane's copy away means: the copy itself if it had one, the project's branch if not. */
type Teardown = {
  project: Project;
  slot?: string;
  dropBranch?: string;
  into?: string;
  restore?: string;
  lane?: string;
  branch?: string;
};

/** Puts copies away once nobody writes in them; a teardown a turn holds up stays on record until the turn ends. */
export class Teardowns {
  private readonly desk: Pick<DeskBase, "ledgers" | "projects">;
  private readonly slots: Pick<Slots, "release">;
  private readonly ownCopy: Pick<OwnCopy, "restore">;

  constructor(
    desk: Pick<DeskBase, "ledgers" | "projects">,
    slots: Pick<Slots, "release">,
    ownCopy: Pick<OwnCopy, "restore">,
  ) {
    this.desk = desk;
    this.slots = slots;
    this.ownCopy = ownCopy;
  }

  /** Puts a lane's copy away, or waits for the seats still writing in it: removing or switching it under them loses their work. */
  async putAway(teardown: Teardown, writers: string[] = []): Promise<string | undefined> {
    const waiting = [...new Set(writers)];
    if (waiting.length === 0 || (!teardown.slot && !teardown.restore)) return this.run(teardown);
    if (teardown.slot) {
      this.desk.ledgers.transact(teardown.project, (ledger) => {
        const slot = ledger.slots[teardown.slot!];
        if (slot) slot.releasing = { writers: waiting, dropBranch: teardown.dropBranch, into: teardown.into };
      });
    } else if (teardown.lane) {
      this.desk.ledgers.transact(teardown.project, (ledger) => {
        const lane = ledger.lanes[teardown.lane!];
        if (lane)
          lane.restoring = {
            writers: waiting,
            base: teardown.restore!,
            branch: teardown.branch ?? lane.branch,
            ...(teardown.into ? { into: teardown.into } : {}),
          };
      });
    }
    recordEvent(teardown.project, { kind: "slot.heldOpen", slot: teardown.slot ?? "in place", writers: waiting });
    return undefined;
  }

  /** Finishes what the seats' own turns were holding up, once nothing else is writing in that copy. */
  async stopped(ended: (agentId: string) => boolean): Promise<void> {
    for (const project of this.desk.projects.values()) await this.finish(project, ended);
  }

  /** A writer that is no longer a seat has stopped for good: after an archive, crash or restart its turn-end never comes. */
  reap(project: Project, live: Set<string>): Promise<void> {
    return this.finish(project, (id) => !live.has(id));
  }

  private async finish(project: Project, stopped: (agentId: string) => boolean): Promise<void> {
    const ledger = loadLedger(project.state);
    // A record with nobody left to wait for is a restore that did not happen, retried each time.
    const due = (writers: string[]) => writers.length === 0 || writers.some(stopped);
    for (const lane of Object.values(ledger.lanes).filter((entry) => entry.restoring && due(entry.restoring.writers))) {
      const restoring = this.desk.ledgers.transact(project, (current) => {
        const entry = current.lanes[lane.id]?.restoring;
        return entry && this.leftToWait(entry, stopped);
      });
      // The record goes only once the copy is really back: it is the only token a later round can retry from.
      if (!restoring || !(await this.ownCopy.restore(project, restoring.base, restoring.branch, lane.onBranch)))
        continue;
      if (restoring.into) await dropMerged(project.root, restoring.branch, restoring.into);
      this.desk.ledgers.transact(project, (current) => {
        const entry = current.lanes[lane.id];
        if (entry) delete entry.restoring;
      });
    }
    for (const slot of Object.values(ledger.slots).filter(
      (entry) => entry.releasing && entry.releasing.writers.some(stopped),
    )) {
      const releasing = this.desk.ledgers.transact(project, (current) => {
        const entry = current.slots[slot.id]?.releasing;
        return entry && entry.writers.length > 0 ? this.leftToWait(entry, stopped) : undefined;
      });
      if (releasing) await this.slots.release(project, slot.id, releasing.dropBranch, releasing.into);
    }
  }

  /** Drops the writers that have stopped from a wait as it stands in the ledger; the wait comes back once nobody is left in it. */
  private leftToWait<T extends { writers: string[] }>(wait: T, stopped: (agentId: string) => boolean): T | undefined {
    const left = wait.writers.filter((id) => !stopped(id));
    wait.writers = left;
    return left.length === 0 ? { ...wait } : undefined;
  }

  private run(teardown: Teardown): Promise<string | undefined> {
    if (teardown.slot) return this.slots.release(teardown.project, teardown.slot, teardown.dropBranch, teardown.into);
    if (teardown.restore) {
      const carry = teardown.lane ? loadLedger(teardown.project.state).lanes[teardown.lane]?.onBranch : undefined;
      // Recorded as a wait for nobody when it fails, so the round retries it and Detach sees it.
      return this.ownCopy.restore(teardown.project, teardown.restore, teardown.branch, carry).then(async (back) => {
        if (back && teardown.dropBranch && teardown.into)
          await dropMerged(teardown.project.root, teardown.dropBranch, teardown.into);
        if (back || !teardown.lane) return undefined;
        this.desk.ledgers.transact(teardown.project, (ledger) => {
          const lane = ledger.lanes[teardown.lane!];
          if (lane)
            lane.restoring = {
              writers: [],
              base: teardown.restore!,
              branch: teardown.branch ?? lane.branch,
              ...(teardown.into ? { into: teardown.into } : {}),
            };
        });
        return undefined;
      });
    }
    return Promise.resolve(undefined);
  }
}
