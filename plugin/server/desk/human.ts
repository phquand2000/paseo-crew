import type { OrdersView, ReportView } from "../../shared/views.ts";
import { settleQuestion } from "./answers.ts";
import { askLetters } from "./ask-letters.ts";
import { reportView } from "./away.ts";
import { decideLand } from "./closing.ts";
import { loadLedger } from "./ledger.ts";
import { ordersView } from "./orders.ts";
import type { Project } from "./project.ts";
import type { DeskServices } from "./services.ts";

type Said = { ok: boolean; text: string };

/** What the Human does and reads on the panel for a project: their word on a held landing or on a question, their standing orders, the last day. */
export class Human {
  private readonly services: DeskServices;

  constructor(services: DeskServices) {
    this.services = services;
  }

  decideLand(project: Project, lane: string, approve: boolean, note: string): Promise<Said> {
    return decideLand(this.services, project, lane, approve, note);
  }

  /** Their choice among a question's options, or decline, and whoever asked is told: cancelling one is the Supervisor's. */
  async answer(project: Project, id: string, choice: string, note: string): Promise<Said> {
    const { ctx, roster } = this.services;
    if (choice.toLowerCase() === "cancel") return { ok: false, text: "Only the Supervisor cancels a question; choose one of its options, or decline it." };
    const settled = settleQuestion(ctx, project, id, choice, { text: note || undefined, by: "panel" });
    if (typeof settled === "string") return { ok: false, text: settled };
    const lane = settled.lane ? loadLedger(project.state).lanes[settled.lane] : undefined;
    const to = (await roster.seated(settled.from)) ? settled.from : await roster.supervisorFor(project, lane?.opener);
    const posted = await ctx.post(to, askLetters.humanAnswered(settled, lane));
    const told = posted === "nobody" ? "Nobody supervising is seated to be told; it is on the record for whoever comes back." : "The Supervisor has it.";
    return { ok: true, text: `${id} is ${settled.status}${settled.status === "answered" ? `: ${choice}` : ""}. ${told}` };
  }

  orders(project: Project): OrdersView {
    return ordersView(this.services.ctx.kit, project);
  }

  report(project: Project): ReportView {
    return reportView(project, this.services.ctx.team(project).attention.questionsPerDay);
  }
}
