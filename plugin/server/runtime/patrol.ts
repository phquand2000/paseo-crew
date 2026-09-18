import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Kit, can, roleNamed, seatOf } from "../catalog/kit.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import { hash } from "../desk/context.ts";
import type { Desk } from "../desk/desk.ts";
import { type Ledger, activeTasks, loadLedger, openAsksFrom } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { type Project, loadConfig, projectOf } from "../desk/project.ts";
import { statusText } from "../desk/status.ts";
import { digestDue, loadWatching, pendingEntries, reported } from "../desk/watching.ts";
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
    for (const seat of seats.values()) if (seatOf(kit, seat.provider)?.role.tools) this.deps.remember(projectOf(seat.cwd));
    for (const project of desk.projects.values()) {
      await this.step(project, "the Watcher could not be settled", () => this.seatWatcher(project, loadLedger(project.state), seats));
      await this.step(project, "idle lanes could not be read", () => this.idleLanes(project, loadLedger(project.state), seats, now));
      await this.step(project, "a task whose Peer is gone could not be recorded", () => this.goneTasks(project, loadLedger(project.state), seats));
      await this.step(project, "asks due a reminder could not be sent", () => this.dueAsks(project, loadLedger(project.state), seats, now));
      await this.step(project, "the report could not be sent", () => this.sendDigest(project, now));
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

  private async seatWatcher(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const watching = this.deps.source.teamFor(project).attention.watch;
    if (watching && Object.values(ledger.lanes).some((lane) => lane.status === "open")) {
      await this.deps.desk.ensureWatcher(project, seats.values());
      return;
    }
    await this.deps.desk.retireWatcher(project, seats.values(), !watching);
  }

  private async sweep(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const busy =
      Object.values(ledger.lanes).some((lane) => lane.status === "open") ||
      [...seats.values()].some((seat) => seatOf(this.deps.kit, seat.provider)?.role.tools && projectOf(seat.cwd).slug === project.slug);
    await this.deps.desk.sweep(project, busy);
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
      this.idleFlag.set(lead.id, lead.updatedAt);
      const to = await desk.supervisorFor(project, lane.opener);
      await desk.post(to, `idle:${project.slug}:${lane.id}:${lead.updatedAt}`, letters.laneIdle(lane, Math.round(idle / 60_000), turns.lastEnding.get(lead.id) ?? ""));
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
      });
      await desk.post(ledger.lanes[task.lane]?.lead, `gone:${project.slug}:${task.id}`, letters.failed(`the Peer on ${task.id} (${task.title})`, "its agent was closed or archived"));
    }
  }

  private async dueAsks(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk } = this.deps;
    const { askRemindMinutes, maxReminders } = this.deps.source.teamFor(project).attention;
    const due = Object.values(ledger.asks).filter(
      (ask) => ask.status === "open" && seats.get(ask.to)?.status === "idle" && now - (ask.remindedAt ?? ask.openedAt) >= askRemindMinutes * 60_000,
    );
    for (const ask of due) {
      const age = Math.round((now - ask.openedAt) / 60_000);
      if (ask.reminders < maxReminders) {
        await desk.post(ask.to, `remind:${project.slug}:${ask.id}:${ask.reminders}`, letters.reminder(ask, age));
        // Whether there is anyone above the asker, which is a capability and not a name: the Lead's own
        // ask has nobody above it to escalate to. Comparing to the literal "lead" worked only because
        // that handler wrote the same literal back, so a second lead-capable role was never escalated.
      } else if (!can(roleNamed(this.deps.kit, ask.fromRole), "lead") && !ask.escalated) {
        const lane = ask.lane ? ledger.lanes[ask.lane] : undefined;
        const to = await desk.supervisorFor(project, lane?.opener);
        await desk.post(to, `escalate:${project.slug}:${ask.id}`, letters.escalated(ask, age, ask.lane ?? "the project"));
      } else continue;
      // Pinned to the count this round read. Two rounds that overlapped each added one to the same
      // number and the ask jumped past the owner's maximum without ever being reminded that often.
      await desk.ledger(project, (current) => {
        const entry = current.asks[ask.id];
        if (!entry || entry.reminders !== ask.reminders) return;
        if (entry.reminders < maxReminders) entry.reminders += 1;
        else entry.escalated = true;
        entry.remindedAt = now;
      });
    }
  }

  private async sendDigest(project: Project, now: number): Promise<void> {
    const { desk } = this.deps;
    const { digestMinutes, always } = this.deps.source.teamFor(project).attention;
    const watching = loadWatching(project.state);
    const waiting = pendingEntries(watching);
    if (waiting.length === 0) return;
    const oldest = Math.min(...waiting.map(([, strike]) => strike.first));
    if (!digestDue(watching, oldest, now, digestMinutes)) return;
    const to = await desk.supervisorFor(project);
    if (!to) return;
    // The key identifies what this digest carries. A strike keeps its `first` for as long as the fault
    // recurs, so keying on the oldest of them made each digest a repeat of the one before; and a total
    // is not a fingerprint either — one fault seen twice and two faults seen once both add to two.
    const carried = Object.fromEntries(waiting.map(([key, strike]) => [key, strike.count]));
    const fingerprint = hash(...Object.entries(carried).map(([key, count]) => `${key}=${count}`).sort());
    const body = letters.digest(waiting.map(([, strike]) => strike), Math.round((now - oldest) / 60_000), always);
    const posted = await desk.post(to, `digest:${project.slug}:${fingerprint}`, body);
    // Only what really went is settled. A digest the outbox dropped as a repeat said nothing, and
    // marking it told lost the occurrence for good; the state is read back because `raise` can have
    // run during the post, and this snapshot no longer knows about it.
    if (posted !== "sent" && posted !== "held") return;
    await desk.watching(project, (current) => ({ save: reported(current, carried, now), result: undefined }));
    desk.event(project, { kind: "watch.digest", items: waiting.length });
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
