import type { PluginHookContext } from "@getpaseo/plugin/server";
import type { PendingPermission, PermissionResponse, SeatView } from "../../core/paseo.ts";
import type { SeatLook, SeatSpec, Seats, Workspace, Workspaces } from "../../core/ports.ts";
import { deskId } from "../../core/sent-by.ts";
import { type TimelineHandle, follow } from "../../core/stream.ts";

export type PaseoApi = PluginHookContext["paseo"];

type Bound = () => PaseoApi | undefined;

type Handle = {
  id: string;
  status?: string | null;
  cwd?: string | null;
  archivedAt?: string | null;
  pendingPermissions?: PendingPermission[];
  refresh(): Promise<unknown>;
  current(): { id?: string; provider?: string; cwd?: string | null; title?: string | null } | null | undefined;
  send(text: string, options?: { messageId?: string; activeTurnBehavior?: "steer" | "interrupt" }): Promise<unknown>;
  respondToPermission(options: { requestId: string; response: PermissionResponse }): Promise<unknown>;
  archive(): Promise<unknown>;
  timeline: TimelineHandle;
};

const reach = (bound: Bound): PaseoApi => {
  const paseo = bound();
  if (!paseo) throw new Error("the daemon has not reached this plugin yet");
  return paseo;
};

function lookOf(handle: Handle): SeatLook {
  const snapshot = handle.current();
  return {
    id: handle.id,
    provider: snapshot?.provider,
    title: snapshot?.title ?? null,
    cwd: handle.cwd ?? snapshot?.cwd ?? null,
    status: handle.status ?? null,
    archivedAt: handle.archivedAt ?? null,
    pendingPermissions: handle.pendingPermissions ?? [],
  };
}

/** Paged: an unpaged read is capped by the daemon, and a seat missing from this list is treated as gone, so with no handle it fails. */
async function openSeats(bound: Bound): Promise<SeatView[]> {
  const paseo = reach(bound);
  const found: SeatView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await paseo.agents.list({ filter: { includeArchived: false }, page: cursor ? { limit: 200, cursor } : { limit: 200 } });
    for (const entry of result.entries) {
      const seat = entry.agent as unknown as SeatView;
      if (!seat.archivedAt) found.push(seat);
    }
    if (!result.pageInfo?.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return found;
}

export function seatsOn(bound: Bound): Seats {
  const ref = (id: string): Handle => reach(bound).agents.ref(id) as unknown as Handle;
  return {
    open: () => openSeats(bound),
    async look(id: string): Promise<SeatLook> {
      const handle = ref(id);
      await handle.refresh();
      return lookOf(handle);
    },
    async send(id: string, text: string, kinds: string[], into?: "steer" | "interrupt"): Promise<void> {
      // The daemon takes `activeTurnBehavior` though the SDK's type leaves it out; the id is how `typed` and `sentBy` know the desk sent it.
      await ref(id).send(text, { messageId: deskId(kinds), ...(into ? { activeTurnBehavior: into } : {}) });
    },
    async history(id: string, limit: number) {
      const page = await ref(id).timeline.refetch({ direction: "tail", limit });
      return page.entries.map(({ item, seqStart, seqEnd, turnId }) => ({ item, seqStart, seq: seqEnd, epoch: page.epoch, turnId: turnId ?? null, replay: true }));
    },
    async respond(id: string, requestId: string, response: PermissionResponse): Promise<void> {
      await ref(id).respondToPermission({ requestId, response });
    },
    async archive(id: string): Promise<void> {
      await ref(id).archive();
    },
    watch(id, see) {
      const handle = ref(id);
      return follow(handle.timeline, see, {
        // A failed lookup reads as not archived: a seat stopped on a passing failure is never followed again.
        archived: async () => {
          try {
            await handle.refresh();
          } catch {
            return false;
          }
          return Boolean(handle.archivedAt);
        },
      });
    },
  };
}

/** Every workspace the daemon lists that is not being archived, page by page: an unpaged read is capped by the daemon. */
async function liveWorkspaces(bound: Bound): Promise<{ id: string; name: string; project: string }[]> {
  const paseo = reach(bound);
  const found: { id: string; name: string; project: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await paseo.workspaces.list({ page: cursor ? { limit: 200, cursor } : { limit: 200 } });
    for (const entry of result.entries) if (!entry.archivingAt) found.push({ id: entry.id, name: entry.name ?? "", project: entry.projectId });
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return found;
}

export function workspacesOn(bound: Bound): Workspaces {
  return {
    async named(name: string): Promise<Workspace | undefined> {
      const found = (await liveWorkspaces(bound)).find((entry) => entry.name === name);
      return found && { id: found.id, project: found.project };
    },
    async owned(prefix: string): Promise<{ id: string; name: string }[]> {
      return (await liveWorkspaces(bound)).filter(({ name }) => name === prefix || name.startsWith(`${prefix} `)).map(({ id, name }) => ({ id, name }));
    },
    async make(title: string, path: string, project?: string): Promise<Workspace> {
      const source = project ? { kind: "directory" as const, path, projectId: project } : { kind: "directory" as const, path };
      const workspace = await reach(bound).workspaces.create({ title, source });
      return { id: workspace.id, project: workspace.projectId ?? "" };
    },
    async retitle(workspace: string, title: string): Promise<void> {
      await reach(bound).workspaces.ref(workspace).setTitle(title);
    },
    async archive(workspace: string): Promise<void> {
      // The daemon reports a refusal as `error` in the payload, not as a throw.
      const result = (await reach(bound).workspaces.archive(workspace)) as { error?: string | null } | undefined;
      if (result?.error) throw new Error(result.error);
    },
    async seat(workspace: string, spec: SeatSpec): Promise<SeatLook> {
      const handle = (await reach(bound)
        .workspaces.ref(workspace)
        .agents.create({
          config: spec.config as never,
          parent: spec.parent,
          title: spec.title.slice(0, 60),
          prompt: spec.prompt,
          clientMessageId: deskId(["brief"]),
          labels: spec.labels,
        })) as unknown as Handle;
      await handle.refresh();
      return lookOf(handle);
    },
  };
}
