import type { TestContext } from "node:test";
import type { HookAgent } from "../../server/core/ports.ts";
import { type Incident, loadIncidents } from "../../server/desk/incidents.ts";
import type { Noticed } from "../../server/desk/notice.ts";
import type { Project } from "../../server/desk/project.ts";
import type { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

/** An agent as Paseo's hooks name it. */
export function hookAgent(h: Harness, id: string): HookAgent {
  const agent = h.agents.get(id)!;
  return { id, provider: agent.provider, cwd: agent.cwd, title: agent.title };
}

/** What the watch hands the desk about `seat`: one finding of `kind`, as `Desk.notice` takes it. */
export function notice(
  h: Harness,
  seat: string | Noticed,
  kind: string,
  level: "attend" | "page" = "attend",
  quote = `${kind} seen`,
  project: Project = h.project,
) {
  const noticed = typeof seat === "string" ? { id: seat, provider: h.agents.get(seat)!.provider, title: seat } : seat;
  return h.runtime.desk.notice(project, noticed, [{ kind, level, quote, facts: [kind] }]);
}

/** The incident book as it is kept on disk. */
export const book = (h: Harness, project: Project = h.project): Record<string, Incident> =>
  loadIncidents(project.state).items;

/** Every notice the watch has handed the desk since this was called, each awaited to its end. */
export function noticesOf(h: Harness, t: TestContext): () => Promise<void> {
  const spy = t.mock.method(h.runtime.desk, "notice");
  return async () => {
    await Promise.all(spy.mock.calls.flatMap((call) => call.result ?? []));
  };
}
