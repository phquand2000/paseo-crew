import { daemonLog } from "../../core/logger.ts";
import { errorText } from "../../core/errors.ts";
import type { Host } from "../../core/ports.ts";
import type { Desk } from "../../desk/desk.ts";
import type { Patrol } from "./patrol.ts";
import type { TeamSource } from "../team-source.ts";

/** Runs a patrol round each tick while Paseo is connected; the cadence is read every time, so a change takes hold without a reload. */
export class PatrolClock {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly offline = new Set<string>();
  private readonly deps: { host: Host; patrol: Patrol; source: TeamSource; desk: Desk };

  constructor(deps: { host: Host; patrol: Patrol; source: TeamSource; desk: Desk }) {
    this.deps = deps;
  }

  start(): void {
    const { host, patrol, source } = this.deps;
    const round = () => {
      if (host.connected())
        patrol.tick().then(
          () => this.offline.clear(),
          (error) => this.failed(error),
        );
      this.timer = setTimeout(round, Math.max(5, source.teamFor().attention.tickSeconds) * 1000);
    };
    this.timer = setTimeout(round, source.teamFor().attention.tickSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** A round that lost Paseo is recorded once per project, until a round goes through again. */
  private failed(error: unknown): void {
    daemonLog.error("tick failed:", error);
    if (!/not connected|client closed|transport/i.test(errorText(error))) return;
    for (const project of this.deps.desk.projects.values()) {
      if (this.offline.has(project.slug)) continue;
      this.offline.add(project.slug);
      this.deps.desk.event(project, { kind: "watch.offline", error: errorText(error) });
    }
  }
}
