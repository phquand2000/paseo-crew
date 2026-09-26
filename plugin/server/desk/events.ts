import type { Finding, Held, Level } from "../domain/incident.ts";
import type { LaneStatus } from "../domain/lane.ts";
import type { TaskStatus } from "../domain/task.ts";
import type { Incident } from "./incidents.ts";
import type { Task } from "./ledger.ts";

/**
 * One line of a project's `events.log`, written with the time it happened: the provenance record a retrospective reads.
 * A new kind or field only adds; a field that changes meaning takes a new kind, since the log is never rewritten.
 */
export type DeskEvent =
  | { kind: "tool"; agent: string; role: string; tool: string; ok: boolean; reply: string }
  | { kind: "call.malformed"; agent: string; role: string; tool: string; error: string }
  | { kind: "lane.waiting"; lane: string; after: string[] }
  | { kind: "lane.held"; lane: string; reason: string }
  | { kind: "lane.opened"; lane: string; lead: string; branch: string; base: string; slot: string }
  | { kind: "lane.halfOpen"; lane: string; status: LaneStatus; lead: string | null }
  | { kind: "lane.amended"; lane: string; fields: string[]; by: string }
  | { kind: "lane.report"; lane: string; ready: boolean; gate: boolean | undefined; to: string | null; text: string | undefined }
  | { kind: "lane.closed"; lane: string; land: boolean; landing: string; reason: string; writers: string[] }
  | { kind: "lane.inPlace"; branch: string; base: string }
  | { kind: "link.skipped"; slot: string; path: string; why: string }
  | { kind: "lane.onBranch"; branch: string; from?: string }
  | { kind: "lane.unstarted"; branch: string; from: string }
  | { kind: "lane.gaveBack"; branch: string; base: string }
  | { kind: "lead.replaced"; lane: string; was: string | null; lead: string; adopted: boolean }
  | { kind: "land.held"; lane: string; signals: number }
  | { kind: "land.approved" | "land.sentBack"; lane: string }
  | { kind: "gate.passed" | "gate.failed"; lane: string; seconds: number; command: string }
  | { kind: "gate.overridden"; lane: string; by: string }
  | { kind: "restore.held"; base: string; branch: string | null; why: string }
  | { kind: "tasks.added"; lane: string; tasks: string[] }
  | { kind: "lane.onHold"; lane: string; by: string; reason: string; stopped: string[] }
  | { kind: "lane.resumed"; lane: string; by: string }
  | { kind: "question.asked"; question: string; lane: string | null; class: string }
  | { kind: "question.answered"; question: string; status: string; by: "panel" | "chat" }
  | { kind: "note.written"; file: string; by: string; replaced: boolean }
  | { kind: "task.waiting"; task: string; after: string[] }
  | { kind: "task.held"; task: string; reason: string }
  | { kind: "task.started"; task: string; peer: string; mode: Task["mode"]; slot: string }
  | { kind: "task.handed"; task: string; peer: string; from: string }
  | { kind: "seat.released"; seat: string; of: string }
  | { kind: "task.halfStarted"; task: string; now: TaskStatus }
  | { kind: "task.amended"; task: string; fields: string[]; by: string }
  | { kind: "task.done" | "review.done"; task: string; outcome: string; commit: string | undefined }
  | { kind: "task.accepted"; task: string; mode: "lane" }
  | { kind: "task.cut"; task: string; reason: string; kept: string | undefined }
  | { kind: "task.silent"; task: string; denied: string | null; refused: boolean }
  | { kind: "turn.silent"; task: string; denied: string | null; refused: boolean; lastCall: string }
  | { kind: `merge.${TaskStatus}`; task: string }
  | { kind: "review.started"; task: string; of: string | null; reviewer: string }
  | { kind: "ask.opened"; ask: string; from: string; to: string }
  | { kind: "ask.answered"; ask: string; by: string; told: string | null }
  | { kind: "slot.taken"; slot: string; branch: string; lane?: string; task?: string }
  | { kind: "slot.heldOpen"; slot: string; writers: string[] }
  | { kind: "slot.released"; slot: string; removed: boolean; kept: string | undefined }
  | { kind: "workspace.swept"; workspace: string; name: string }
  | { kind: "worktree.swept"; path: string }
  | { kind: "index.opened"; server: string; slot: string; reused: boolean; ok: boolean; detail: string }
  | { kind: "index.closed"; server: string; slot: string; ok: boolean; detail: string }
  | { kind: "watch.fact"; agent: string; fact: string; level: Level; quote: string }
  | { kind: "watch.finding"; agent: string; finding: string; level: Finding["level"]; quote: string; facts: string[] }
  | { kind: "watch.unbriefed"; agent: string; error: string }
  | { kind: "watch.unasked"; subject: string; by: string; error: string }
  | { kind: "watcher.seated"; agent: string; parent: string }
  | { kind: "watch.offline"; error: string }
  | { kind: "incident.open"; id: string; agent: string; finding: string; level: Finding["level"]; held: Held | null }
  | { kind: "page.sent"; agent: string }
  | { kind: "page.failed"; error: string }
  | { kind: "incident.held"; id: string; held: Held }
  | { kind: "incident.told"; ids: string[]; to: string }
  | { kind: "incident.read"; agent: string; waiting: number }
  | { kind: "incident.ack"; id: string; agent: string; verdict: NonNullable<Incident["label"]>; note: string | null; seat: string; finding: string; opened: number; last: number }
  | { kind: "incident.lookup-failed"; error: string }
  | { kind: "incident.post-failed"; id: string; error: string }
  | { kind: "ledger.archived"; lanes: string[]; agents: number; asks: number; records: number }
  | { kind: "records.tidied"; files: number };
