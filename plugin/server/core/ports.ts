import type { SeatView } from "./paseo.ts";

export type { SeatView };

export type SeatLook = {
  id: string;
  provider?: string;
  title?: string | null;
  cwd?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  pendingPermissions?: { title?: string; name?: string }[];
};

export type SeatSpec = {
  config: Record<string, unknown>;
  parent?: string;
  title: string;
  prompt: string;
  labels: Record<string, string>;
};

export type Seats = {
  open(): Promise<SeatView[]>;
  look(id: string): Promise<SeatLook>;
  send(id: string, text: string): Promise<void>;
  archive(id: string): Promise<void>;
};

export type Workspaces = {
  named(name: string): Promise<string | undefined>;
  make(title: string, path: string): Promise<string>;
  seat(workspace: string, spec: SeatSpec): Promise<SeatLook>;
};
