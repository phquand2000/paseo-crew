import { z } from "zod";
import { RiskRule } from "../../catalog/kit/schema/ecosystem.ts";
import { setProject as set } from "../project/settings.ts";
import { LANE_HOMES } from "../project/project.ts";
import { defineTool } from "../services.ts";

export const setProject = defineTool({
  name: "set_project",
  input: z.strictObject({
    base: z.string().optional(),
    gate: z.string().optional(),
    gateTimeoutMinutes: z.number().optional(),
    gateOn: z.enum(["lane", "task"]).optional(),
    serialOnly: z.array(z.string()).optional(),
    landAs: z.enum(["squash", "merge", "ff"]).optional(),
    laneHome: z.enum(LANE_HOMES).optional(),
    askFirst: z.array(z.string()).optional(),
    riskRules: z.array(RiskRule).optional(),
  }),
  handle: (_desk, caller, args) => set(caller, args),
});
