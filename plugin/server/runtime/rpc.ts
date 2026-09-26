import type { z } from "zod";
import { contracts } from "../../shared/rpc.ts";

type Contract = { name: string; input: z.ZodType; output: z.ZodType };
type Out<C extends Contract> = z.input<C["output"]> | Promise<z.input<C["output"]>>;

export interface Control {
  catalog(): Out<typeof contracts.catalog>;
  readSettings(project?: string): Out<typeof contracts.settingsRead>;
  writeSettings(project: string | undefined, revision: string, values: unknown): Out<typeof contracts.settingsWrite>;
  projects(): Out<typeof contracts.projects>;
  addProject(root: string): Out<typeof contracts.projectsAdd>;
  removeProject(project: string): Out<typeof contracts.projectsRemove>;
  candidateProjects(roots: string[]): Out<typeof contracts.projectsCandidates>;
  parseMcp(text: string): Out<typeof contracts.mcpParse>;
  team(project?: string): Out<typeof contracts.team>;
  doctor(project?: string): Out<typeof contracts.doctor>;
  status(project: string): Out<typeof contracts.status>;
  flow(project: string, since?: string, open?: string[]): Out<typeof contracts.flow>;
  listPaths(path?: string): Out<typeof contracts.paths>;
  refreshModels(): Out<typeof contracts.models>;
  decide(unit: string, choice: "new" | "mine" | "seen"): Out<typeof contracts.decide>;
  clean(remove?: string[]): Out<typeof contracts.clean>;
  update(apply: boolean, fetch?: boolean): Out<typeof contracts.update>;
  migrate(apply: boolean): Out<typeof contracts.migrate>;
}

/** What only the Human decides on the panel, and what they read there. */
export interface HumanRpc {
  decideLand(project: string, lane: string, approve: boolean, note: string): Out<typeof contracts.landDecide>;
  answer(project: string, question: string, choice: string, note: string): Out<typeof contracts.questionAnswer>;
  orders(project: string): Out<typeof contracts.orders>;
  report(project: string): Out<typeof contracts.report>;
}

/** Serves one contract: the handler takes what its input schema reads and gives what its output schema holds. */
type Serve = <C extends Contract>(contract: C, answer: (input: z.output<C["input"]>) => Out<C>) => void;

/** `called` runs before every answer, since a panel call is how the runtime learns someone is looking. */
export function registerRpc(serve: Serve, control: Control, human: HumanRpc, called: () => void): string[] {
  const handle: Serve = (contract, answer) =>
    serve(contract, (input) => {
      called();
      return answer(input);
    });
  handle(contracts.catalog, () => control.catalog());
  handle(contracts.settingsRead, (input) => control.readSettings(input.project));
  handle(contracts.settingsWrite, (input) => control.writeSettings(input.project, input.revision, input.values));
  handle(contracts.projects, () => control.projects());
  handle(contracts.projectsAdd, (input) => control.addProject(input.root));
  handle(contracts.projectsRemove, (input) => control.removeProject(input.project));
  handle(contracts.projectsCandidates, (input) => control.candidateProjects(input.roots));
  handle(contracts.mcpParse, (input) => control.parseMcp(input.text));
  handle(contracts.team, (input) => control.team(input.project));
  handle(contracts.doctor, (input) => control.doctor(input.project));
  handle(contracts.status, (input) => control.status(input.project));
  handle(contracts.flow, (input) => control.flow(input.project, input.since, input.open));
  handle(contracts.landDecide, (input) => human.decideLand(input.project, input.lane, input.approve, input.note));
  handle(contracts.questionAnswer, (input) => human.answer(input.project, input.question, input.choice, input.note));
  handle(contracts.orders, (input) => human.orders(input.project));
  handle(contracts.report, (input) => human.report(input.project));
  handle(contracts.paths, (input) => control.listPaths(input.path));
  handle(contracts.models, () => control.refreshModels());
  handle(contracts.decide, (input) => control.decide(input.unit, input.choice));
  handle(contracts.clean, (input) => control.clean(input.remove));
  handle(contracts.update, (input) => control.update(input.apply, input.fetch));
  handle(contracts.migrate, (input) => control.migrate(input.apply));
  return Object.values(contracts).map((contract) => contract.name);
}
