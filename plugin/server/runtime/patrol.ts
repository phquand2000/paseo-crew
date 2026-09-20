import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kit, can, roleNamed, seatOf } from "../catalog/kit.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ask, type Ledger, activeTasks, loadLedger, openAsksFrom } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import type { Outbox } from "./outbox.ts";
import type { TeamSource } from "./team-source.ts";
import type { TurnRules } from "./turns.ts";
import { deskFacts } from "./watch/history.ts";
import { decide } from "./watch/rules.ts";
import type { Watches } from "./watch/watches.ts";

type SeatMap = Map<string, SeatView>;

export type PatrolDeps = {
  kit: Kit;
  source: TeamSource;
  desk: Desk;
  seats: Seats;
  outbox: Outbox;
  turns: TurnRules;
  watches: Watches;
  remember: (project: Project) => void;
};

export class Patrol {
  private readonly deps: PatrolDeps;
  private readonly idleFlag = new Map<string, string>();
  private readonly goneFlag = new Set<string>();
  // What a lane's history last showed, so a standing condition is reported when it changes and not
  // on every round for as long as it holds.
  private readonly historyFlag = new Map<string, string>();
  private reaped = false;
  private round: Promise<void> | undefined;

  constructor(deps: PatrolDeps) {
    this.deps = deps;
  }

  /**
   * One round at a time.
   *
   * The runtime arms the next timer on the line after starting this one, without awaiting it, so a
   * round that takes longer than the interval ran beside its successor. Both read the ledger, both
   * decided from what they read, and both wrote: an ask due a reminder was reminded twice and its
   * count went up by two, past the owner's maximum in one step.
   */
  tick(now = Date.now()): Promise<void> {
    const running = this.round;
    if (running) return running;
    const run = this.runRound(now).finally(() => {
      if (this.round === run) this.round = undefined;
    });
    this.round = run;
    return run;
  }

  private async runRound(now: number): Promise<void> {
    const { kit, desk, outbox } = this.deps;
    const seats: SeatMap = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    this.deps.watches.sync(seats.values());
    this.deps.watches.round(now, (watch) => this.deps.source.teamFor(projectOf(watch.seat.cwd)).attention.longTurnMinutes);
    for (const seat of seats.values()) if (seatOf(kit, seat.provider)?.role.tools) this.deps.remember(projectOf(seat.cwd));
    for (const project of desk.projects.values()) {
      await this.step(project, "idle lanes could not be read", () => this.idleLanes(project, loadLedger(project.state), seats, now));
      await this.step(project, "incidents held for nobody or for the sensor could not be told", async () => void (await desk.retell(project)));
      await this.step(project, "a task whose Peer is gone could not be recorded", () => this.goneTasks(project, loadLedger(project.state), seats));
      await this.step(project, "asks due a reminder could not be sent", () => this.dueAsks(project, loadLedger(project.state), seats, now));
      await this.step(project, "what a lane's history shows could not be read", () => this.history(project, loadLedger(project.state), seats));
      await this.step(project, "sweeping failed", () => this.sweep(project, loadLedger(project.state), seats));
      await this.step(project, "a copy waiting on a seat could not be put away", () => desk.reapSlots(project, new Set(seats.keys())));
      await this.step(project, "the status page could not be written", async () => this.writeStatus(project, seats, now));
    }
    // A restart is the one thing that loses a teardown waiting on a seat's turn, and a project with
    // no seats left is not in the round at all — so on the first round, every project on record gets
    // one look. Not every round: there is nothing else to do for a project nobody is working in.
    if (!this.reaped) {
      this.reaped = true;
      const live = new Set(seats.keys());
      for (const project of this.deps.source.known()) {
        if (desk.projects.has(project.slug)) continue;
        await this.step(project, "a copy left behind by a restart could not be put away", () => desk.reapSlots(project, live));
      }
    }
    const targets = new Set(outbox.letters().map((letter) => letter.to));
    for (const to of targets) {
      try {
        await outbox.pump(to);
      } catch (error) {
        console.error(`seatworks-v2: mail for ${to} could not be delivered:`, error);
      }
    }
  }

