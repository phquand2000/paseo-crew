import type { HarnessSpec } from "../catalog/kit/kit.ts";
import type { Desk } from "../desk/desk.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import type { Project } from "../desk/project/project.ts";
import { troubleOf } from "./timeline.ts";

type TroubleDesk = Pick<Desk, "event" | "post" | "pageSignedOut">;

/** A turn its agent's provider turned away: sent again once when the refusal may pass, paged to the Human once a spell when the agent is signed out. */
export class ProviderTrouble {
  private readonly desk: TroubleDesk;
  private readonly retried = new Set<string>();
  private readonly paged = new Set<string>();

  constructor(desk: TroubleDesk) {
    this.desk = desk;
  }

  /** `retried` when the turn was sent again, so its owner need not hear of it yet. */
  async ended(
    project: Project,
    turn: { agent: string; id: string | number; said: string },
    harness: HarnessSpec,
  ): Promise<"retried" | "signedOut" | undefined> {
    const trouble = troubleOf(harness, turn.said);
    const spell = `${project.root}\n${harness.id}`;
    if (!trouble) {
      this.retried.delete(turn.agent);
      this.paged.delete(spell);
      return undefined;
    }
    const retry = trouble === "transient" && !this.retried.has(turn.agent);
    this.desk.event(project, { kind: "seat.trouble", agent: turn.agent, trouble, retried: retry });
    if (retry) {
      this.retried.add(turn.agent);
      await this.desk.post(turn.agent, seatLetters.retry(turn.agent, turn.id));
      return "retried";
    }
    if (trouble === "transient") return undefined;
    if (!this.paged.has(spell)) {
      this.paged.add(spell);
      await this.desk.pageSignedOut(project, harness.label);
    }
    return "signedOut";
  }

  forget(agent: string): void {
    this.retried.delete(agent);
  }
}
