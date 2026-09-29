import { existsSync, readFileSync } from "node:fs";
import { getPath } from "../../core/json.ts";
import { paseoConfigPath } from "../../core/paths.ts";
import type { HarnessSpec } from "../kit/kit.ts";

/** A seat's agent runs as the Paseo provider its harness extends runs it: the daemon's own PATH may not find the bare name. */
export function agentBin(harness: HarnessSpec, configPath = paseoConfigPath()): string | undefined {
  const name = harness.provider.env?.CREW_AGENT_BIN;
  if (!name || !existsSync(configPath)) return name;
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
  const command = getPath(config, ["agents", "providers", harness.baseProvider, "command"]);
  return Array.isArray(command) && typeof command[0] === "string" && command[0] ? command[0] : name;
}
