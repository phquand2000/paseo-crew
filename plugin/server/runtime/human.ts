import type { Human } from "../desk/human.ts";
import type { Project } from "../desk/project.ts";
import type { LandDecided, OrdersRead, QuestionAnswered, ReportRead } from "../../shared/views.ts";
import type { HumanRpc } from "./rpc.ts";
import type { TeamSource } from "./team-source.ts";

type Refused = { error: string };

/** The Human's side of the panel for one project: what only they may decide, and what they read of it. */
export class HumanPanel implements HumanRpc {
  private readonly source: TeamSource;
  private readonly human: Human;

  constructor(source: TeamSource, human: Human) {
    this.source = source;
    this.human = human;
  }

  private project(slug: string): Project | Refused {
    return this.source.named(slug) ?? { error: `No project named ${slug} has been seen on this machine.` };
  }

  /** Their word on a held landing, from the panel, the one place it comes from: landing is already the Supervisor's call. */
  async decideLand(slug: string, lane: string, approve: boolean, note: string): Promise<LandDecided> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const decided = await this.human.decideLand(project, lane, approve, note.trim());
    return decided.ok ? { decided: decided.text } : { error: decided.text };
  }

  async answer(slug: string, question: string, choice: string, note: string): Promise<QuestionAnswered> {
    const project = this.project(slug);
    if ("error" in project) return project;
    const said = await this.human.answer(project, question.trim().toUpperCase(), choice.trim(), note.trim());
    return said.ok ? { answered: said.text } : { error: said.text };
  }

  orders(slug: string): OrdersRead {
    const project = this.project(slug);
    return "error" in project ? project : this.human.orders(project);
  }

  report(slug: string): ReportRead {
    const project = this.project(slug);
    return "error" in project ? project : this.human.report(project);
  }
}
