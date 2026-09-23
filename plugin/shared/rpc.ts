import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const project = z.string().min(1).optional();

export const KEPT = "kept, not shown";

export const catalogRpc = defineRpc({ name: "paseo-crew.catalog.read", input: z.object({}), output: z.json() });
export const settingsReadRpc = defineRpc({ name: "paseo-crew.settings.read", input: z.object({ project }), output: z.json() });
export const settingsWriteRpc = defineRpc({ name: "paseo-crew.settings.write", input: z.object({ project, revision: z.string(), values: z.json() }), output: z.json() });
export const projectsRpc = defineRpc({ name: "paseo-crew.projects.list", input: z.object({}), output: z.json() });
export const projectsAddRpc = defineRpc({ name: "paseo-crew.projects.add", input: z.object({ root: z.string().min(1) }), output: z.json() });
export const projectsRemoveRpc = defineRpc({ name: "paseo-crew.projects.remove", input: z.object({ project: z.string().min(1) }), output: z.json() });
export const projectsCandidatesRpc = defineRpc({ name: "paseo-crew.projects.candidates", input: z.object({ roots: z.array(z.string()) }), output: z.json() });
export const mcpParseRpc = defineRpc({ name: "paseo-crew.mcp.parse", input: z.object({ text: z.string().min(1) }), output: z.json() });
export const teamRpc = defineRpc({ name: "paseo-crew.team.read", input: z.object({ project }), output: z.json() });
export const doctorRpc = defineRpc({ name: "paseo-crew.doctor.run", input: z.object({ project }), output: z.json() });
export const statusRpc = defineRpc({ name: "paseo-crew.status.read", input: z.object({ project: z.string().min(1) }), output: z.json() });
export const flowRpc = defineRpc({ name: "paseo-crew.flow.read", input: z.object({ project: z.string().min(1), since: z.string().optional(), open: z.array(z.string()).optional() }), output: z.json() });
export const modelsRpc = defineRpc({ name: "paseo-crew.models.refresh", input: z.object({}), output: z.json() });
export const decideRpc = defineRpc({ name: "paseo-crew.upkeep.decide", input: z.object({ unit: z.string().min(1), choice: z.enum(["new", "mine", "seen"]) }), output: z.json() });
export const cleanRpc = defineRpc({ name: "paseo-crew.upkeep.clean", input: z.object({ remove: z.array(z.string()).optional() }), output: z.json() });
export const updateRpc = defineRpc({ name: "paseo-crew.upkeep.update", input: z.object({ apply: z.boolean(), fetch: z.boolean().optional() }), output: z.json() });
export const migrateRpc = defineRpc({ name: "paseo-crew.upkeep.migrate", input: z.object({ apply: z.boolean() }), output: z.json() });
export const pathsRpc = defineRpc({ name: "paseo-crew.paths.list", input: z.object({ path: z.string().optional() }), output: z.json() });

export const contracts = {
  catalog: catalogRpc,
  settingsRead: settingsReadRpc,
  settingsWrite: settingsWriteRpc,
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
  models: modelsRpc,
  decide: decideRpc,
  clean: cleanRpc,
  update: updateRpc,
  migrate: migrateRpc,
} as const;
