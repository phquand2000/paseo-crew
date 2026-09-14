import type { PluginBeforeRequests, PluginServerContext } from "@getpaseo/plugin/server";
import { on } from "../hooks.ts";
import { type Kit, projectRoot, roleOf, seatFor } from "../kit.ts";
import { archivedAtStart, logFields, refusal } from "../messages.ts";
import type { Project } from "../project.ts";
import type { Runtime } from "../runtime.ts";

type AgentConfig = PluginBeforeRequests["agent.create"]["config"];
type Placed = { provider: string; cwd: string };

export function applyProfile(kit: Kit, config: AgentConfig, project: Project | undefined): AgentConfig {
  const seat = seatFor(kit, config.provider);
  if (!seat) return config;
  if (!project) throw new Error(refusal.launchOutsideProject(seat.role, config.cwd));
  const profile = kit.profiles.find((entry) => entry.provider === seat.role);
  if (!profile) return config;
  const pinned = project.models[seat.role];
  const offered = [pinned, profile.model, ...(kit.providers[seat.role]?.models ?? []).map((model) => model.id)];
  const allowed = [...new Set(offered.filter((model): model is string => Boolean(model)))];
  const model = config.model ?? pinned ?? profile.model;
  if (model && allowed.length > 0 && !allowed.includes(model)) {
    throw new Error(refusal.modelNotOffered(seat.role, allowed));
  }
  return {
    ...config,
    model,
    modeId: profile.modeId ?? config.modeId,
    thinkingOptionId: config.thinkingOptionId ?? profile.thinkingOptionId,
  };
}

export function launchReasons(
  kit: Kit,
  agent: Placed,
  parent: Placed,
  rootOf: (cwd: string) => string | undefined = projectRoot,
): string[] {
  const parentSeat = seatFor(kit, parent.provider);
  if (!parentSeat || !seatFor(kit, agent.provider)) return [];
  const mayStart = parentSeat.mayStart ?? [];
  const reasons: string[] = [];
  if (!mayStart.includes(roleOf(agent.provider))) reasons.push(refusal.mayStart(parentSeat.role, mayStart));
  const home = rootOf(parent.cwd);
  if (home !== rootOf(agent.cwd)) reasons.push(refusal.otherProject(home ?? parent.cwd));
  return reasons;
}

export function register(server: PluginServerContext, runtime: Runtime): void {
  server.before("agent.create", ({ request }) => {
    const kit = runtime.kit();
    if (!kit) return request;
    const root = projectRoot(request.config.cwd);
    return { ...request, config: applyProfile(kit, request.config, root ? runtime.project(root) : undefined) };
  });

  on(server, "launch", "agent.created", async ({ agent }, { paseo }) => {
    const kit = runtime.kit();
    if (!kit || !agent.parentAgentId || !seatFor(kit, agent.provider)) return;
    const parent = paseo.agents.ref(agent.parentAgentId);
    await parent.refresh();
    const snapshot = parent.current();
    if (!snapshot) return;
    const reasons = launchReasons(kit, agent, snapshot);
    if (reasons.length === 0) return;
    await paseo.agents.ref(agent.id).archive();
    const role = roleOf(agent.provider);
    await runtime.post(paseo, {
      root: projectRoot(snapshot.cwd) ?? "",
      role: roleOf(snapshot.provider),
      agentId: snapshot.id,
      text: archivedAtStart(agent.id, role, reasons),
      fields: logFields(agent.id, role, "archived at start"),
    });
  });
}
