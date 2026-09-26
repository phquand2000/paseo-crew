import type { RiskRule } from "../catalog/schema.ts";
import { configFault } from "../core/config-file.ts";
import { LAND_AS, branchExists } from "../core/git.ts";
import { type Caller, type ToolReply, no, ok, str, strs } from "./context.ts";
import { type LaneHome, type ProjectConfig, configFile, loadConfig, saveConfig } from "./project.ts";

/** A set_project call as the tool takes it: each field left out keeps what the project has. */
type Settings = {
  base?: string;
  gate?: string;
  gateTimeoutMinutes?: number;
  gateOn?: "lane" | "task";
  serialOnly?: string[];
  landAs?: "squash" | "merge" | "ff";
  laneHome?: LaneHome;
  askFirst?: string[];
  riskRules?: RiskRule[];
};

/** Sets the project's standing configuration, refusing as open_lane does over a file it could not read. */
export async function setProject(caller: Caller, args: Settings): Promise<ToolReply> {
  // Refused as open_lane refuses: read as all defaults, an unreadable file was saved over with them.
  const unreadable = configFault(configFile(caller.project.state));
  if (unreadable) return no(`${unreadable}\nOnly the Human can repair it or move it aside; nothing was saved over it.`);
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
}
