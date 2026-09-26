export type SeatView = {
  id: string;
  title?: string | null;
  provider: string;
  cwd: string;
  status: string;
  updatedAt: string;
  createdAt?: string;
  archivedAt?: string | null;
  labels?: Record<string, string>;
  pendingPermissions?: PendingPermission[];
};

/** Whether a seat is in a turn; one still starting is, since its first turn is already under way. */
export function midTurn(status: string | null | undefined): boolean {
  return status === "running" || status === "initializing";
}

export type PendingPermission = { id?: string; kind?: string; name?: string; title?: string; description?: string; input?: Record<string, unknown> };

export type PermissionResponse = { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message?: string };
