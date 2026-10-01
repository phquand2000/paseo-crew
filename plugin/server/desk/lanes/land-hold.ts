import { headSha } from "../../core/git.ts";
import { minutesSince } from "../../core/time.ts";
import { type ToolReply, ok } from "../context.ts";
import { type AskHit, askFirstHits, changeOf, landFacts } from "./land-facts.ts";
import type { Lane } from "../../domain/lane.ts";
import { loadLedger } from "../store/ledger.ts";
import { landLetters } from "../letters/land-letters.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

/** A reply to a close, with what kept a landing from happening when something did. */
export type Closed = ToolReply & { blocked?: string };

/** The Supervisor's word on a red gate: land over it, and why. */
export type OverGate = { overGate: boolean; reason: string };

export type Held = NonNullable<Lane["landApproval"]>;

const texts = (hits: AskHit[]) => hits.map((hit) => hit.text).join(" ");

const heldFor = (hits: AskHit[]) => ({
  signals: hits.map((hit) => hit.text),
  paths: hits.flatMap((hit) => (hit.path ? [hit.path] : [])),
});

const NOT_READY = "Its Lead has not reported it ready as it now stands: never, or the lane was amended since.";

/** What the Human's earlier word still stops: a hold with no commit since, while it still touches what they asked to be asked about. */
export async function waitsForHuman(
  { ledgers }: Pick<DeskServices, "ledgers">,
  project: Project,
  lane: Lane,
  tip: string | undefined,
): Promise<Closed | undefined> {
  const held = lane.landApproval;
  if (!held || held.approved || held.head !== tip) return undefined;
  const hits = askFirstHits(project, await changeOf(project, lane));
  if (hits.length === 0) return undefined;
  ledgers.setLane(project, lane.id, (entry) => {
    if (entry.landApproval && !entry.landApproval.approved) Object.assign(entry.landApproval, heldFor(hits));
  });
  const since = minutesSince(Date.now(), held.since);
  return ok(
    `Lane ${lane.id} still waits for the Human's approval to land, since ${since} min ago. ${texts(hits)} LANDED or SENT BACK comes as mail.`,
  );
}

/**
 * Holds a landing for the Human where they asked to be asked first; all else the desk reads of it goes with it as
 * evidence. An approval stands for what it was given: a path they are newly asked about holds it again.
 */
export async function checkLanding(
  { kit, ledgers, mail }: Pick<DeskServices, "kit" | "ledgers" | "mail">,
  project: Project,
  lane: Lane,
  gate: { ok: boolean; ran: boolean },
  over: OverGate,
  approved?: Held,
): Promise<{ held?: string; note: string }> {
  const change = await changeOf(project, lane);
  const hits = askFirstHits(project, change);
  const facts = await landFacts(kit, project, loadLedger(project.state), lane, change, { set: gate.ran, ok: gate.ok });
  const evidence = [...(lane.ready ? [] : [NOT_READY]), ...facts];
  // Base merged in first can change which files show under a path they approved: no new question for them.
  const fresh = approved ? hits.filter((hit) => !hit.path || !approved.paths.includes(hit.path)) : hits;
  if (fresh.length === 0)
    return { note: `\n\n${approved ? "The Human approved it.\n" : ""}Evidence: ${evidence.join(" ")}` };
  const head = (await headSha(project.root, lane.branch)) ?? "";
  const reason = over.reason ? { reason: over.reason } : {};
  ledgers.setLane(project, lane.id, (entry) => {
    entry.landApproval = { since: Date.now(), head, ...heldFor(hits), evidence, overGate: over.overGate, ...reason };
  });
  recordEvent(project, { kind: "land.held", lane: lane.id, signals: hits.length });
  await mail.post(lane.lead, landLetters.landHeld(lane, texts(hits), head));
  return {
    held: `Lane ${lane.id} was not landed: it waits for the Human's approval, on the Flow tab of the panel or in your chat. ${texts(hits)}\n\nEvidence: ${evidence.join(" ")}\n\nTell them it waits, and why. Once they approve it in your chat, land_lane it again with approval, their words; on the panel, LANDED or SENT BACK comes as mail.`,
    note: "",
  };
}
