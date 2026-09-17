import type { PaseoApi, SeatView } from "./paseo.ts";
import type { SeatLook, SeatSpec, Seats, Workspaces } from "./ports.ts";

export type Bound = () => PaseoApi | undefined;

type Handle = {
  id: string;
  status?: string | null;
  cwd?: string | null;
  archivedAt?: string | null;
  pendingPermissions?: { title?: string; name?: string }[];
  refresh(): Promise<unknown>;
  current(): { id?: string; provider?: string; cwd?: string | null; title?: string | null } | null | undefined;
  send(text: string): Promise<unknown>;
  archive(): Promise<unknown>;
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

export function seatsOn(bound: Bound): Seats {
  const ref = (id: string): Handle => reach(bound).agents.ref(id) as unknown as Handle;
  return {
    /**
     * Every seat that is open, paged the way the workspaces beside it are paged.
     *
     * An unpaged read is capped by the daemon and sorted by last activity, and this list is read as
     * the whole roster: a seat missing from it is taken as gone, its task is marked stalled, its Lead
     * is told its Peer was closed, and a working copy it is still writing in is torn down. Past the
     * cap the seats that fall off are the quietest ones, which is exactly a Peer thinking.
     */
    async open(): Promise<SeatView[]> {
      const paseo = bound();
      if (!paseo) return [];
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
    },
    async look(id: string): Promise<SeatLook> {
      const handle = ref(id);
      await handle.refresh();
      return lookOf(handle);
    },
    async send(id: string, text: string): Promise<void> {
      await ref(id).send(text);
    },
    async archive(id: string): Promise<void> {
      await ref(id).archive();
    },
  };
}

export function workspacesOn(bound: Bound): Workspaces {
  return {
    async named(name: string): Promise<string | undefined> {
      const paseo = reach(bound);
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await paseo.workspaces.list({ page: cursor ? { limit: 200, cursor } : { limit: 200 } });
        for (const entry of result.entries) {
          if (entry.name === name && !entry.archivingAt) return entry.id;
        }
        if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) return undefined;
        cursor = result.pageInfo.nextCursor;
      }
      return undefined;
    },
    async owned(prefix: string): Promise<{ id: string; name: string }[]> {
      const paseo = bound();
      if (!paseo) return [];
      const found: { id: string; name: string }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await paseo.workspaces.list({ page: cursor ? { limit: 200, cursor } : { limit: 200 } });
        for (const entry of result.entries) {
          const name = entry.name ?? "";
          if (!entry.archivingAt && (name === prefix || name.startsWith(`${prefix} `))) found.push({ id: entry.id, name });
        }
        if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
        cursor = result.pageInfo.nextCursor;
      }
      return found;
    },
    async make(title: string, path: string): Promise<string> {
      const workspace = await reach(bound).workspaces.create({ title, source: { kind: "directory", path } });
      return workspace.id;
    },
    async archive(workspace: string): Promise<void> {
      await reach(bound).workspaces.archive(workspace);
    },
    async seat(workspace: string, spec: SeatSpec): Promise<SeatLook> {
      const handle = (await reach(bound)
        .workspaces.ref(workspace)
        .agents.create({
          config: spec.config as never,
          parent: spec.parent,
          title: spec.title.slice(0, 60),
          prompt: spec.prompt,
          labels: spec.labels,
        })) as unknown as Handle;
      await handle.refresh();
      return lookOf(handle);
    },
  };
}
