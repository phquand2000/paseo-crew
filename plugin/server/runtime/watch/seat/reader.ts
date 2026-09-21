import type { Posted } from "../../../desk/context.ts";
import { type Incident, awaitsWatcher, loadIncidents } from "../../../desk/incidents.ts";
import { letters } from "../../../desk/letters.ts";
import { placeOf } from "../../../desk/notice.ts";
import { type Project, projectOf } from "../../../desk/project.ts";
import { Pacer } from "../pacer.ts";
import { type Step, stepText, trailOf } from "../trail.ts";
import type { SeatWatch, WatchedSeat } from "../watches.ts";

export type Pace = { quietMs: number; everyMs: number; chars: number };

export type ReaderDeps = {
  /** How this project reads to a Watcher; undefined when its watch is not by a seat. */
  pace: (project: Project) => Pace | undefined;
  watcher: (project: Project) => Promise<string | undefined>;
  post: (to: string, key: string, text: string) => Promise<Posted | "nobody">;
  /** The facts a Watcher judges. */
  judges: string[];
};

/** What one Watcher has already been shown of one seat's current instruction. */
type Shown = { watcher: string; instruction: string; steps: Map<string, string>; final?: string; facts: Set<string>; incidents: Set<string> };

/** A step a Watcher was shown, by the ref it was shown under: what `raise` reports is this, not the Watcher's words. */
export type Sent = { seat: WatchedSeat; project: string; text: string };

/** Refs kept per Watcher. A rotation starts a fresh one long before this, and only a ref it was sent can be raised. */
const KEPT_REFS = 2000;

/**
 * An incident as the Watcher is shown it, and names it back to `judge`: its id and how many times it
 * had been seen. Seen again, it waits for a fresh judgement, is shown again under a new name, and a
 * judgement given under the old one is refused rather than laid on words the Watcher never read.
 */
export const shownAs = (item: Pick<Incident, "id" | "count">) => `${item.id}.${item.count}`;

/** What the code raised about this seat that waits for the Watcher's judgement and has not been shown it. */
const waitingOn = (state: string, seat: string, judges: string[], shown: Set<string>): Incident[] => {
  try {
    return Object.values(loadIncidents(state).items).filter((item) => item.seat === seat && awaitsWatcher(item, judges) && !shown.has(shownAs(item)));
  } catch {
    return [];
  }
};

/** A step as the Watcher reads it: what `stepText` says, and what it printed. */
function stepLine(ref: string, step: Step): string {
  const text = stepText({ ...step, id: ref });
  const output = "output" in step && step.output ? ` → ${step.output}` : "";
  return `${text}${step.kind === "ran" && step.result === "running" ? " (still running)" : ""}${output}`;
}

/**
 * Mails a Watcher what the seats it watches are doing, as they do it: the steps that are new or
 * changed since it was last shown them, paced per seat so a busy seat is read in batches rather than
 * row by row. The outbox holds what arrives while the Watcher is reading, and hands it over together.
 */
export class Reader {
  private readonly deps: ReaderDeps;
  private readonly pacers = new Map<string, Pacer>();
  private readonly shown = new Map<string, Shown>();
  private readonly counts = new Map<string, number>();
  private readonly refs = new Map<string, Map<string, Sent>>();

  constructor(deps: ReaderDeps) {
    this.deps = deps;
  }

  /** The step this Watcher was sent under this ref, if it was. */
  sent(watcher: string, ref: string): Sent | undefined {
    return this.refs.get(watcher)?.get(ref);
  }

  /** Forgets every Watcher not in `live`: a rotated or retired one is never read to or raised by again. */
  keep(live: Set<string>): void {
    for (const watcher of [...this.counts.keys()]) {
      if (live.has(watcher)) continue;
      this.counts.delete(watcher);
      this.refs.delete(watcher);
    }
  }

  /** How many readings this Watcher has been sent. */
  readings(watcher: string): number {
    return this.counts.get(watcher) ?? 0;
  }

  moment(watch: SeatWatch, urgent: boolean): void {
    const pace = this.deps.pace(projectOf(watch.seat.cwd));
    if (!pace) return;
    let pacer = this.pacers.get(watch.seat.id);
    if (!pacer) {
      const made: Pacer = new Pacer(pace.quietMs, pace.everyMs, () => this.read(watch, made));
      pacer = made;
      this.pacers.set(watch.seat.id, pacer);
    }
    if (urgent) pacer.now();
    else pacer.nudge();
  }