  /** One project's round is made of steps, and a step that fails is the only thing that fails. */
  private async step(project: Project, what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      console.error(`seatworks-v2: ${project.slug}: ${what}:`, error);
    }
  }

  private async sweep(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const busy =
      Object.values(ledger.lanes).some((lane) => lane.status === "open") ||
      [...seats.values()].some((seat) => seatOf(this.deps.kit, seat.provider)?.role.tools && projectOf(seat.cwd).slug === project.slug);
    await this.deps.desk.sweep(project, busy);
  }

  /**
   * What the desk's own record shows about a lane, which no window can hold.
   *
   * The seat named is the lane's Lead, because every one of these is something a Lead decides: to
   * send a task back again, to start another review, or to write the answer into a brief. It goes
   * through the same incident book as what the watch reads from a timeline, so the Supervisor holds
   * it, marks it and calibrates against it the one way.
   */
  private async history(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const attention = this.deps.source.teamFor(project).attention;
    for (const seen of deskFacts(ledger, { reworksAt: attention.reworksAt, reviewsAt: attention.reviewsAt })) {
      const key = `${project.slug}:${seen.seat}:${seen.fact.kind}`;
      if (this.historyFlag.get(key) === seen.sign) continue;
      this.historyFlag.set(key, seen.sign);
      const seat = seats.get(seen.seat);
      await this.deps.desk.notice(project, { id: seen.seat, provider: seat?.provider ?? "", title: seat?.title }, decide([seen.fact]));
    }
  }

  private async idleLanes(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk, turns } = this.deps;
    const { leadIdleMinutes } = this.deps.source.teamFor(project).attention;
    for (const lane of Object.values(ledger.lanes).filter((entry) => entry.status === "open" && entry.lead)) {
      const lead = seats.get(lane.lead!);
      if (!lead || lead.status !== "idle") continue;
      const idle = now - Date.parse(lead.updatedAt);
      if (idle < leadIdleMinutes * 60_000 || this.idleFlag.get(lead.id) === lead.updatedAt) continue;
      if (activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, lead.id).length > 0) continue;
      const to = await desk.supervisorFor(project, lane.opener);
      const posted = await desk.post(to, `idle:${project.slug}:${lane.id}:${lead.updatedAt}`, letters.laneIdle(lane, Math.round(idle / 60_000), turns.lastEnding.get(lead.id) ?? ""));
      // Noted as told only when somebody was: set first, a notice to nobody was never tried again.
      if (posted !== "nobody") this.idleFlag.set(lead.id, lead.updatedAt);
    }
  }

  private async goneTasks(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const { desk } = this.deps;
    for (const task of Object.values(ledger.tasks).filter((entry) => ["running", "rework"].includes(entry.status) && entry.peer)) {
      const gone = `${project.slug}:${task.id}`;
      if (seats.has(task.peer!) || this.goneFlag.has(gone)) continue;
      this.goneFlag.add(gone);
      await desk.setTask(project, task.id, (entry) => {
        entry.status = "stalled";
        entry.peerGone = true;
      });
      await desk.post(ledger.lanes[task.lane]?.lead, `gone:${project.slug}:${task.id}`, letters.failed(`the Peer on ${task.id} (${task.title})`, "its agent was closed or archived"));
    }
  }

  private async dueAsks(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk } = this.deps;
    const { askRemindMinutes, maxReminders } = this.deps.source.teamFor(project).attention;
    const waited = (ask: Ask) => now - (ask.remindedAt ?? ask.openedAt) >= askRemindMinutes * 60_000;
    for (const ask of Object.values(ledger.asks).filter((entry) => entry.status === "open")) {
      const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
      // An ask whose reader has gone goes to whoever supervises now, whoever asked it. Only an idle
      // reader was ever looked at, so an ask to an archived seat was never reminded, escalated or
      // seen again — a Lead's own ask included, which has nobody else above it to escalate to.
      if (!seats.has(ask.to)) {
        const to = await desk.supervisorFor(project, lane?.opener);
        if (!to || to === ask.to) continue;
        const moved = await desk.ledger(project, (current) => {
          const entry = current.asks[ask.id];
          if (!entry || entry.status !== "open" || entry.to !== ask.to) return undefined;
          entry.to = to;
          entry.remindedAt = now;
          return { ...entry };
        });
        if (moved) await desk.post(to, `ask:${moved.id}:${to}`, letters.askTo(moved, ask.task ? `the Peer on ${ask.task}, whose reader is gone` : `the Lead of ${ask.lane ?? "a lane"}, whose reader is gone`));
        continue;
      }
      if (seats.get(ask.to)?.status !== "idle" || !waited(ask)) continue;
      const age = Math.round((now - ask.openedAt) / 60_000);
      const reminding = ask.reminders < maxReminders;
      if (reminding) {
        await desk.post(ask.to, `remind:${project.slug}:${ask.id}:${ask.reminders}`, letters.reminder(ask, age));
        // Escalated only from a Lead to the seat above it, which is the one case the letter describes:
        // an ask already put to whoever supervises has nobody further up to go to.
      } else if (ask.to === lane?.lead && !can(roleNamed(this.deps.kit, ask.fromRole), "lead") && !ask.escalated) {
        const to = await desk.supervisorFor(project, lane?.opener);
        // Marked escalated only once it has reached somebody: with nobody supervising seated it is
        // tried again next round, rather than recorded as done and never sent.
        if ((await desk.post(to, `escalate:${project.slug}:${ask.id}`, letters.escalated(ask, age, ask.lane ?? "the project"))) === "nobody") continue;
      } else continue;
      // Pinned to the count this round read. Two rounds that overlapped each added one to the same
      // number and the ask jumped past the owner's maximum without ever being reminded that often.
      await desk.ledger(project, (current) => {
        const entry = current.asks[ask.id];
        if (!entry || entry.reminders !== ask.reminders) return;
        if (reminding) entry.reminders += 1;
        else entry.escalated = true;
        entry.remindedAt = now;
      });
    }
  }

  private writeStatus(project: Project, seats: SeatMap, now: number): void {
    const { kit } = this.deps;
    const waiting = [...seats.values()].filter(
      (seat) => can(seatOf(kit, seat.provider)?.role, "supervise") && projectOf(seat.cwd).slug === project.slug && (seat.pendingPermissions?.length ?? 0) > 0,
    );
    mkdirSync(project.state, { recursive: true });
    const held = this.deps.outbox.letters();
    writeFileSync(join(project.state, "status.md"), statusText(project, loadLedger(project.state), loadConfig(project.state), seats, now, undefined, waiting, held));
  }
}
