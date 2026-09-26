import { type RoleSpec, namedOrNot, roleThatCan } from "../../catalog/kit.ts";
import { errorText } from "../../core/errors.ts";
import { headSha } from "../../core/git.ts";
import type { SeatView } from "../../core/paseo.ts";
import { outside } from "../../core/text.ts";
import { workKey } from "../claims.ts";
import { type Elsewhere, directiveFor, elsewhereText } from "../directive.ts";
import type { Issue } from "../issue.ts";
import type { Lane } from "../ledger.ts";
import { seatTitle } from "../names.ts";
import { type Project, loadConfig } from "../project.ts";
import type { DeskServices } from "../services.ts";
import { recordEvent } from "../store/event-log.ts";

type Copy = { id?: string; path: string; workspaceId?: string };
type Seating = { ownCopy: boolean; from?: string; role?: string; parent?: string; issue?: Issue };
type Seated = { slot: Copy; lead: string; elsewhere: Elsewhere[] };

/** A seat Paseo holds as this lane's Lead, by the labels it was started with; a Peer's and a reviewer's also name a task. */
export function leadSeatOf(seats: SeatView[], project: Project, lane: string): SeatView | undefined {
  return seats.find(
    (seat) =>
      seat.labels?.["seatworks.project"] === project.slug &&
      seat.labels["seatworks.lane"] === lane &&
      !seat.labels["seatworks.task"],
  );
}

/** What the Supervisor is told once a lane opens: where it works, its gate, and the issue as its Lead received it. */
export function openedReply(
  project: Project,
  lane: Lane,
  slot: { id?: string },
  lead: string,
  issue: Issue | undefined,
  elsewhere: Elsewhere[],
): string {
  const config = loadConfig(project.state);
  // An empty gate is the owner's answer, not a missing one, so it is not an invitation to set one.
  const gate = config.gate
    ? config.gate
    : config.gate === ""
      ? "none set, by this project's own choice"
      : "none; call set_project with the project's test command";
  const issueText = issue
    ? `\n\nIssue #${issue.number} as the Lead received it: ${outside("issue", issue.title, 200)} (${outside("issue", issue.url, 300)})\n<issue>\n${outside("issue", issue.body, 4000)}\n</issue>`
    : "";
  const where = slot.id ? `in working copy ${slot.id}` : "in the project's own working copy";
  const onBase =
    lane.branch === config.base
      ? `, which is the project's base: nothing separates this work from it and there is no lane branch to fall back on`
      : "";
  const on = lane.onBranch
    ? `carries on ${lane.branch} ${where}${onBase}`
    : `is open on ${lane.branch} (off ${lane.base}) ${where}`;
  const beside =
    elsewhere.length > 0
      ? ` It declared no write set, so it opened beside lanes that may be writing what only one lane at a time may write: ${elsewhereText(elsewhere)}. Its Lead is told to leave those to them; amend_lane can give it a write set.`
      : "";
  return `Lane ${lane.id} ${on}, and its Lead ${lead} is starting. Gate: ${gate}.${beside} Reports and asks arrive as mail; nothing to wait for now.${issueText}`;
}

/** Seats the Lead of a lane marked seating; a failure puts back what it took, moves the lane by `failed`, and is the reason. */
export async function startLead(
  desk: DeskServices,
  project: Project,
  lane: Lane,
  how: Seating & { failed: "close" | "wait" },
): Promise<Seated | string> {
  try {
    const started = await seatLead(desk, project, lane, how);
    if (typeof started === "string") {
      desk.ledgers.moveLane(project, lane.id, how.failed);
      if (how.failed === "close") {
        const landing = "its Lead could not start";
        recordEvent(project, {
          kind: "lane.closed",
          lane: lane.id,
          land: false,
          landing,
          reason: started,
          writers: [],
        });
      }
    }
    return started;
  } finally {
    desk.seating.release(workKey(project, lane.id));
  }
}

/** Drops the copy a lane took for a Lead that never started: it has been given back, and the lane waits or closes without it. */
export function forgetPlace(lane: Lane | undefined): void {
  if (!lane) return;
  delete lane.worktree;
  delete lane.slot;
  delete lane.workspaceId;
  delete lane.startSha;
}

async function seatLead(desk: DeskServices, project: Project, lane: Lane, how: Seating): Promise<Seated | string> {
  let copy: Copy;
  try {
    copy = await takeCopy(desk, project, lane, how);
  } catch (error) {
    return `The lane could not get a working copy: ${errorText(error)}`;
  }
  try {
    const leadRole = roleThatCan(desk.kit, "lead", how.role || undefined);
    if (!leadRole) {
      await giveBackCopy(desk, project, lane, how, copy);
      return namedOrNot(desk.kit, "lead", how.role ?? "", "lead a lane");
    }
    return await launchLead(desk, project, lane, how, copy, leadRole);
  } catch (error) {
    await giveBackCopy(desk, project, lane, how, copy);
    desk.ledgers.setLane(project, lane.id, (entry) => forgetPlace(entry));
    return `The Lead could not start: ${errorText(error)}`;
  }
}

/** The copy the lane works in: the project's own, on its branch or a new one, or a copy of its own. */
function takeCopy(
  { slots, ownCopy }: Pick<DeskServices, "slots" | "ownCopy">,
  project: Project,
  lane: Lane,
  how: Seating,
): Promise<Copy> {
  if (lane.onBranch) return ownCopy.carryOn(project, lane.branch, how.from);
  if (how.ownCopy) return slots.acquire(project, lane.branch, lane.base, { lane: lane.id }, `${lane.id} ${lane.title}`);
  return ownCopy.inPlace(project, lane.branch, lane.base);
}

async function giveBackCopy(
  { slots, ownCopy }: Pick<DeskServices, "slots" | "ownCopy">,
  project: Project,
  lane: Lane,
  how: Seating,
  taken: Copy,
): Promise<void> {
  if (taken.id) await slots.release(project, taken.id, lane.branch, lane.base);
  else if (how.from) await ownCopy.unstart(project, how.from, lane.branch);
  else if (!lane.onBranch) await ownCopy.giveBack(project, lane.base, lane.branch);
}

async function launchLead(
  { kit, ledgers, agents }: Pick<DeskServices, "kit" | "ledgers" | "agents">,
  project: Project,
  lane: Lane,
  how: Seating,
  copy: Copy,
  leadRole: RoleSpec,
): Promise<Seated> {
  const directed = await directiveFor(kit, project, lane, copy.path, how.issue);
  const startSha = lane.onBranch ? await headSha(copy.path) : undefined;
  // Where the Lead works goes on record before it starts, so a lane a stop leaves without its Lead still knows.
  ledgers.setLane(project, lane.id, (entry) => {
    Object.assign(entry, { worktree: copy.path, slot: copy.id, workspaceId: copy.workspaceId, startSha });
  });
  const lead = await agents.start(project, copy, leadRole.role, {
    parent: how.parent,
    title: seatTitle.of(lane, leadRole),
    prompt: directed.text,
    labels: { "seatworks.lane": lane.id, "seatworks.role": leadRole.role },
  });
  ledgers.transact(project, (ledger) => {
    const entry = ledger.lanes[lane.id];
    if (entry) entry.lead = lead;
    ledger.agents[lead] = { id: lead, role: leadRole.role, lane: lane.id };
  });
  const slot = copy.id ?? "in place";
  recordEvent(project, { kind: "lane.opened", lane: lane.id, lead, branch: lane.branch, base: lane.base, slot });
  return { slot: copy, lead, elsewhere: directed.elsewhere };
}