  drop(id: string): void {
    this.pacers.get(id)?.stop();
    this.pacers.delete(id);
    this.shown.delete(id);
  }

  dispose(): void {
    for (const id of [...this.pacers.keys()]) this.drop(id);
  }

  private async read(watch: SeatWatch, pacer: Pacer): Promise<void> {
    const project = projectOf(watch.seat.cwd);
    const pace = this.deps.pace(project);
    const brief = watch.brief();
    if (!pace || !brief || brief.goal === null) return;
    const to = await this.deps.watcher(project);
    if (!to || this.pacers.get(watch.seat.id) !== pacer) return;
    const trail = trailOf(watch.window, !watch.running, brief.rules);
    const before = this.shown.get(watch.seat.id);
    const fresh = !before || before.watcher !== to || before.instruction !== trail.instruction;
    const shown: Shown = fresh ? { watcher: to, instruction: trail.instruction, steps: new Map(), facts: new Set(), incidents: new Set(before?.watcher === to ? before.incidents : []) } : before;
    const steps = trail.steps.filter((step) => shown.steps.get(step.id) !== JSON.stringify(step));
    const final = trail.final && trail.final.text !== shown.final ? trail.final : undefined;
    const facts = watch.noted.filter((fact) => !shown.facts.has(`${fact.kind}\n${fact.quote}`));
    const waiting = waitingOn(project.state, watch.seat.id, this.deps.judges, shown.incidents);
    if (steps.length === 0 && !final && facts.length === 0 && waiting.length === 0) return;

    // Taken before the post is awaited: two seats read at once would otherwise both be R5, and a ref
    // has to name one step.
    const n = this.readings(to) + 1;
    this.counts.set(to, n);
    const lines = steps.map((step) => ({ ref: `R${n}.${step.id}`, text: stepLine(`R${n}.${step.id}`, step) }));
    // The newest steps are what the Watcher is here for; what does not fit gives way from the front.
    let skipped = fresh ? trail.lost : 0;
    while (lines.length > 1 && lines.map((entry) => entry.text).join("\n").length > pace.chars) {
      lines.shift();
      skipped += 1;
    }
    const closing = final ? { ref: `R${n}.${final.id}`, text: `R${n}.${final.id} said: ${final.text}` } : undefined;
    const text = letters.reading({
      n,
      where: placeOf(project, watch.seat).where,
      agent: watch.seat.id,
      role: brief.role,
      running: watch.running,
      ...(fresh ? { brief: { goal: brief.goal, context: brief.context, beside: brief.beside.map((sibling) => `${sibling.task} ${sibling.title}: owns ${sibling.owned.join(", ") || "nothing declared"}`), instruction: trail.instruction } } : {}),
      steps: lines.map((entry) => entry.text),
      skipped,
      ...(closing ? { final: closing.text } : {}),
      facts: facts.map((fact) => `${fact.kind}: ${fact.quote}`),
      waiting: waiting.map((incident) => `${shownAs(incident)} ${incident.kind} (${incident.level}): ${incident.quote}`),
    });
    const posted = await this.deps.post(to, `reading:${watch.seat.id}:${n}`, text);
    if (posted === "nobody") return;
    const kept = this.refs.get(to) ?? new Map<string, Sent>();
    for (const entry of closing ? [...lines, closing] : lines) kept.set(entry.ref, { seat: watch.seat, project: project.slug, text: entry.text });
    for (const ref of [...kept.keys()].slice(0, Math.max(0, kept.size - KEPT_REFS))) kept.delete(ref);
    this.refs.set(to, kept);
    for (const incident of waiting) shown.incidents.add(shownAs(incident));
    for (const step of steps) shown.steps.set(step.id, JSON.stringify(step));
    // A claim read as the turn's last word is the same step once the next turn is under way.
    if (final) {
      shown.final = final.text;
      shown.steps.set(final.id, JSON.stringify({ id: final.id, kind: "said", text: final.text }));
    }
    for (const fact of facts) shown.facts.add(`${fact.kind}\n${fact.quote}`);
    this.shown.set(watch.seat.id, shown);
  }
}
