import type { z } from "zod";
import { contracts } from "../../shared/rpc.ts";
import type { Check } from "./doctor.ts";
import type { SettingsView, WriteResult } from "../catalog/settings.ts";

export { contracts };

export interface Control {
  catalog(): unknown;
  readSettings(project?: string): SettingsView;
  writeSettings(project: string | undefined, revision: string, values: unknown): WriteResult;
  resetSettings(project: string | undefined, revision: string): WriteResult;
  projects(): unknown;
  addProject(root: string): unknown;
  removeProject(project: string): unknown;
  candidateProjects(roots: string[]): unknown;
  parseMcp(text: string): unknown;
  team(project?: string): unknown;
  doctor(project?: string): Promise<Check[]>;
  status(project: string): Promise<unknown>;
}

type Handle = (contract: { name: string; input: z.ZodType; output: z.ZodType }, handler: (input: any) => unknown) => void;

export function registerRpc(server: { handle: unknown }, control: Control): string[] {
  const handle = (server.handle as Handle).bind(server);
  handle(contracts.catalog, () => control.catalog());
  handle(contracts.settingsRead, (input) => control.readSettings(input.project));
  handle(contracts.settingsWrite, (input) => control.writeSettings(input.project, input.revision, input.values));
  handle(contracts.settingsReset, (input) => control.resetSettings(input.project, input.revision));
  handle(contracts.projects, () => control.projects());
  handle(contracts.projectsAdd, (input) => control.addProject(input.root));
  handle(contracts.projectsRemove, (input) => control.removeProject(input.project));
  handle(contracts.projectsCandidates, (input) => control.candidateProjects(input.roots));
  handle(contracts.mcpParse, (input) => control.parseMcp(input.text));
  handle(contracts.team, (input) => control.team(input.project));
  handle(contracts.doctor, (input) => control.doctor(input.project));
  handle(contracts.status, (input) => control.status(input.project));
  return Object.values(contracts).map((contract) => contract.name);
}
