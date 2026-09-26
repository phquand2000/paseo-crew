import { z } from "zod";
import { no, ok } from "../context.ts";
import { defineTool } from "../services.ts";

const Said = z.strictObject({ question: z.string(), says: z.string(), why: z.string() });

export const judgeCase = defineTool({
  name: "judge",
  input: z.strictObject({ case: z.string(), answers: z.array(Said) }),
  async handle({ watcher }, caller, args) {
    const id = args.case.trim();
    const refused = watcher.answer(caller.id, id, args.answers);
    return refused ? no(refused) : ok(`${id} is answered. End your turn unless another case waits for you.`);
  },
});
