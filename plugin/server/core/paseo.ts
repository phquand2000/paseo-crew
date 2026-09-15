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

export async function openSeats(paseo: PaseoApi): Promise<SeatView[]> {
  const { entries } = await paseo.agents.list({ filter: { includeArchived: false } });
  return entries.map((entry) => entry.agent as unknown as SeatView).filter((seat) => !seat.archivedAt);
}
