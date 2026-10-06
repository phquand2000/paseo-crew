import type { ToolDef } from "../services.ts";
import { accept } from "./accept.ts";
import { markIncident } from "./mark-incident.ts";
import { addTasks } from "./add-tasks.ts";
import { amendLane } from "./amend-lane.ts";
import { amendTask } from "./amend-task.ts";
import { answer } from "./answer.ts";
import { askHuman } from "./ask-human.ts";
import { askLead, askLeadReviewing, askOwner } from "./ask.ts";
import { dropLane } from "./drop-lane.ts";
import { cut } from "./cut.ts";
import { done, doneReview } from "./done.ts";
import { incidents } from "./incidents.ts";
import { holdLane } from "./hold-lane.ts";
import { message } from "./message.ts";
import { note } from "./note.ts";
import { landLane } from "./land-lane.ts";
import { lease } from "./lease.ts";
import { openLane } from "./open-lane.ts";
import { outcomes } from "./outcomes.ts";
import { record } from "./record.ts";
import { recordHumanAnswer } from "./record-human-answer.ts";
import { releaseLead, releasePeer } from "./release.ts";
import { replaceLead } from "./replace-lead.ts";
import { resumeLane } from "./resume-lane.ts";
import { report } from "./report.ts";
import { reseat } from "./reseat.ts";
import { rework } from "./rework.ts";
import { setProject } from "./set-project.ts";
import { startReview } from "./start-review.ts";
import { status } from "./status.ts";
import { takePaths } from "./take-paths.ts";

export const TOOLS: ToolDef[] = [
  openLane,
  landLane,
  dropLane,
  amendLane,
  holdLane,
  resumeLane,
  askHuman,
  recordHumanAnswer,
  replaceLead,
  releaseLead,
  setProject,
  addTasks,
  startReview,
  accept,
  rework,
  reseat,
  amendTask,
  takePaths,
  cut,
  releasePeer,
  report,
  askOwner,
  askLead,
  askLeadReviewing,
  done,
  doneReview,
  message,
  answer,
  status,
  incidents,
  markIncident,
  record,
  outcomes,
  note,
  lease,
];
