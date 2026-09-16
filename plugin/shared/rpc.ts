import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const project = z.string().min(1).optional();

export const catalogRpc = defineRpc({ name: "seatworks.catalog.read", input: z.object({}), output: z.json() });
export const settingsReadRpc = defineRpc({ name: "seatworks.settings.read", input: z.object({ project }), output: z.json() });
export const settingsWriteRpc = defineRpc({ name: "seatworks.settings.write", input: z.object({ project, revision: z.string(), values: z.json() }), output: z.json() });
export const settingsResetRpc = defineRpc({ name: "seatworks.settings.reset", input: z.object({ project, revision: z.string() }), output: z.json() });
export const projectsRpc = defineRpc({ name: "seatworks.projects.list", input: z.object({}), output: z.json() });
export const projectsAddRpc = defineRpc({ name: "seatworks.projects.add", input: z.object({ root: z.string().min(1) }), output: z.json() });
export const projectsRemoveRpc = defineRpc({ name: "seatworks.projects.remove", input: z.object({ project: z.string().min(1) }), output: z.json() });
export const projectsCandidatesRpc = defineRpc({ name: "seatworks.projects.candidates", input: z.object({ roots: z.array(z.string()) }), output: z.json() });
export const mcpParseRpc = defineRpc({ name: "seatworks.mcp.parse", input: z.object({ text: z.string().min(1) }), output: z.json() });
export const teamRpc = defineRpc({ name: "seatworks.team.read", input: z.object({ project }), output: z.json() });
export const doctorRpc = defineRpc({ name: "seatworks.doctor.run", input: z.object({ project }), output: z.json() });
export const statusRpc = defineRpc({ name: "seatworks.status.read", input: z.object({ project: z.string().min(1) }), output: z.json() });
export const flowRpc = defineRpc({ name: "seatworks.flow.read", input: z.object({ project: z.string().min(1), since: z.string().optional(), open: z.array(z.string()).optional() }), output: z.json() });
export const pathsRpc = defineRpc({ name: "seatworks.paths.list", input: z.object({ path: z.string().optional() }), output: z.json() });

export const contracts = {
  catalog: catalogRpc,
  settingsRead: settingsReadRpc,
  settingsWrite: settingsWriteRpc,
  settingsReset: settingsResetRpc,
  projects: projectsRpc,
  projectsAdd: projectsAddRpc,
  projectsRemove: projectsRemoveRpc,
  projectsCandidates: projectsCandidatesRpc,
  mcpParse: mcpParseRpc,
  team: teamRpc,
  doctor: doctorRpc,
  status: statusRpc,
  flow: flowRpc,
  paths: pathsRpc,
} as const;
