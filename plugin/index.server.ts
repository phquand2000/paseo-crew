import type { PluginServerContext } from "@getpaseo/plugin/server";
import { onTurnEnded, onTurnStarted, stopTimers } from "./server/attention";
import { loadKit } from "./server/kit";
import { applyProfile, checkParent } from "./server/launch";
import { onPermissionRequested, onPermissionResolved } from "./server/permissions";
import { seatEnv } from "./server/room";

export default function contribute(server: PluginServerContext) {
  server.before("agent.create", ({ request }) => {
    const kit = loadKit();
    return kit ? { ...request, config: applyProfile(kit, request.config) } : request;
  });

  server.before("agent.session_open", ({ request }) => {
    const kit = loadKit();
    return kit ? seatEnv(kit, request) : request;
  });

  server.on("agent.created", async (event, { paseo }) => {
    const kit = loadKit();
    if (kit) await checkParent(paseo, kit, event.agent);
  });

  server.on("agent.turn_started", (event) => onTurnStarted(event));

  server.on("agent.permission_requested", async (event, { paseo }) => {
    const kit = loadKit();
    if (kit) await onPermissionRequested(paseo, kit, event);
  });

  server.on("agent.permission_resolved", (event) => onPermissionResolved(event));

  server.on("agent.turn_ended", async (event, { paseo }) => {
    const kit = loadKit();
    if (kit) await onTurnEnded(paseo, kit, event);
  });

  return () => stopTimers();
}
