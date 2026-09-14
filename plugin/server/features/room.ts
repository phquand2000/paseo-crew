import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginBeforeRequests, PluginServerContext } from "@getpaseo/plugin/server";
import { type Kit, type Project, expandHome, projectAt, projectRoot, seatFor } from "../kit.ts";
import { refusal } from "../messages.ts";
import type { Runtime } from "../runtime.ts";

type SessionOpen = PluginBeforeRequests["agent.session_open"];

export function seatEnv(
  kit: Kit,
  request: SessionOpen,
  project: Project | undefined,
  exists: (path: string) => boolean = existsSync,
): SessionOpen {
  const seat = seatFor(kit, request.provider);
  if (!seat) return request;
  const live = request.purpose === "interactive";
  if (!project) {
    if (!live) return request;
    throw new Error(refusal.sessionOutsideProject(seat.role, request.cwd));
  }
  const harness = kit.harnesses[seat.harness] ?? {};
  const name = `${seat.role}-${project.slug}`;
  const env: Record<string, string> = { SEATWORKS_REPO: project.root, SEATWORKS_SLUG: project.slug, SEATWORKS_SEAT: name };
  if (harness.profileRoot && harness.configDirEnv) {
    const dir = join(expandHome(harness.profileRoot), name);
    if (!exists(dir)) {
      if (!live) return request;
      throw new Error(refusal.seatMissing(dir, seat.role, project.root));
    }
    env[harness.configDirEnv] = dir;
  }
  return { ...request, env: { ...request.env, ...env } };
}

export function register(server: PluginServerContext, runtime: Runtime): void {
  server.before("agent.session_open", ({ request }) => {
    const kit = runtime.kit();
    if (!kit) return request;
    const root = projectRoot(request.cwd);
    return seatEnv(kit, request, root ? projectAt(root) : undefined);
  });
}
