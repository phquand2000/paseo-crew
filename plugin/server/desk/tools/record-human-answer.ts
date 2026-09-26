import { z } from "zod";
import { sentBy } from "../../core/sent-by.ts";
import { clip } from "../../core/text.ts";
import { settleQuestion } from "../answers.ts";
import { no, ok, str } from "../context.ts";
import { loadLedger } from "../ledger.ts";
import { defineTool } from "../services.ts";

/** Words as a quote is checked: spacing, a closing stop and case do not count. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").toLowerCase();

/** Puts an answer the Human gave in this chat on record, once their own words are found there. */
export const recordHumanAnswer = defineTool({
  name: "record_human_answer",
  input: z.strictObject({ question: z.string(), choice: z.string(), quote: z.string(), text: z.string().optional() }),
  async handle({ ctx, roster }, caller, args) {
    const { project } = caller;
    const id = args.question.trim().toUpperCase();
    const quote = flat(args.quote);
    const said = (await roster.history(caller.id, 200)).flatMap(({ item }) => (item.type === "user_message" && sentBy(item)[0] === "person" && typeof item.text === "string" ? [flat(item.text)] : []));
    if (!quote || !said.some((text) => text.includes(quote))) {
      return no(`The Human's own words "${clip(str(args.quote), 200)}" are not in this chat as far back as the desk reads: quote what they wrote exactly, or put it to them with ask_human.`);
    }
    const choice = args.choice.trim();
    const recorded = settleQuestion(ctx, project, id, choice, { text: str(args.text) || undefined, by: "chat", quote: str(args.quote) });
    if (typeof recorded === "string") return no(recorded);
    const lane = recorded.parked && recorded.lane ? loadLedger(project.state).lanes[recorded.lane] : undefined;
    const held = lane?.onHold ? ` Lane ${lane.id} is still on hold for it: resume_lane it once the answer is carried into the lane.` : "";
    return ok(`${id} is ${recorded.status}: ${choice}.${held}`);
  },
});
