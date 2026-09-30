import type { Kit, SensorSpec } from "../catalog/kit/kit.ts";
import type { Team } from "../catalog/team/team.ts";
import type { KeyedQueue } from "../core/keyed-queue.ts";
import type { Doing } from "../core/paseo.ts";
import type { Judge } from "../core/ports.ts";
import type { Claims } from "./claims.ts";
import type { CodeIndex, Posted } from "./context.ts";
import type { Letter } from "./letters/envelope.ts";
import type { Project } from "./project/project.ts";
import type { IncidentStore } from "./store/incident-store.ts";
import type { LedgerStore } from "./store/ledger-store.ts";

/** How the desk mails a seat, "nobody" when there is nobody to read it; `waiting`, whether mail it must heed is held, and `heededSince`, posted since. */
type Mail = {
  post(to: string | undefined, letter: Letter, into?: "interrupt"): Promise<Posted | "nobody">;
  waiting(to: string): Promise<boolean>;
  heededSince(to: string, at: number): boolean;
};

/** What every part of the desk is built from: the kit, the stores, the mail, what the host provides and the work in hand. */
export type DeskBase = {
  kit: Kit;
  projects: Map<string, Project>;
  ledgers: LedgerStore;
  incidents: IncidentStore;
  mail: Mail;
  log: (project: Project, line: string) => void;
  teamFor: (project?: Project) => Team;
  indexesFor: (project: Project) => CodeIndex[];
  sensorFor: (spec: SensorSpec, key: string) => Judge | undefined;
  doing: (seat: string) => Doing | undefined;
  seating: Claims;
  closing: Claims;
  landings: KeyedQueue;
  stopping: AbortSignal;
};
