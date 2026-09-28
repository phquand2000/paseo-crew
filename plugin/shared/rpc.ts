import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  Added,
  CatalogView,
  Check,
  LandDecided,
  ModelsRefreshed,
  OrdersRead,
  Parsed,
  Paths,
  ProjectRow,
  QuestionAnswered,
  Removed,
  ReportRead,
  SettingsRead,
  StatusView,
  TeamRead,
  WriteResult,
} from "./views.ts";
import { CleanView, MigrateView, UpdateView } from "./upkeep-views.ts";
import { FlowRead } from "./flow-views.ts";

const project = z.string().min(1).optional();

export const catalogRpc = defineRpc({ name: "crew.catalog.read", input: z.object({}), output: CatalogView });
export const settingsReadRpc = defineRpc({
  name: "crew.settings.read",
  input: z.object({ project }),
  output: SettingsRead,
});
export const settingsWriteRpc = defineRpc({
  name: "crew.settings.write",
  input: z.object({ project, revision: z.string(), values: z.json() }),
  output: WriteResult,
});
export const projectsRpc = defineRpc({
  name: "crew.projects.list",
  input: z.object({}),
  output: z.array(ProjectRow),
});
export const projectsAddRpc = defineRpc({
  name: "crew.projects.add",
  input: z.object({ root: z.string().min(1) }),
  output: Added,
});
export const projectsRemoveRpc = defineRpc({
  name: "crew.projects.remove",
  input: z.object({ project: z.string().min(1) }),
  output: Removed,
});
export const projectsCandidatesRpc = defineRpc({
  name: "crew.projects.candidates",
  input: z.object({ roots: z.array(z.string()) }),
  output: z.array(z.string()),
});
export const mcpParseRpc = defineRpc({
  name: "crew.mcp.parse",
  input: z.object({ text: z.string().min(1) }),
  output: Parsed,
});
export const teamRpc = defineRpc({ name: "crew.team.read", input: z.object({ project }), output: TeamRead });
export const doctorRpc = defineRpc({
  name: "crew.doctor.run",
  input: z.object({ project }),
  output: z.array(Check),
});
export const statusRpc = defineRpc({
  name: "crew.status.read",
  input: z.object({ project: z.string().min(1) }),
  output: StatusView,
});
export const flowRpc = defineRpc({
  name: "crew.flow.read",
  input: z.object({ project: z.string().min(1), since: z.string().optional(), open: z.array(z.string()).optional() }),
  output: FlowRead,
});
export const landDecideRpc = defineRpc({
  name: "crew.land.decide",
  input: z.object({ project: z.string().min(1), lane: z.string().min(1), approve: z.boolean(), note: z.string() }),
  output: LandDecided,
});
export const questionAnswerRpc = defineRpc({
  name: "crew.question.answer",
  input: z.object({
    project: z.string().min(1),
    question: z.string().min(1),
    choice: z.string().min(1),
    note: z.string(),
  }),
  output: QuestionAnswered,
});
export const ordersRpc = defineRpc({
  name: "crew.orders.read",
  input: z.object({ project: z.string().min(1) }),
  output: OrdersRead,
});
export const reportRpc = defineRpc({
  name: "crew.report.read",
  input: z.object({ project: z.string().min(1) }),
  output: ReportRead,
});
export const modelsRpc = defineRpc({ name: "crew.models.refresh", input: z.object({}), output: ModelsRefreshed });
export const decideRpc = defineRpc({
  name: "crew.upkeep.decide",
  input: z.object({ unit: z.string().min(1), choice: z.enum(["new", "mine", "seen"]) }),
  output: MigrateView,
});
export const cleanRpc = defineRpc({
  name: "crew.upkeep.clean",
  input: z.object({ remove: z.array(z.string()).optional() }),
  output: CleanView,
});
export const updateRpc = defineRpc({
  name: "crew.upkeep.update",
  input: z.object({ apply: z.boolean(), fetch: z.boolean().optional() }),
  output: UpdateView,
});
export const migrateRpc = defineRpc({
  name: "crew.upkeep.migrate",
  input: z.object({ apply: z.boolean() }),
  output: MigrateView,
});
export const pathsRpc = defineRpc({
  name: "crew.paths.list",
  input: z.object({ path: z.string().optional() }),
  output: Paths,
});

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
  landDecide: landDecideRpc,
  questionAnswer: questionAnswerRpc,
  orders: ordersRpc,
  report: reportRpc,
  paths: pathsRpc,
  models: modelsRpc,
  decide: decideRpc,
  clean: cleanRpc,
  update: updateRpc,
  migrate: migrateRpc,
} as const;
