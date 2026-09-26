import { z } from "zod";
import { can, roleNamed } from "../../catalog/kit.ts";
import { ASK } from "../../domain/ask.ts";
import { no, ok, str } from "../context.ts";
import { repeatsIncident } from "../incidents.ts";
import { type Ask, loadLedger } from "../ledger.ts";
import { askLetters } from "../ask-letters.ts";
import { defineTool } from "../services.ts";

export const answer = defineTool({
  name: "answer",
  input: z.strictObject({ ask: z.string(), text: z.string() }),
  async handle({ ctx }, caller, args) {
    const id = str(args.ask).toUpperCase();
    const text = str(args.text);
    const refused = repeatsIncident(caller.project.state, loadLedger(caller.project.state).asks[id]?.from, text);
    if (refused) return no(refused);
    const result = ctx.transact(caller.project, (ledger): { ask: Ask; waitingRole?: string } | string => {
      const ask = ledger.asks[id];
      if (!ask) return `There is no ask ${id}.`;
      if (!ASK.may(ask.status, "answer")) return `Ask ${id} is already answered.`;
      if (ask.to !== caller.id && !can(caller.role, "supervise")) return `Ask ${id} was not addressed to you.`;
      ASK.move(ask, "answer");
      ask.answer = text;
      return { ask: { ...ask }, waitingRole: ledger.agents[ask.to]?.role };
    });
    if (typeof result === "string") return no(result);
    const { ask } = result;
    // Answering an ask put to someone else is allowed (the round escalates them), but that seat is told first.
    const waiting = ask.to === caller.id ? undefined : ask.to;
    const by =
      waiting && can(roleNamed(ctx.kit, result.waitingRole ?? ""), "supervise")
        ? `${caller.role.label} ${caller.id}`
        : "the owner";
    if (waiting)
      await ctx.post(
        waiting,
        askLetters.answeredFor(ask, by, can(roleNamed(ctx.kit, result.waitingRole ?? ""), "lead")),
      );
    const posted = await ctx.post(ask.from, askLetters.answered(ask));
    ctx.event(caller.project, { kind: "ask.answered", ask: ask.id, by: caller.id, told: waiting ?? null });
    return ok(
      `Answered ${ask.id}; the asker ${posted === "sent" ? "has it" : "reads it as soon as it can take it"}.${waiting ? " Whoever it was waiting on has been told what it was answered with." : ""}`,
    );
  },
});
