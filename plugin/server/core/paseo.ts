import type { PluginHookContext } from "@getpaseo/plugin/server";

export type PaseoApi = PluginHookContext["paseo"];

export type SeatView = {
  id: string;
  title?: string | null;
  provider: string;
  cwd: string;
  status: string;
  updatedAt: string;
  archivedAt?: string | null;
  labels?: Record<string, string>;
  pendingPermissions?: { title?: string; name?: string }[];
};
