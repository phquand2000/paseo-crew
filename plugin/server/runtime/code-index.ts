import type { IndexedProxy } from "../catalog/team.ts";
import { callTool } from "../core/jsonrpc.ts";
import type { CodeIndex } from "../desk/context.ts";

type Route = NonNullable<NonNullable<IndexedProxy["open"]>["route"]>;

function withRoot(value: unknown, path: string): unknown {
  if (typeof value === "string") return value.replaceAll("{root}", path);
  if (Array.isArray(value)) return value.map((item) => withRoot(item, path));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withRoot(item, path)]));
  return value;
}

function routeOf(text: string, route: Route | undefined): string | undefined {
  if (!route || !new RegExp(route.when, "i").test(text)) return undefined;
  try {
    const list = (JSON.parse(text) as Record<string, unknown>)[route.from];
    if (!Array.isArray(list)) return undefined;
    const hit = (list as Record<string, unknown>[]).find((item) => typeof item?.[route.field] === "string");
    return hit?.[route.field] as string | undefined;
  } catch {
    return undefined;
  }
}

export function codeIndex(proxy: IndexedProxy): CodeIndex {
  const { url } = proxy.backend;
  const pinned = (path: string, args: Record<string, unknown> = {}) => (proxy.pin ? { ...args, [proxy.pin]: path } : args);
  return {
    id: proxy.id,
    gitExclude: proxy.gitExclude ?? [],
    async open(path) {
      const hook = proxy.open;
      if (!hook) return { ok: true, text: "nothing to open" };
      const args = withRoot(hook.args ?? pinned(path), path) as Record<string, unknown>;
      const timeoutMs = (hook.timeoutSeconds ?? 330) * 1000;
      const first = await callTool(url, hook.tool, args, timeoutMs);
      const route = routeOf(first.text, hook.route);
      return route ? callTool(url, hook.tool, pinned(route, args), timeoutMs) : first;
    },
    close(path) {
      const hook = proxy.close;
      if (!hook) return Promise.resolve({ ok: true, text: "nothing to close" });
      return callTool(url, hook.tool, withRoot(hook.args ?? pinned(path), path) as Record<string, unknown>, (hook.timeoutSeconds ?? 60) * 1000);
    },
    sync: (path) => (proxy.sync ? callTool(url, proxy.sync.tool, pinned(path), 60_000) : Promise.resolve({ ok: true, text: "nothing to sync" })),
  };
}
