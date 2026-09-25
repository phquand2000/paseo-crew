import type { PendingPermission, PermissionResponse, SeatView } from "./paseo.ts";

export type { SeatView };

export type SeatLook = {
  id: string;
  provider?: string;
  title?: string | null;
  cwd?: string | null;
  status?: string | null;
  archivedAt?: string | null;
  pendingPermissions?: PendingPermission[];
};

export type SeatSpec = {
  config: Record<string, unknown>;
  parent?: string;
  title: string;
  prompt: string;
  labels: Record<string, string>;
};

/** One timeline entry, whole: `seqStart` is its first source row and `seq` its last, so one read back after a gap can restate rows already told. */
export type StreamRow = { item: Record<string, unknown>; seqStart: number; seq: number; epoch: string; turnId: string | null; replay: boolean };

/** `idle`: when the seat was last read it was in no turn, so a turn whose end went unseen is over; `lost`: the stream failed and stopped. */
export type Seen =
  | { kind: "row"; row: StreamRow }
  | { kind: "turn"; phase: "started" | "completed" | "failed" | "canceled"; turnId: string | null; error?: string; at?: number }
  | { kind: "idle" }
  | { kind: "reset" }
  | { kind: "lost"; error: string };

export type Stream = { readonly ready: Promise<void>; stop(): void };

export type Seats = {
  open(): Promise<SeatView[]>;
  look(id: string): Promise<SeatLook>;
  /** Into a running turn only as `into` says: steered in beside it, or the turn cut short for it. */
  send(id: string, text: string, kinds: string[], into?: "steer" | "interrupt"): Promise<void>;
  /** The last `limit` entries of the seat's history, whole, as Paseo projects them; an archived seat is started again to read it. */
  history(id: string, limit: number): Promise<StreamRow[]>;
  respond(id: string, requestId: string, response: PermissionResponse): Promise<void>;
  archive(id: string): Promise<void>;
  watch(id: string, see: (seen: Seen) => void): Stream;
};

export type Workspace = { id: string; project: string };

export type Workspaces = {
  named(name: string): Promise<Workspace | undefined>;
  owned(prefix: string): Promise<{ id: string; name: string }[]>;
  make(title: string, path: string, project?: string): Promise<Workspace>;
  retitle(workspace: string, title: string): Promise<void>;
  seat(workspace: string, spec: SeatSpec): Promise<SeatLook>;
  archive(workspace: string): Promise<void>;
};

/** An agent as a Paseo hook names it, so far as the plugin reads it. */
export type HookAgent = { id: string; provider: string; cwd: string; title?: string | null };

/** A timeline item as the plugin reads it: its kind, and fields that are checked before they are trusted. */
export type TimelineItem = { readonly type: string; readonly text?: unknown; readonly status?: unknown; readonly error?: unknown; readonly name?: unknown; readonly detail?: unknown; readonly callId?: unknown };

export type TurnEnded = {
  agent: HookAgent;
  turnId: string | null;
  outcome: { kind: "completed" } | { kind: "failed"; error: { message: string } } | { kind: "canceled" };
  timeline: readonly TimelineItem[];
};

export type PermissionRequested = { agent: HookAgent; request: PendingPermission };

/** Creating an agent, so far as a seat's launch sets it; Paseo's request holds more, and the rest passes through unchanged. */
export type AgentConfig = {
  provider: string;
  cwd: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
  toolPolicy?: { preapproved: { kind: string; server: string; tool: string }[] };
  providerOptions?: Record<string, unknown>;
};

export type SessionOpen = { provider: string; cwd: string; env: Record<string, string> };

/** What the plugin does on each Paseo hook. */
export type HostHooks = {
  create(config: AgentConfig): AgentConfig;
  sessionOpen(request: SessionOpen): SessionOpen;
  turnStarted(agent: HookAgent): Promise<void>;
  turnEnded(event: TurnEnded): Promise<void>;
  permissionRequested(event: PermissionRequested): Promise<void>;
  created(agent: HookAgent): Promise<void>;
  archived(agent: HookAgent): Promise<void>;
};

/** An agent's models as Paseo lists them. */
export type ModelList = {
  models?: { id: string; label: string; isSelectable?: boolean; thinkingOptions?: { id: string; label: string }[]; defaultThinkingOptionId?: string }[];
  error?: string | null;
};

export type Models = {
  refresh(provider: string, cwd: string): Promise<void>;
  list(provider: string, cwd: string): Promise<ModelList>;
};

/** Paseo as the plugin reaches it; `connected` is false until a hook or a panel call has handed over its API. */
export type Host = { connected(): boolean; seats: Seats; workspaces: Workspaces; models: Models };

/** A question as the watch's catalog words it, the fields the code fills filled: a noul is one condition, a choice picks one of its criteria. */
export type Question = { type: "noul" | "choice"; instructions: string | Record<string, string>; criteria: Record<string, string> };

/** A noul's answer is how likely its condition holds, from 0 to 1; a choice's, the pick and how sure of it. */
export type Answer = { noul: number } | { choice: string; confidence: number };

/** Each question's answer; the model that answered, the input it read where it says, and a seat's reason for each answer. */
export type Judgement = { answers: Record<string, Answer>; model: string; tokens?: number; why?: Record<string, string> };

/** Whatever answers the watch's questions about one moment of the record. */
export type Judge = { ask(state: Record<string, unknown>, questions: Record<string, Question>): Promise<Judgement> };
