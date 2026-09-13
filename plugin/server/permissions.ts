import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { logLine } from "./attention";
import { type Kit, projectRoot, seatFor } from "./kit";

type Requested = PluginLifecycleEvents["agent.permission_requested"];
type Resolved = PluginLifecycleEvents["agent.permission_resolved"];

const asked = new Map<string, { root: string; fields: string }>();

function skillOf(request: Requested["request"]): string | undefined {
  if (request.name !== "Skill") return undefined;
  const skill = (request.input as { skill?: unknown } | undefined)?.skill;
  return typeof skill === "string" ? skill : undefined;
}

export function onPermissionRequested(kit: Kit, event: Requested): void {
  const skill = skillOf(event.request);
  const seat = seatFor(kit, event.agent.provider);
  const root = projectRoot(event.agent.cwd);
  if (!skill || !seat || !root) return;
  const fields = `${event.agent.id} (${seat.role})  skill ${skill}`;
  asked.set(event.request.id, { root, fields });
  logLine(root, `${fields}  -> asked`);
}

export function onPermissionResolved(event: Resolved): void {
  const entry = asked.get(event.requestId);
  if (!entry) return;
  asked.delete(event.requestId);
  const resolution = event.resolution;
  const said = resolution.behavior === "deny" && resolution.message ? `  "${resolution.message.slice(0, 160)}"` : "";
  logLine(entry.root, `${entry.fields}  -> ${resolution.behavior === "allow" ? "allowed" : "denied"}${said}`);
}
