import { LANE, type LaneMove } from "../../domain/lane.ts";
import { TASK, type TaskMove, type TaskStatus } from "../../domain/task.ts";
import { type Lane, type Ledger, type Task, loadLedger, readLedgerFile, saveLedger } from "./ledger.ts";
import type { Project } from "../project.ts";

/** What a transaction returns: never a promise, since awaiting inside one lets another change in between read and write. */
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;

/** Every project's ledger. A change is read, decided and saved with nothing awaited between, so none lands in the middle. */
export class LedgerStore {
  private readonly touched: (project: Project) => void;

  constructor(touched: (project: Project) => void) {
    this.touched = touched;
  }

  /** The ledger as it stands; one that cannot be read throws rather than reads as empty. */
  read(project: Project): Ledger {
    return loadLedger(project.state);
  }

  transact<T>(project: Project, decide: (ledger: Ledger) => Sync<T>): T {
    this.touched(project);
    const read = readLedgerFile(project.state);
    if ("fault" in read)
      throw new Error(
        `${read.fault}. Nothing was written over it. Only the Human can repair it or move it aside — no seat may write the desk's own files — and what the desk has on record is in that file.`,
      );
    const result = decide(read.ledger);
    saveLedger(project.state, read.ledger);
    return result;
  }

  /** Changes one lane under the lock; undefined when there is no such lane. */
  setLane<T = void>(project: Project, laneId: string, change: (lane: Lane) => Sync<T>): T | undefined {
    return this.transact<T | undefined>(project, (ledger) => {
      const lane = ledger.lanes[laneId];
      return lane ? change(lane) : undefined;
    });
  }

  /** Changes one task under the lock and stamps it; a copy of it as saved, or undefined when there is no such task. */
  setTask(project: Project, taskId: string, change: (task: Task) => void): Task | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      change(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  /** Moves a task by its lifecycle, `change` alongside; a move the table refuses changes nothing and gives the status that stopped it. */
  moveTask(
    project: Project,
    taskId: string,
    move: TaskMove,
    change?: (task: Task) => void,
  ): Task | TaskStatus | undefined {
    return this.transact(project, (ledger) => {
      const task = ledger.tasks[taskId];
      if (!task) return undefined;
      if (!TASK.move(task, move)) return task.status;
      change?.(task);
      task.updatedAt = Date.now();
      return { ...task };
    });
  }

  /** As `moveTask`, for a lane: a move its table refuses leaves it as it was. */
  moveLane(project: Project, laneId: string, move: LaneMove): void {
    this.setLane(project, laneId, (lane) => {
      LANE.move(lane, move);
    });
  }
}
