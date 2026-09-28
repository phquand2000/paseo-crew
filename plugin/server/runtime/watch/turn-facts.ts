import { oneLine } from "../../core/text.ts";
import { type Fact, fact } from "./fact-kinds.ts";
import { type Rules, PROSE, escapes, failed, isGate, str } from "./facts.ts";
import type { Call, Window } from "./window.ts";

/** The instruction's calls, with where the last edit inside the working copy and the last run of the gate fell. */
function lastWriteAndGate(window: Window, rules: Rules) {
  const calls = window.sinceInstruction().flatMap((unit) => (unit.kind === "call" ? [unit.call] : []));
  // Prose needs no gate: a hand-back that only wrote docs was told it had not run the tests.
  const inside = (call: Call) =>
    (call.detail.type === "edit" || call.detail.type === "write") &&
    !escapes(str(call.detail.filePath), rules) &&
    !PROSE.test(str(call.detail.filePath));
  let lastWrite = -1;
  let lastGate = -1;
  calls.forEach((call, index) => {
    if (inside(call) && !failed(call)) lastWrite = index;
    if (isGate(call, rules.gates)) lastGate = index;
  });
  return { calls, lastWrite, lastGate };
}

/** A hand-back that says the work is complete when the check it ran after its last edit failed: the record, not the claim, is what settles it. */
export function contradicted(window: Window, rules: Rules, outcome: string | undefined): Fact[] {
  if (outcome !== "complete") return [];
  const { calls, lastWrite, lastGate } = lastWriteAndGate(window, rules);
  const check = calls[lastGate];
  if (!check || lastGate < lastWrite || !failed(check)) return [];
  return [
    fact(
      "claim-contradicted",
      `handed back as complete, but \`${oneLine(str(check.detail.command), 100)}\` failed the last time it ran, after the last edit`,
    ),
  ];
}

/** A turn whose first change came before it read, searched or ran anything since an instruction the window still holds: what it was told, taken on trust. */
export function editBeforeLook(window: Window, rules: Rules): Fact[] {
  if (!window.instruction()) return [];
  const first = window
    .sinceInstruction()
    .find((unit) => unit.kind === "call" && !unit.call.pseudo && !rules.desk?.(unit.call));
  if (first?.kind !== "call" || (first.call.detail.type !== "edit" && first.call.detail.type !== "write")) return [];
  return [
    fact("edit-before-look", `changed ${oneLine(str(first.call.detail.filePath))} before reading or running anything`),
  ];
}
