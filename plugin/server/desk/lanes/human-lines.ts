import { clip } from "../../core/text.ts";
import type { HumanClaim } from "../../domain/lane.ts";
import { type Caller, str } from "../context.ts";
import { humanWrote } from "../human/human-words.ts";
import type { DeskServices } from "../services.ts";
import { loadLedger } from "../store/ledger.ts";

/** A line named the Human's as a call gives it. */
export type Claimed = { line: string; question?: string; quote?: string };

/** The lines a call names the Human's, each checked against their word: a question they answered, or what they wrote in the caller's chat. */
export async function humanClaims(
  desk: Pick<DeskServices, "roster">,
  caller: Caller,
  given: Claimed[] | undefined,
): Promise<HumanClaim[] | string> {
  const questions = loadLedger(caller.project.state).questions;
  const claims: HumanClaim[] = [];
  for (const entry of given ?? []) {
    const claim = {
      line: str(entry.line),
      question: str(entry.question).toUpperCase() || undefined,
      quote: str(entry.quote) || undefined,
    };
    const line = `"${clip(claim.line, 200)}"`;
    if (!claim.question && !claim.quote)
      return `${line} is named the Human's with nothing of theirs behind it: give question, one they answered, or quote, their words in this chat.`;
    if (claim.question && questions[claim.question]?.status !== "answered")
      return `${claim.question} is no question the Human answered, so it cannot stand behind ${line}: quote their words, or leave the line as your choice.`;
    if (claim.quote && !(await humanWrote(desk, caller.id, claim.quote)))
      return `The Human's words "${clip(claim.quote, 200)}" are not in this chat as far back as the desk reads, so they cannot stand behind ${line}: quote them exactly, or leave the line as your choice.`;
    claims.push(claim);
  }
  return claims;
}

export const strayLine = (claim: HumanClaim): string =>
  `"${clip(claim.line, 200)}" is not a line of the lane's acceptance or out of scope, word for word, nor a line of the Human's this drops.`;
