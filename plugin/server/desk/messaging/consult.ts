import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { roleThatCan } from "../../catalog/kit/roles.ts";
import { clip } from "../../core/text.ts";
import { type Caller, type ToolReply, no, ok } from "../context.ts";
import { messageLetters } from "../letters/message-letters.ts";
import { projectOf } from "../project/project.ts";
import type { DeskServices } from "../services.ts";

const ASKED_BY = "crew.consulted-by";

/** An Advisor reads the checkout for one turn and answers by mail; it holds no desk tools, so no lane or seat feels it. */
export async function consult(
  desk: Pick<DeskServices, "kit" | "agents" | "roster">,
  caller: Caller,
  args: { question: string; project?: string },
): Promise<ToolReply> {
  const role = roleThatCan(desk.kit, "advise");
  if (!role) return no("No role in this kit can advise, so there is nobody to consult.");
  if (!args.question.trim()) return no("Say what you want to know in question.");
  if (args.project !== undefined && !(isAbsolute(args.project) && existsSync(args.project)))
    return no(`${args.project} is no directory here: name the other checkout by its absolute path.`);
  const project = args.project === undefined ? caller.project : projectOf(args.project);
  const prompt = [
    `The ${caller.role.label} of ${basename(caller.project.root)} consults you about this checkout:`,
    "",
    args.question.trim(),
    "",
    "You have this one turn: what you say last is all they get.",
  ].join("\n");
  const agent = await desk.agents.startResident(project, role.role, {
    title: `Consult: ${clip(args.question.trim(), 60)}`,
    prompt,
    labels: { [ASKED_BY]: caller.id },
  });
  desk.roster.archiveAfterTurn(agent);
  return ok(`Asked ${agent} in ${project.root}; its answer comes as mail, and it goes once it has answered.`);
}

/** A seat with no desk tools ended its turn: one a consult started tells whoever consulted it what it said last. */
export async function consulted(
  desk: Pick<DeskServices, "roster" | "mail">,
  agentId: string,
  answer: { said: boolean; text: string },
): Promise<void> {
  const seat = await desk.roster.look(agentId);
  const by = seat.labels?.[ASKED_BY];
  if (!by) return;
  const where = seat.cwd ? basename(projectOf(seat.cwd).root) : "its checkout";
  await desk.mail.post(by, messageLetters.consulted(agentId, where, answer));
}
