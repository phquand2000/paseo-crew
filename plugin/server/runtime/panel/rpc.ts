import type { z } from "zod";
import { contracts } from "../../../shared/rpc.ts";

type Contract = { name: string; input: z.ZodType; output: z.ZodType };
type Out<C extends Contract> = z.input<C["output"]> | Promise<z.input<C["output"]>>;

/** The machine's and a project's settings as the panel reads and changes them, and what the team they make needs. */
export interface SettingsRpc {
  catalog(): Out<typeof contracts.catalog>;
  readSettings(project?: string): Out<typeof contracts.settingsRead>;
  writeSettings(project: string | undefined, revision: string, values: unknown): Out<typeof contracts.settingsWrite>;
  parseMcp(text: string): Out<typeof contracts.mcpParse>;
  team(project?: string): Out<typeof contracts.team>;
  doctor(project?: string): Out<typeof contracts.doctor>;
  refreshModels(): Out<typeof contracts.models>;
}

/** The projects on this machine: which are attached, and how each one's work stands. */
export interface ProjectsRpc {
  projects(): Out<typeof contracts.projects>;
  addProject(root: string): Out<typeof contracts.projectsAdd>;
  removeProject(project: string): Out<typeof contracts.projectsRemove>;
  candidateProjects(roots: string[]): Out<typeof contracts.projectsCandidates>;
  listPaths(path?: string): Out<typeof contracts.paths>;
  status(project: string): Out<typeof contracts.status>;
  flow(project: string, since?: string, open?: string[]): Out<typeof contracts.flow>;
}

/** Keeping the plugin itself in order: what it left behind, its updates, and the kit files the owner changed. */
export interface UpkeepRpc {
  clean(remove?: string[]): Out<typeof contracts.clean>;
  update(apply: boolean, fetch?: boolean): Out<typeof contracts.update>;
  migrate(apply: boolean): Out<typeof contracts.migrate>;
  decide(unit: string, choice: "new" | "mine" | "seen"): Out<typeof contracts.decide>;
}

/** What only the Human decides on the panel, and what they read there. */
export interface HumanRpc {
  decideLand(project: string, lane: string, approve: boolean, note: string): Out<typeof contracts.landDecide>;
  answer(project: string, question: string, choice: string, note: string): Out<typeof contracts.questionAnswer>;
  orders(project: string): Out<typeof contracts.orders>;
  report(project: string): Out<typeof contracts.report>;
}

/** Everything the panel calls, by the area of the panel that calls it. */
export type Panel = { settings: SettingsRpc; projects: ProjectsRpc; upkeep: UpkeepRpc; human: HumanRpc };

/** Serves one contract: the handler takes what its input schema reads and gives what its output schema holds. */
type Serve = <C extends Contract>(contract: C, answer: (input: z.output<C["input"]>) => Out<C>) => void;

/** `called` runs before every answer, since a panel call is how the runtime learns someone is looking. */
export function registerRpc(serve: Serve, panel: Panel, called: () => void): void {
  const handle: Serve = (contract, answer) =>
    serve(contract, (input) => {
      called();
      return answer(input);
    });
  const { settings, projects, upkeep, human } = panel;
  handle(contracts.catalog, () => settings.catalog());
  handle(contracts.settingsRead, (input) => settings.readSettings(input.project));
  handle(contracts.settingsWrite, (input) => settings.writeSettings(input.project, input.revision, input.values));
  handle(contracts.mcpParse, (input) => settings.parseMcp(input.text));
  handle(contracts.team, (input) => settings.team(input.project));
  handle(contracts.doctor, (input) => settings.doctor(input.project));
  handle(contracts.models, () => settings.refreshModels());
  handle(contracts.projects, () => projects.projects());
  handle(contracts.projectsAdd, (input) => projects.addProject(input.root));
  handle(contracts.projectsRemove, (input) => projects.removeProject(input.project));
  handle(contracts.projectsCandidates, (input) => projects.candidateProjects(input.roots));
  handle(contracts.paths, (input) => projects.listPaths(input.path));
  handle(contracts.status, (input) => projects.status(input.project));
  handle(contracts.flow, (input) => projects.flow(input.project, input.since, input.open));
  handle(contracts.clean, (input) => upkeep.clean(input.remove));
  handle(contracts.update, (input) => upkeep.update(input.apply, input.fetch));
  handle(contracts.migrate, (input) => upkeep.migrate(input.apply));
  handle(contracts.decide, (input) => upkeep.decide(input.unit, input.choice));
  handle(contracts.landDecide, (input) => human.decideLand(input.project, input.lane, input.approve, input.note));
  handle(contracts.questionAnswer, (input) => human.answer(input.project, input.question, input.choice, input.note));
  handle(contracts.orders, (input) => human.orders(input.project));
  handle(contracts.report, (input) => human.report(input.project));
}
