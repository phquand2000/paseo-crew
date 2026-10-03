import { recordEvent } from "../store/event-log.ts";
import { basename } from "node:path";
import { roleThatCan } from "../../catalog/kit/roles.ts";
import { errorText } from "../../core/errors.ts";
import { clip } from "../../core/text.ts";
import type { Incident } from "../store/incidents.ts";
import type { Lane } from "../../domain/lane.ts";
import type { Project } from "../project/project.ts";
import type { DeskServices } from "../services.ts";

/** Paseo pushes an agent's reply to the Human's phone only as it finishes its first turn, so a pager is started for each page and goes after it. */
async function page(desk: DeskServices, project: Project, text: string): Promise<void> {
  const role = roleThatCan(desk.kit, "page");
  if (!role) return;
  try {
    const workspace = await desk.slots.projectWorkspace(project);
    const agent = await desk.agents.start(project, { path: project.root, workspaceId: workspace.id }, role.role, {
      title: `Page: ${clip(text, 60)}`,
      prompt: text,
      labels: {},
    });
    desk.roster.archiveAfterTurn(agent);
    recordEvent(project, { kind: "page.sent", agent });
  } catch (error) {
    recordEvent(project, { kind: "page.failed", error: errorText(error) });
  }
}

/** Two lines for the Human's phone about a page, from the record alone and short enough for Paseo to show whole: what, where, who has it. */
export async function pageIncident(
  desk: DeskServices,
  project: Project,
  incident: Pick<Incident, "quote">,
  where: string,
  lane: Lane | undefined,
  told: boolean,
): Promise<void> {
  const who = told ? "Its Supervisor is told" : "No Supervisor is seated to tell";
  const held = lane?.onHold ? `lane ${lane.id} is on hold` : "nothing is held yet";
  await page(
    desk,
    project,
    clip(`${basename(project.root)}: ${where} ran ${clip(incident.quote, 90)}.\n${who}; ${held}.`, 220),
  );
}

/** Two lines for the Human's phone as the Supervisor stops on its usage limit: no seat answers for it until it resets. */
export async function pageLimited(
  desk: DeskServices,
  project: Project,
  resets: string | null,
  waiting: string[],
): Promise<void> {
  const until = resets ? `until ${resets}` : "with no reset time the desk could read";
  const held =
    waiting.length === 0
      ? "nothing waits on it yet"
      : `${waiting.length} ask${waiting.length === 1 ? "" : "s"} wait${waiting.length === 1 ? "s" : ""} on it`;
  const text = `${basename(project.root)}: its Supervisor stopped on its usage limit ${until}; ${held}.`;
  await page(desk, project, clip(`${text}\nSeat a Supervisor on another agent, or wait.`, 220));
}
