import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "./hooks.ts";

export type FakeAgent = {
  id: string;
  provider: string;
  cwd: string;
  status: string;
  updatedAt: string;
  archivedAt: string | null;
  pendingPermissions: { id: string }[];
};

type Hook = (...args: never[]) => unknown;

export function fakeAgent(id: string, provider: string, cwd: string, extra: Partial<FakeAgent> = {}): FakeAgent {
  return { id, provider, cwd, status: "idle", updatedAt: new Date().toISOString(), archivedAt: null, pendingPermissions: [], ...extra };
}

export function fakePaseo(agents: FakeAgent[]) {
  const sent: { id: string; text: string }[] = [];
  const archived: string[] = [];
  const paseo = {
    agents: {
      list: async () => ({ entries: agents.filter((agent) => !agent.archivedAt).map((agent) => ({ agent })) }),
      ref: (id: string) => {
        const handle = {
          status: null as string | null,
          pendingPermissions: null as { id: string }[] | null,
          archivedAt: null as string | null,
          async refresh() {
            const agent = agents.find((entry) => entry.id === id);
            handle.status = agent?.status ?? null;
            handle.pendingPermissions = agent?.pendingPermissions ?? [];
            handle.archivedAt = agent?.archivedAt ?? null;
          },
          current() {
            return agents.find((entry) => entry.id === id) ?? null;
          },
          async send(text: string) {
            sent.push({ id, text });
          },
          async archive() {
            archived.push(id);
          },
        };
        return handle;
      },
    },
  } as unknown as PaseoApi;
  return { paseo, sent, archived };
}

export function fakeServer() {
  const ons = new Map<string, Hook[]>();
  const befores = new Map<string, Hook[]>();
  const add = (map: Map<string, Hook[]>, name: string, hook: Hook) => {
    map.set(name, [...(map.get(name) ?? []), hook]);
    return () => undefined;
  };
  const server = {
    on: (name: string, hook: Hook) => add(ons, name, hook),
    before: (name: string, hook: Hook) => add(befores, name, hook),
    handle: () => undefined,
    registerProvider: () => undefined,
    registerSettings: () => undefined,
  } as unknown as PluginServerContext;
  const context = (paseo: PaseoApi) => ({ paseo, signal: new AbortController().signal });
  return {
    server,
    async emit(name: string, event: unknown, paseo: PaseoApi) {
      for (const hook of ons.get(name) ?? []) await (hook as (event: unknown, context: unknown) => unknown)(event, context(paseo));
    },
    request(name: string, request: unknown, paseo: PaseoApi) {
      let current = request;
      for (const hook of befores.get(name) ?? []) {
        current = (hook as (input: unknown, context: unknown) => unknown)({ request: current }, context(paseo)) ?? current;
      }
      return current;
    },
  };
}
