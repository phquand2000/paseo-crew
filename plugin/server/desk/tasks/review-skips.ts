import type { RoleSeat } from "../../catalog/team/role-seats.ts";
import { type FileKinds, kindOf } from "../../core/git-diff.ts";
import type { Ledger } from "../../domain/ledger.ts";
import type { Task } from "../../domain/task.ts";
import { earlierReviews } from "./review-handback.ts";

/** Why the project's settings keep this reviewing role off `target`: a fix round, or a change only of file kinds it skips. */
export function skipRefusal(
  seat: RoleSeat | undefined,
  ledger: Ledger,
  target: Task,
  files: string[] | undefined,
  kinds: FileKinds,
): string | undefined {
  if (!seat || seat.skips.length === 0) return undefined;
  const why = (seat.skips.includes("fix-round") ? fixRound(ledger, target) : undefined) ?? onlyOf(seat, files, kinds);
  if (!why) return undefined;
  return `The settings have the ${seat.role.label} skip ${seat.skips.join(", ")} (roles.${seat.role.role}.skips), and ${target.id} ${why}. Ask another role that reviews, or read it yourself.`;
}

/** A task an earlier review of it ended in changes is under its fixes, whether reworked or not. */
function fixRound(ledger: Ledger, target: Task): string | undefined {
  const changed = earlierReviews(ledger, { id: "", lane: target.lane, of: target.id }).filter(
    (review) => review.handback.outcome === "changes",
  );
  return changed.length > 0
    ? `is a fix round: ${changed.map((review) => review.id).join(", ")} ended in changes`
    : undefined;
}

/** A change git could not list is not judged by its files. */
function onlyOf(seat: RoleSeat, files: string[] | undefined, kinds: FileKinds): string | undefined {
  if (!files || files.length === 0) return undefined;
  const found = new Set(files.map((file) => kindOf(file, kinds)));
  const skipped = [...found].every((kind) => kind !== "src" && seat.skips.includes(kind));
  return skipped ? `changes only ${[...found].sort().join(" and ")} files` : undefined;
}
