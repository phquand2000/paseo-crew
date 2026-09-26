import { FakeTimeline } from "./fake-timeline.ts";

export type Pending = { id: string; kind: string; name: string; title?: string; input?: Record<string, unknown> };
type Fake = {
  id: string;
  provider: string;
  cwd: string;
  title: string;
  status: string;
  archivedAt: string | null;
  updatedAt: string;
  sent: string[];
  sentIds: string[];
  steered: string[];
  interrupted: string[];
  pending: Pending[];
  answered: {
    requestId: string;
    response: { behavior: string; updatedInput?: { answers?: Record<string, string> } };
  }[];
  prompt?: string;
  promptId?: string;
  labels: Record<string, string>;
  workspaceId?: string;
};

/** Paseo as the harness runs it: its agents, workspaces and timelines in memory, answering as the daemon would. */
export function fakePaseo() {
  const agents = new Map<string, Fake>();
  const workspaces = new Map<string, string>();
  const workspaceNames = new Map<string, string>();
  const workspaceProjects = new Map<string, string>();
  const archivedWorkspaces = new Set<string>();
  const timelines = new Map<string, InstanceType<typeof FakeTimeline>>();
  const timelineOf = (id: string) => {
    const found = timelines.get(id) ?? new FakeTimeline();
    timelines.set(id, found);
    return found;
  };
  let count = 0;
  const ref = (id: string) => {
    const agent = agents.get(id);
    return {
      id,
      timeline: timelineOf(id),
      get status() {
        return agent?.status ?? null;
      },
      get cwd() {
        return agent?.cwd ?? null;
      },
      get archivedAt() {
        return agent?.archivedAt ?? null;
      },
      get pendingPermissions() {
        return agent?.pending ?? [];
      },
      async refresh() {},
      current() {
        return agent ? { id: agent.id, provider: agent.provider, cwd: agent.cwd, title: agent.title } : null;
      },
      async send(text: string, options?: { activeTurnBehavior?: string; messageId?: string }) {
        agent?.sent.push(text);
        if (options?.messageId) agent?.sentIds.push(options.messageId);
        if (options?.activeTurnBehavior === "steer") agent?.steered.push(text);
        if (options?.activeTurnBehavior === "interrupt") agent?.interrupted.push(text);
      },
      async respondToPermission({ requestId, response }: Fake["answered"][number]) {
        const at = agent?.pending.findIndex((request) => request.id === requestId) ?? -1;
        if (!agent || at < 0) throw new Error(`No pending permission request with id '${requestId}'`);
        agent.pending.splice(at, 1);
        agent.answered.push({ requestId, response });
      },
      async archive() {
        archiveWithChildren(id);
      },
    };
  };
  // Paseo 0.9.2 archives an agent's children with it, and theirs (live probe, v3 LEDGER D79).
  const archiveWithChildren = (id: string): void => {
    const agent = agents.get(id);
    if (!agent || agent.archivedAt) return;
    Object.assign(agent, { archivedAt: new Date().toISOString(), status: "closed" });
    for (const child of agents.values())
      if (child.labels["paseo.parent-agent-id"] === id) archiveWithChildren(child.id);
  };
  const add = (
    provider: string,
    cwd: string,
    title: string,
    status = "idle",
    prompt?: string,
    labels: Record<string, string> = {},
  ) => {
    const id = `agent-${++count}`;
    agents.set(id, {
      id,
      provider,
      cwd,
      title,
      status,
      archivedAt: null,
      updatedAt: new Date().toISOString(),
      sent: [],
      sentIds: [],
      steered: [],
      interrupted: [],
      pending: [],
      answered: [],
      prompt,
      labels,
    });
    return id;
  };
  const workspace = (id: string) => ({
    id,
    projectId: workspaceProjects.get(id) ?? null,
    async setTitle(title: string) {
      workspaceNames.set(id, title);
      return { title };
    },
    agents: {
      async create(options: {
        config: { provider: string };
        parent?: string;
        title: string;
        prompt: string;
        clientMessageId?: string;
        labels?: Record<string, string>;
      }) {
        // Paseo keeps an agent's parent as this label, and never pushes an agent that has one.
        const labels = { ...options.labels, ...(options.parent ? { "paseo.parent-agent-id": options.parent } : {}) };
        const made = add(
          options.config.provider,
          workspaces.get(id)!,
          options.title,
          "running",
          options.prompt,
          labels,
        );
        Object.assign(agents.get(made)!, { promptId: options.clientMessageId, workspaceId: id });
        return ref(made);
      },
    },
  });
  const paseo = {
    agents: {
      ref,
      // The daemon caps a page at 200 rows and reports the rest through pageInfo, so the fake does too.
      async list(options?: { page?: { limit?: number; cursor?: string } }) {
        const all = [...agents.values()].map((agent) => ({ agent: { ...agent, pendingPermissions: agent.pending } }));
        const from = Number(options?.page?.cursor ?? 0);
        const limit = options?.page?.limit ?? 200;
        const next = from + limit;
        return {
          entries: all.slice(from, next),
          pageInfo: {
            hasMore: next < all.length,
            nextCursor: next < all.length ? String(next) : null,
            prevCursor: null,
          },
        };
      },
    },
    workspaces: {
      // The daemon files a directory under the given project, or makes one of the directory when given none.
      async create({ title, source }: { title?: string; source: { path: string; projectId?: string } }) {
        const id = `ws-${workspaces.size + 1}`;
        workspaces.set(id, source.path);
        workspaceProjects.set(id, source.projectId ?? `prj:${source.path}`);
        if (title) workspaceNames.set(id, title);
        return workspace(id);
      },
      async list() {
        return {
          entries: [...workspaces.keys()].map((id) => ({
            id,
            projectId: workspaceProjects.get(id)!,
            name: workspaceNames.get(id) ?? "",
            archivingAt: archivedWorkspaces.has(id) ? new Date().toISOString() : null,
          })),
          pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
        };
      },
      // The daemon archives every agent a workspace owns with it (workspace-archive-service.js, archiveWorkspaceContents).
      async archive(id: string) {
        const workspaceId = typeof id === "string" ? id : (id as { id: string }).id;
        archivedWorkspaces.add(workspaceId);
        for (const agent of agents.values()) if (agent.workspaceId === workspaceId) archiveWithChildren(agent.id);
        return { archivedAt: new Date().toISOString() };
      },
      ref: workspace,
    },
  };
  return {
    paseo: paseo as never,
    agents,
    add,
    workspaces,
    workspaceNames,
    workspaceProjects,
    archivedWorkspaces,
    timelineOf,
  };
}
