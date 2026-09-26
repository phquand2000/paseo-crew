import type { DeskEvent } from "./events.ts";
import type { Project } from "../project/project.ts";
import { appendRecord } from "./records.ts";

/** Writes one line of the project's provenance record, stamped with when it happened. */
export function recordEvent(project: Project, event: DeskEvent): void {
  appendRecord(project.state, "events", `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}
