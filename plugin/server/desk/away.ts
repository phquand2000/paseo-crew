import { DAY_MS, minutesSince } from "../core/time.ts";
import type { Question } from "../domain/question.ts";
import type { ReportItem, ReportView } from "../../shared/views.ts";
import { askedSince } from "./human/questions.ts";
import { loadIncidents } from "./incidents.ts";
import { loadLedger } from "./ledger.ts";
import type { Project } from "./project.ts";



/** A question stops something now when its lane was put on hold for it, or it is irreversible: nothing it decides goes ahead. */
const stops = (question: Question) => question.parked === true || question.class === "irreversible";

/**
 * What happened in a project over the last day, built from its record with no agent's words in it: what needs the Human,
 * what went ahead on a recommendation they have not answered, what landed, what could not be undone, and the counts.
 */
export function reportView(project: Project, questionsPerDay: number, now = Date.now()): ReportView {
  const ledger = loadLedger(project.state);
  const since = now - DAY_MS;
  const questions = Object.values(ledger.questions);
  const open = questions.filter((question) => question.status === "open");
  const lanes = Object.values(ledger.lanes);
  const waiting = lanes.filter((lane) => lane.status === "open" && lane.landApproval && !lane.landApproval.approved);
  const landed = lanes.filter((lane) => lane.landed && (lane.closedAt ?? 0) >= since);
  const incidents = Object.values(loadIncidents(project.state).items).filter((incident) => incident.opened >= since);
  const asked = (question: Question): ReportItem => ({ title: `${question.id} · ${question.question}`, detail: `${question.class}${question.lane ? ` · ${question.lane}` : ""}`, minutes: minutesSince(now, question.openedAt) });
  return {
    needs: [
      ...open.filter(stops).map(asked),
      ...waiting.map((lane) => ({ title: `${lane.id} ${lane.title} waits for you to land it`, detail: lane.landApproval!.signals.join(" "), minutes: minutesSince(now, lane.landApproval!.since) })),
    ],
    ahead: open.filter((question) => !stops(question)).map((question) => ({ ...asked(question), detail: `${question.class} · went ahead on ${question.recommend}` })),
    landed: landed.map((lane) => ({ title: `${lane.id} ${lane.title}`, detail: `on ${lane.base}`, minutes: minutesSince(now, lane.closedAt!) })),
    beyond: incidents
      .filter((incident) => incident.level === "page")
      .map((incident) => ({ title: `${incident.id} · ${incident.quote}`, detail: [incident.where, incident.label ? `marked ${incident.label}` : "not marked"].join(" · "), minutes: minutesSince(now, incident.opened) })),
    numbers: [
      { title: "Questions today", value: `${askedSince(project.state, since).length} of ${questionsPerDay}`, detail: "across every project" },
      { title: "Landings", value: `${landed.length} landed`, detail: waiting.length > 0 ? `${waiting.length} waiting for you` : "none waiting for you" },
      {
        title: "Incidents",
        value: `${incidents.length}`,
        detail: ["useful", "noise", "unknown"].map((label) => `${incidents.filter((incident) => incident.label === label).length} ${label}`).concat(`${incidents.filter((incident) => !incident.label).length} not marked`).join(" · "),
      },
    ],
  };
}
