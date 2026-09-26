import { basename } from "node:path";
import { roleThatCan } from "../catalog/kit.ts";
import { errorText } from "../core/errors.ts";
import { clip } from "../core/text.ts";
import type { Incident } from "./incidents.ts";
import type { Lane } from "./ledger.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

/** Paseo pushes an agent's reply to the Human's phone only as it finishes its first turn, so a pager is started for each page. */
async function page(desk: DeskServices, project: Project, text: string): Promise<void> {
  const role = roleThatCan(desk.ctx.kit, "page");
  if (!role) return;
  try {
    const workspace = await desk.slots.projectWorkspace(project);
    const agent = await desk.agents.start(project, { path: project.root, workspaceId: workspace.id }, role.role, { title: `Page: ${clip(text, 60)}`, prompt: text, labels: {} });
    desk.ctx.event(project, { kind: "page.sent", agent });
  } catch (error) {
    desk.ctx.event(project, { kind: "page.failed", error: errorText(error) });
  }
}

/** Two lines for the Human's phone about a page, from the record alone and short enough for Paseo to show whole: what, where, who has it. */
export async function pageIncident(desk: DeskServices, project: Project, incident: Incident, where: string, lane: Lane | undefined, told: boolean): Promise<void> {
  const who = told ? "Its Supervisor is told" : "No Supervisor is seated to tell";
  const held = lane?.onHold ? `lane ${lane.id} is on hold` : "nothing is held yet";
  await page(desk, project, clip(`${basename(project.root)}: ${where} ran ${clip(incident.quote, 90)}.\n${who}; ${held}.`, 220));
}
