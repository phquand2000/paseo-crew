import { z } from "zod";
import { RiskRule } from "../../catalog/schema.ts";
import { configFault } from "../../core/config-file.ts";
import { branchExists, LAND_AS } from "../../core/git.ts";
import { no, ok, str, strs } from "../context.ts";
import { LANE_HOMES, type ProjectConfig, configFile, loadConfig, saveConfig } from "../project.ts";
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
  async handle(_desk, caller, args) {
    // Refused as open_lane refuses: read as all defaults, an unreadable file was saved over with them.
    const unreadable = configFault(configFile(caller.project.state));
    if (unreadable)
      return no(`${unreadable}\nOnly the Human can repair it or move it aside; nothing was saved over it.`);
    const config = loadConfig(caller.project.state);
    const base = str(args.base);
    if (base && !(await branchExists(caller.project.root, base))) return no(`The branch ${base} does not exist.`);
    const minutes = Number(args.gateTimeoutMinutes);
    const next: ProjectConfig = {
      ...config,
      base: base || config.base,
      gate: typeof args.gate === "string" ? args.gate.trim() : config.gate,
      gateTimeoutMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : config.gateTimeoutMinutes,
      gateOn: args.gateOn === "task" ? "task" : args.gateOn === "lane" ? "lane" : config.gateOn,
      serialOnly: Array.isArray(args.serialOnly) ? strs(args.serialOnly) : config.serialOnly,
      landAs: LAND_AS.find((as) => as === args.landAs) ?? config.landAs,
      laneHome: args.laneHome ?? config.laneHome,
      askFirst: Array.isArray(args.askFirst)
        ? strs(args.askFirst)
            .map((path) => path.trim())
            .filter(Boolean)
        : config.askFirst,
      riskRules: args.riskRules ?? config.riskRules,
    };
    saveConfig(caller.project.state, next);
    const home = next.laneHome
      ? `lanes open as ${next.laneHome} unless a call says otherwise`
      : "where a lane opens is asked when the Human's copy makes it a question";
    const asked =
      next.askFirst.length > 0
        ? `a landing that touches ${next.askFirst.join(", ")} waits for the Human`
        : "no landing waits for the Human";
    const rules = next.riskRules ? `${next.riskRules.length} risk rules of its own` : "the kit's risk rules";
    return ok(
      `Base ${next.base ?? "unset"}; gate ${next.gate || "none"}, run per ${next.gateOn}; gate timeout ${next.gateTimeoutMinutes} minutes; lanes land as ${next.landAs}; ${home}; ${asked}; ${rules}.`,
    );
  },
});
