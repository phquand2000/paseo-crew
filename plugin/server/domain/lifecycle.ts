type Step<Status extends string> = { readonly from: readonly Status[]; readonly to: Status };

export type Moves<Status extends string> = Record<string, Step<Status>>;

/** One kind's lifecycle as a single table: each move names the statuses it may leave and the one it reaches. */
export class Lifecycle<Status extends string, Move extends string> {
  readonly moves: Readonly<Record<Move, Step<Status>>>;

  constructor(moves: Record<Move, Step<Status>>) {
    this.moves = moves;
  }

  may(status: Status, move: Move): boolean {
    return this.moves[move].from.includes(status);
  }

  /** Makes `move` when the table lets it leave the status `entry` has now; false leaves `entry` as it was. */
  move(entry: { status: Status }, move: Move): boolean {
    if (!this.may(entry.status, move)) return false;
    entry.status = this.moves[move].to;
    return true;
  }
}
