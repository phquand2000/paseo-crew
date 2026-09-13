import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { type Kit, expandHome, projectOf, projectRoot, seatFor } from "./kit";

type SessionOpen = PluginBeforeRequests["agent.session_open"];

export function seatEnv(kit: Kit, request: SessionOpen): SessionOpen {
  const seat = seatFor(kit, request.provider);
  if (!seat) return request;
  const live = request.purpose === "interactive";
  const root = projectRoot(request.cwd);
  if (!root) {
    if (!live) return request;
    throw new Error(`a ${seat.role} runs only inside a project that has .seatworks/, and ${request.cwd} has none.`);
  }
  const harness = kit.harnesses[seat.harness] ?? {};
  const { slug } = projectOf(root);
  const name = `${seat.role}-${slug}`;
  const env: Record<string, string> = { SEATWORKS_REPO: root, SEATWORKS_SLUG: slug, SEATWORKS_SEAT: name };
  if (harness.profileRoot && harness.configDirEnv) {
    const dir = join(expandHome(harness.profileRoot), name);
    if (!existsSync(dir)) {
      if (!live) return request;
      throw new Error(
        `${dir} does not exist, so this ${seat.role} would start without its prompt, skills and settings. Run setup/add-project.fish ${root} first.`,
      );
    }
    env[harness.configDirEnv] = dir;
  }
  return { ...request, env: { ...request.env, ...env } };
}
