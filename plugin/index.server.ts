import type { PluginServerContext } from "@getpaseo/plugin/server";
import { onTurnEnded, stopTimers } from "./server/attention";
import { loadKit } from "./server/kit";
import { applyProfile, checkParent } from "./server/launch";

export default function contribute(server: PluginServerContext) {
  server.before("agent.create", ({ request }) => {
    const kit = loadKit();
    return kit ? { ...request, config: applyProfile(kit, request.config) } : request;
  });

  server.on("agent.created", async (event, { paseo }) => {
    const kit = loadKit();
    if (kit) await checkParent(paseo, kit, event.agent);
  });

  server.on("agent.turn_ended", async (event, { paseo }) => {
    const kit = loadKit();
    if (kit) await onTurnEnded(paseo, kit, event);
  });

  return () => stopTimers();
}
