import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kit, can, seatOf } from "../catalog/kit.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, activeTasks, loadLedger, openAsksFrom } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import { loadWatching, pending, reported, saveWatching } from "../desk/watching.ts";
import type { Outbox } from "./outbox.ts";
import type { TeamSource } from "./team-source.ts";
import type { TurnRules } from "./turns.ts";

type SeatMap = Map<string, SeatView>;

export type PatrolDeps = {
  kit: Kit;
  source: TeamSource;
  desk: Desk;
  seats: Seats;
  outbox: Outbox;
  turns: TurnRules;
  remember: (project: Project) => void;
};

export class Patrol {
  private readonly deps: PatrolDeps;
  private readonly idleFlag = new Map<string, string>();
  private readonly goneFlag = new Set<string>();

  constructor(deps: PatrolDeps) {
    this.deps = deps;
  }

  async tick(now = Date.now()): Promise<void> {
    const { kit, desk, outbox } = this.deps;
    const seats: SeatMap = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    for (const seat of seats.values()) if (seatOf(kit, seat.provider)?.role.tools) this.deps.remember(projectOf(seat.cwd));
    for (const project of desk.projects.values()) {
      await this.seatWatcher(project, loadLedger(project.state), seats);
      await this.idleLanes(project, loadLedger(project.state), seats, now);
      await this.goneTasks(project, loadLedger(project.state), seats);
      await this.dueAsks(project, loadLedger(project.state), seats, now);
      await this.sendDigest(project, now);
      await this.sweep(project, loadLedger(project.state), seats);
      this.writeStatus(project, seats, now);
    }
    const targets = new Set(outbox.letters().map((letter) => letter.to));
    for (const to of targets) await outbox.pump(to);
  }

  private async seatWatcher(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    try {
      if (Object.values(ledger.lanes).some((lane) => lane.status === "open")) {
        await this.deps.desk.ensureWatcher(project, seats.values());
        return;
      }
      await this.deps.desk.retireWatcher(project, seats.values());
    } catch (error) {
      console.error(`seatworks-v2: the Watcher on ${project.slug} could not be settled:`, error);
    }
  }

  private async sweep(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const busy =
      Object.values(ledger.lanes).some((lane) => lane.status === "open") ||
      [...seats.values()].some((seat) => seatOf(this.deps.kit, seat.provider)?.role.tools && projectOf(seat.cwd).slug === project.slug);
    try {
      await this.deps.desk.sweep(project, ledger, busy);
    } catch (error) {
      console.error(`seatworks-v2: sweeping ${project.slug} failed:`, error);
    }
  }

  private async idleLanes(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk, turns } = this.deps;
    const { leadIdleMinutes } = this.deps.source.teamFor().attention;
    for (const lane of Object.values(ledger.lanes).filter((entry) => entry.status === "open" && entry.lead)) {
      const lead = seats.get(lane.lead!);
      if (!lead || lead.status !== "idle") continue;
      const idle = now - Date.parse(lead.updatedAt);
      if (idle < leadIdleMinutes * 60_000 || this.idleFlag.get(lead.id) === lead.updatedAt) continue;
      if (activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, lead.id).length > 0) continue;
      this.idleFlag.set(lead.id, lead.updatedAt);
      const to = await desk.supervisorFor(project, lane.opener);
      await desk.post(to, `idle:${lane.id}:${lead.updatedAt}`, letters.laneIdle(lane, Math.round(idle / 60_000), turns.lastEnding.get(lead.id) ?? ""));
    }
  }

  private async goneTasks(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const { desk } = this.deps;
    for (const task of Object.values(ledger.tasks).filter((entry) => ["running", "rework"].includes(entry.status) && entry.peer)) {
      if (seats.has(task.peer!) || this.goneFlag.has(task.id)) continue;
      this.goneFlag.add(task.id);
      await desk.setTask(project, task.id, (entry) => {
        entry.status = "stalled";
      });
      await desk.post(ledger.lanes[task.lane]?.lead, `gone:${task.id}`, letters.failed(`the Peer on ${task.id} (${task.title})`, "its agent was closed or archived"));
    }
  }

  private async dueAsks(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk } = this.deps;
    const { askRemindMinutes, maxReminders } = this.deps.source.teamFor().attention;
    const due = Object.values(ledger.asks).filter(
      (ask) => ask.status === "open" && seats.get(ask.to)?.status === "idle" && now - (ask.remindedAt ?? ask.openedAt) >= askRemindMinutes * 60_000,
    );
    for (const ask of due) {
      const age = Math.round((now - ask.openedAt) / 60_000);
      if (ask.reminders < maxReminders) {
        await desk.post(ask.to, `remind:${ask.id}:${ask.reminders}`, letters.reminder(ask, age));
      } else if (ask.fromRole !== "lead" && !ask.escalated) {
        const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
        const to = await desk.supervisorFor(project, lane?.opener);
        await desk.post(to, `escalate:${ask.id}`, letters.escalated(ask, age, ask.lane ?? "the project"));
      } else continue;
      await desk.ledger(project, (current) => {
        const entry = current.asks[ask.id];
        if (!entry) return;
        if (entry.reminders < maxReminders) entry.reminders += 1;
        else entry.escalated = true;
        entry.remindedAt = now;
      });
    }
  }

  private async sendDigest(project: Project, now: number): Promise<void> {
    const { desk } = this.deps;
    const { digestMinutes } = this.deps.source.teamFor().attention;
    try {
      const watching = loadWatching(project.state);
      const waiting = pending(watching);
      if (waiting.length === 0) return;
      const oldest = Math.min(...waiting.map((strike) => strike.first));
      if (now - oldest < digestMinutes * 60_000) return;
      const to = await desk.supervisorFor(project);
      if (!to) return;
      await desk.post(to, `digest:${project.slug}:${oldest}`, letters.digest(waiting, Math.round((now - oldest) / 60_000)));
      saveWatching(project.state, reported(watching, now));
      desk.event(project, { kind: "watch.digest", items: waiting.length });
    } catch (error) {
      console.error(`seatworks-v2: the report for ${project.slug} could not be sent:`, error);
    }
  }

  private writeStatus(project: Project, seats: SeatMap, now: number): void {
    const { kit } = this.deps;
    try {
      const waiting = [...seats.values()].filter(
        (seat) => can(seatOf(kit, seat.provider)?.role, "supervise") && projectOf(seat.cwd).slug === project.slug && (seat.pendingPermissions?.length ?? 0) > 0,
      );
      mkdirSync(project.state, { recursive: true });
      const held = this.deps.outbox.letters(now);
      writeFileSync(join(project.state, "status.md"), statusText(project, loadLedger(project.state), loadConfig(project.state), seats, now, undefined, waiting, held));
    } catch (error) {
      console.error("seatworks-v2: status write failed:", error);
    }
  }
}
