import { keptFault } from "../../core/store.ts";
import { type Incidents, loadIncidents, readIncidentsFile, saveIncidents } from "./incidents.ts";
import type { Project } from "../project/project.ts";
import type { Sync } from "./ledger-store.ts";

/** Every project's book of incidents, changed as the ledger is: read, decided and saved with nothing awaited between. */
export class IncidentStore {
  private readonly touched: (project: Project) => void;

  constructor(touched: (project: Project) => void) {
    this.touched = touched;
  }

  /** The book for a view: one that cannot be read shows as empty. */
  view(project: Project): Incidents {
    return loadIncidents(project.state);
  }

  transact<T>(project: Project, change: (book: Incidents) => Sync<T>): T {
    this.touched(project);
    const read = readIncidentsFile(project.state);
    if ("fault" in read) throw keptFault(read.fault);
    const result = change(read.incidents);
    saveIncidents(project.state, read.incidents);
    return result;
  }
}
