import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Kit } from "../catalog/kit/kit.ts";
import { daemonLog } from "../core/logger.ts";
import { seatOf } from "../catalog/kit/roles.ts";
import type { SeatView, Seats } from "../core/ports.ts";
import { TASK } from "../domain/task.ts";
import type { Desk } from "../desk/desk.ts";
import { loadIncidents, openFor, saidBefore } from "../desk/store/incidents.ts";
import type { Lane } from "../domain/lane.ts";
import { type Ledger, activeTasks, openAsksFrom } from "../domain/ledger.ts";
import type { Task } from "../domain/task.ts";
import { loadLedger } from "../desk/store/ledger.ts";
import { seatLetters } from "../desk/letters/seat-letters.ts";
import { type Project, projectOf } from "../desk/project/project.ts";
import { statusPage } from "../desk/views/status.ts";
import { dueAsks } from "./due-asks.ts";
import type { Outbox } from "./outbox.ts";
import type { TeamSource } from "./team-source.ts";
import type { TurnRules } from "./turns.ts";
import { deskFacts } from "./watch/history.ts";
import { decide } from "./watch/findings.ts";
import type { Watches } from "./watch/watches.ts";

type SeatMap = Map<string, SeatView>;

type PatrolDeps = {
  kit: Kit;
  source: TeamSource;
  desk: Desk;
  seats: Seats;
  outbox: Outbox;
  turns: TurnRules;
  watches: Watches;
  remember: (project: Project) => void;
};

/** The patrol round: what no event reports, found by looking — idle Leads, gone seats, due asks, the record's own facts. */
export class Patrol {
  private readonly deps: PatrolDeps;
  private readonly idleFlag = new Map<string, string>();
  private readonly lostTold = new Set<string>();
  private readonly leadGoneTold = new Set<string>();
  private resumed = false;
  private round: Promise<void> | undefined;

  constructor(deps: PatrolDeps) {
    this.deps = deps;
  }

