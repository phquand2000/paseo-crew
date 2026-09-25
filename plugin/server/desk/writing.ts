import { midTurn } from "../core/paseo.ts";
import type { Roster } from "./roster.ts";

/** Which of `ids` are mid-turn now; one that cannot be looked at counts as mid-turn, since it may be writing. */
export async function midTurnAmong(roster: Roster, ids: (string | undefined)[]): Promise<string[]> {
  const seats = ids.filter((id): id is string => typeof id === "string");
  const writing = await Promise.all(
    seats.map(async (id) => {
      try {
        const seat = await roster.look(id);
        return !seat.archivedAt && midTurn(seat.status);
      } catch {
        return true;
      }
    }),
  );
  return seats.filter((_, index) => writing[index]);
}
