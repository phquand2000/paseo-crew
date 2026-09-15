import { z } from "zod";
import type { Check } from "./doctor.ts";
import type { ReadResult, WriteResult } from "./settings.ts";

const project = z.string().min(1).optional();

export const contracts = {
  catalog: { name: "seatworks.catalog.read", input: z.object({}), output: z.json() },
  settingsRead: { name: "seatworks.settings.read", input: z.object({ project }), output: z.json() },
  settingsWrite: { name: "seatworks.settings.write", input: z.object({ project, revision: z.string(), values: z.json() }), output: z.json() },
  settingsReset: { name: "seatworks.settings.reset", input: z.object({ project, revision: z.string() }), output: z.json() },
  projects: { name: "seatworks.projects.list", input: z.object({}), output: z.json() },
  team: { name: "seatworks.team.read", input: z.object({ project }), output: z.json() },
  doctor: { name: "seatworks.doctor.run", input: z.object({ project }), output: z.json() },
  status: { name: "seatworks.status.read", input: z.object({ project: z.string().min(1) }), output: z.json() },
} as const;

export interface Control {
  catalog(): unknown;
  readSettings(project?: string): ReadResult;
  writeSettings(project: string | undefined, revision: string, values: unknown): WriteResult;
  resetSettings(project: string | undefined, revision: string): WriteResult;
  projects(): unknown;
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
  handle(contracts.team, (input) => control.team(input.project));
  handle(contracts.doctor, (input) => control.doctor(input.project));
  handle(contracts.status, (input) => control.status(input.project));
  return Object.values(contracts).map((contract) => contract.name);
}