  /** One round at a time: the runtime arms the next timer without awaiting this one, and overlapping rounds double-wrote the ledger. */
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
    const { kit, desk, source } = this.deps;
    const seats: SeatMap = new Map((await this.deps.seats.open()).map((seat) => [seat.id, seat]));
    this.deps.watches.sync(seats.values());
    // A Lead no longer listed is gone for good, and its idle mark with it.
    for (const id of this.idleFlag.keys()) if (!seats.has(id)) this.idleFlag.delete(id);
    this.deps.watches.round(now, (watch) => source.teamFor(projectOf(watch.seat.cwd)).attention.longTurnMinutes);
    for (const seat of seats.values())
      if (seatOf(kit, seat.provider)?.role.tools) this.deps.remember(projectOf(seat.cwd));
    for (const project of desk.projects.values()) {
      // Written to, a project removed while the plugin runs would come back as a state directory of its own.
      if (!source.onRecord(project)) {
        desk.projects.delete(project.slug);
        continue;
      }
      for (const [what, run] of this.steps(project, seats, now)) await this.step(project, what, run);
    }
    if (!this.resumed) {
      this.resumed = true;
      await this.resume(seats);
    }
    await this.deliver();
  }

  /** A project's round in order, each step reading the ledger as the steps before it left it. */
  private steps(project: Project, seats: SeatMap, now: number): [string, () => Promise<void>][] {
    const { desk, outbox } = this.deps;
    const ledger = () => loadLedger(project.state);
    const gone = (id: string) => !seats.has(id) && outbox.pending(id).length === 0;
    return [
      ["idle lanes could not be read", () => this.idleLanes(project, ledger(), seats, now)],
      ["incidents held for nobody could not be told", async () => void (await desk.retell(project))],
      ["a task whose Peer is gone could not be recorded", () => this.goneTasks(project, ledger(), seats)],
      ["a lane whose Lead is gone could not be told", () => this.goneLeads(project, ledger(), seats)],
      [
        "asks due a reminder could not be sent",
        () => dueAsks(this.deps, project, ledger(), seats, now, (ids) => this.missing(ids)),
      ],
      ["what a lane's history shows could not be read", () => this.history(project, ledger(), seats)],
      ["sweeping failed", () => this.sweep(project, ledger(), seats)],
      ["waiting lanes could not be opened", () => desk.openWaiting(project)],
      ["finished lanes could not be archived", () => desk.archiveFinished(project, gone)],
      ["a copy waiting on a seat could not be put away", () => desk.reapSlots(project, new Set(seats.keys()))],
      ["the Watcher's cases could not be tended", () => desk.watcher.tend(project, seats, now)],
      ["the status page could not be written", async () => this.writeStatus(project, seats, now)],
    ];
  }

  /** Mail left waiting goes out once a round, to each seat that has any. */
  private async deliver(): Promise<void> {
    const { outbox } = this.deps;
    for (const to of new Set(outbox.letters().map((letter) => letter.to))) {
      try {
        await outbox.pump(to);
      } catch (error) {
        daemonLog.error(`mail for ${to} could not be delivered:`, error);
      }
    }
  }

  /**
   * A stop loses the turns that ended and the merges that waited while the plugin was down, so the first round takes them
   * up once, for every project on record.
   */
  private async resume(seats: SeatMap): Promise<void> {
    const { desk } = this.deps;
    try {
      await desk.resume(seats);
    } catch (error) {
      daemonLog.error("what waited on a turn when the plugin stopped could not be taken up:", error);
    }
    const live = new Set(seats.keys());
    for (const project of this.deps.source.known()) {
      await this.step(project, "the merges queued when the plugin stopped could not be taken up", () =>
        desk.resumeMerges(project),
      );
      if (!desk.projects.has(project.slug))
        await this.step(project, "a copy left behind by a restart could not be put away", () =>
          desk.reapSlots(project, live),
        );
    }
  }

  /** One project's round is made of steps, and a step that fails is the only thing that fails. */
  private async step(project: Project, what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      daemonLog.error(`${project.slug}: ${what}:`, error);
    }
  }

  private async sweep(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const busy =
      Object.values(ledger.lanes).some((lane) => lane.status === "open") ||
      [...seats.values()].some(
        (seat) => seatOf(this.deps.kit, seat.provider)?.role.tools && projectOf(seat.cwd).slug === project.slug,
      );
    await this.deps.desk.sweep(project, busy);
  }

  /** Desk-record facts about a lane, filed against its Lead in the same incident book the watch uses. */
  private async history(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const attention = this.deps.source.teamFor(project).attention;
    const found = deskFacts(ledger, { reworksAt: attention.reworksAt, reviewsAt: attention.reviewsAt });
    if (found.length === 0) return;
    const book = loadIncidents(project.state);
    for (const seen of found) {
      // A gone seat's incidents closed when it went; raising one leaves a sighting nothing closes.
      const seat = seats.get(seen.seat);
      if (!seat || seat.archivedAt) continue;
      // Still open: sight it again so today's settings reweigh it. Settled: nothing new until the record changes.
      const open = openFor(book, seen.seat, seen.fact.kind);
      if (!open && saidBefore(book, seen.seat, seen.fact.kind, seen.fact.quote)) continue;
      if (open && open.quote === seen.fact.quote && open.told !== undefined) continue;
      await this.deps.desk.notice(
        project,
        { id: seen.seat, provider: seat.provider, title: seat.title },
        decide([seen.fact]),
      );
    }
  }

  /** A Lead waiting on nobody: not on hold, not reported ready, and no landing of its lane waiting for the Human. */
  private async idleLanes(project: Project, ledger: Ledger, seats: SeatMap, now: number): Promise<void> {
    const { desk, turns } = this.deps;
    const { leadIdleMinutes } = this.deps.source.teamFor(project).attention;
    for (const lane of Object.values(ledger.lanes).filter(
      (entry) => entry.status === "open" && entry.lead && !entry.onHold && !entry.ready && !entry.landApproval,
    )) {
      const lead = seats.get(lane.lead!);
      if (!lead || lead.status !== "idle") continue;
      const idle = now - Date.parse(lead.updatedAt);
      if (idle < leadIdleMinutes * 60_000 || this.idleFlag.get(lead.id) === lead.updatedAt) continue;
      if (activeTasks(ledger, lane.id).length > 0 || openAsksFrom(ledger, lead.id).length > 0) continue;
      const to = await desk.supervisorFor(project, lane.opener);
      const posted = await desk.post(
        to,
        seatLetters.laneIdle(lane, Math.round(idle / 60_000), turns.lastEnding.get(lead.id) ?? "", lead.updatedAt),
      );
      // Noted as told only when somebody was: set first, a notice to nobody was never tried again.
      if (posted !== "nobody") this.idleFlag.set(lead.id, lead.updatedAt);
    }
  }

  /**
   * The round lists its seats before a step reads its ledger, so a seat that ledger names and the round did not list is
   * looked for again: these are the ones a listing asked for now still misses.
   */
  private async missing(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const listed = new Set((await this.deps.seats.open()).map((seat) => seat.id));
    return new Set(ids.filter((id) => !listed.has(id)));
  }

  private async goneTasks(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const { desk } = this.deps;
    const key = (task: Task) => `${project.slug}:${task.id}`;
    const lost = Object.values(ledger.tasks).filter(
      (entry) => TASK.may(entry.status, "lose") && entry.peer && !seats.has(entry.peer),
    );
    keepStanding(this.lostTold, `${project.slug}:`, new Set(lost.map(key)));
    const unlisted = lost.filter((entry) => !this.lostTold.has(key(entry)));
    const missing = await this.missing(unlisted.map((task) => task.peer!));
    for (const task of unlisted.filter((entry) => missing.has(entry.peer!))) {
      this.lostTold.add(key(task));
      const moved = desk.moveTask(project, task.id, "lose", (entry) => {
        entry.peerGone = true;
      });
      if (typeof moved !== "object") continue;
      await desk.post(ledger.lanes[task.lane]?.lead, seatLetters.gone(task));
    }
  }

  /** Nothing restarts a lane whose Lead went, so whoever supervises is told once per Lead; an empty listing tells nothing. */
  private async goneLeads(project: Project, ledger: Ledger, seats: SeatMap): Promise<void> {
    const { desk } = this.deps;
    if (seats.size === 0) return;
    const key = (lane: Lane) => `${project.slug}:${lane.id}:${lane.lead}`;
    const leadless = Object.values(ledger.lanes).filter(
      (entry) => entry.status === "open" && entry.lead && !seats.has(entry.lead),
    );
    keepStanding(this.leadGoneTold, `${project.slug}:`, new Set(leadless.map(key)));
    const unlisted = leadless.filter((entry) => !this.leadGoneTold.has(key(entry)));
    const missing = await this.missing(unlisted.map((lane) => lane.lead!));
    for (const lane of unlisted.filter((entry) => missing.has(entry.lead!))) {
      const posted = await desk.post(await desk.supervisorFor(project, lane.opener), seatLetters.leadGone(lane));
      if (posted !== "nobody") this.leadGoneTold.add(key(lane));
    }
  }

  private writeStatus(project: Project, seats: SeatMap, now: number): void {
    mkdirSync(project.state, { recursive: true });
    writeFileSync(
      join(project.state, "status.md"),
      statusPage(this.deps.kit, project, seats, now, this.deps.outbox.held()),
    );
  }
}

/** Keeps a project's marks only while what they mark still stands, so marks for work long settled do not pile up. */
function keepStanding(marks: Set<string>, prefix: string, standing: Set<string>): void {
  for (const mark of marks) if (mark.startsWith(prefix) && !standing.has(mark)) marks.delete(mark);
}
