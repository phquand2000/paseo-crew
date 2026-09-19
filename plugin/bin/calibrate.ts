import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Question, type SensorSpec, loadKit } from "../server/catalog/kit.ts";
import { DAY_MS, loadIncidents } from "../server/desk/incidents.ts";
import { type Project, projectOf } from "../server/desk/project.ts";
import { TeamSource } from "../server/runtime/team-source.ts";
import { type Kept, readAssessments } from "../server/runtime/watch/assessments.ts";
import type { Fact } from "../server/runtime/watch/facts.ts";
import { fromAnswers } from "../server/runtime/watch/rules.ts";
import { asked, assess } from "../server/runtime/watch/sensor.ts";

export type Label = { id: string; seat: string; kind: string; opened: number; last: number; label: "useful" | "noise" };

type Fetcher = Parameters<typeof assess>[4];

const ENOUGH = 5;
const USAGE = `usage: node bin/calibrate.ts <project directory or its state directory> [--ask] [--limit N] [--per-day N]

Reads the assessments the watch kept and the useful/noise marks on incidents, and reports for each
question how well its answers separate the two (AUROC), how often it would fire, and the threshold
that keeps it within the daily budget. --ask asks the questions in catalog/sensor again against the
kept states first (it costs one call per assessment). --limit keeps the newest N assessments (a
whole number above 0); --per-day replaces the budget in the settings (a whole number).`;

export function labelsIn(state: string): Label[] {
  const found = new Map<string, Label>();
  const log = join(state, "events.log");
  if (existsSync(log)) {
    for (const row of readFileSync(log, "utf-8").split("\n")) {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(row) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.kind !== "incident.ack" || (event.verdict !== "useful" && event.verdict !== "noise")) continue;
      if (typeof event.id !== "string" || typeof event.seat !== "string" || typeof event.finding !== "string" || typeof event.opened !== "number" || typeof event.last !== "number") continue;
      found.set(`${event.id}:${event.opened}`, { id: event.id, seat: event.seat, kind: event.finding, opened: event.opened, last: event.last, label: event.verdict });
    }
  }
  for (const item of Object.values(loadIncidents(state).items)) {
    if (item.label) found.set(`${item.id}:${item.opened}`, { id: item.id, seat: item.seat, kind: item.kind, opened: item.opened, last: item.last, label: item.label });
  }
  return [...found.values()];
}

export function auroc(positives: number[], negatives: number[]): number | undefined {
  if (positives.length === 0 || negatives.length === 0) return undefined;
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

async function reask(kept: Kept[], spec: SensorSpec, key: string, fetcher?: Fetcher): Promise<{ answers: Map<Kept, Record<string, number>>; failed: number; cost: number; models: Map<string, number> }> {
  const answers = new Map<Kept, Record<string, number>>();
  const models = new Map<string, number>();
  let failed = 0;
  let cost = 0;
  let next = 0;
  const work = async () => {
    while (next < kept.length) {
      const record = kept[next++]!;
      const questions = asked(spec.questions, record.state);
      if (Object.keys(questions).length === 0) continue;
      try {
        const assessment = await assess({ ...spec, questions }, key, record.state, `replay:${record.seat}`, fetcher);
        answers.set(record, assessment.answers);
        models.set(assessment.model, (models.get(assessment.model) ?? 0) + 1);
        cost += assessment.cost ?? 0;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
  return { answers, failed, cost, models };
}

const fires = (question: Question, p: number, threshold: number) => (question.below ? p <= threshold : p >= threshold);
const score = (question: Question, p: number) => (question.below ? 1 - p : p);
const fixed = (value: number | undefined) => (value === undefined ? "–" : value.toFixed(2));
const CANDIDATES = Array.from({ length: 101 }, (_, index) => index / 100);

function firedAt(kept: Kept[], name: string, question: Question, answer: (record: Kept) => number | undefined, threshold: number): number[] {
  const first = new Map<string, number>();
  for (const record of kept) {
    const p = answer(record);
    if (p === undefined) continue;
    const key = `${record.seat}\n${record.turnId ?? Math.floor(record.askedAt / 3_600_000)}`;
    if (!first.has(key) && fromAnswers({ [name]: p }, { [name]: { ...question, threshold } }, record.facts as Fact[]).length > 0) first.set(key, record.at);
  }
  return [...first.values()].sort((a, b) => a - b);
}

export function peak(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let most = 0;
  for (let from = 0, to = 0; to < sorted.length; to++) {
    while (sorted[to]! - sorted[from]! >= DAY_MS) from += 1;
    most = Math.max(most, to - from + 1);
  }
  return most;
}

function factOpens(state: string, questions: Set<string>): number[] {
  const log = join(state, "events.log");
  if (!existsSync(log)) return [];
  const times: number[] = [];
  for (const row of readFileSync(log, "utf-8").split("\n")) {
    try {
      const event = JSON.parse(row) as Record<string, unknown>;
      if (event.kind === "incident.open" && event.level === "attend" && typeof event.finding === "string" && !questions.has(event.finding) && typeof event.at === "string") times.push(Date.parse(event.at));
    } catch {}
  }
  return times.filter((time) => Number.isFinite(time));
}

function precision(scored: { label: Label["label"]; p: number }[], question: Question, threshold: number): string {
  const hit = scored.filter((item) => fires(question, item.p, threshold));
  if (hit.length === 0) return "none of the marked ones fire";
  return `${(hit.filter((item) => item.label === "useful").length / hit.length).toFixed(2)} of ${hit.length} marked`;
}

export type CalibrateOptions = { state: string; kit?: ReturnType<typeof loadKit>; project?: Project; ask?: boolean; limit?: number; perDay?: number; fetcher?: Fetcher };

export async function calibrate(options: CalibrateOptions): Promise<string> {
  const kit = options.kit ?? loadKit(join(dirname(fileURLToPath(import.meta.url)), ".."));
  const project = options.project ?? { root: "", slug: basename(options.state), state: options.state };
  const team = new TeamSource(kit).teamFor(project);
  const spec = team.sensor?.spec ?? Object.values(kit.sensors)[0];
  if (!spec) return "The kit ships no sensor, so there is nothing to calibrate.";
  const read = readAssessments(options.state);
  const kept = options.limit !== undefined ? read.kept.slice(-options.limit) : read.kept;
  const out: string[] = [];
  if (kept.length === 0) return `No assessments are kept under ${options.state}/assessments yet. They are written once a sensor key is set and the watch has assessed a seat.`;
  const perDay = options.perDay ?? team.attention.incidentsPerDay;
  const seen = new Map<string, number>();
  for (const record of kept) seen.set(record.model, (seen.get(record.model) ?? 0) + 1);
  out.push(`${kept.length} assessments over ${((kept.at(-1)!.at - kept[0]!.at) / DAY_MS).toFixed(1)} days${read.broken > 0 ? `, ${read.broken} unreadable and skipped` : ""}; answered by ${[...seen].map(([model, count]) => `${model} (${count})`).join(", ")}`);
  let replayed: Map<Kept, Record<string, number>> | undefined;
  let failedAgain = 0;
  if (options.ask) {
    if (!team.sensor) return "--ask needs the sensor key in the machine settings (sensor.key).";
    const again = await reask(kept, spec, team.sensor.key, options.fetcher);
    replayed = again.answers;
    failedAgain = again.failed;
    out.push(`asked again: ${again.answers.size} answered, ${again.failed} failed, cost ${again.cost.toFixed(6)}; answered by ${[...again.models].map(([model, count]) => `${model} (${count})`).join(", ") || "nobody"}`);
  }
  out.push(`A question fires at most once per turn, and every count below is its busiest 24 hours, the window the day's budget of ${perDay} is spent over.`);
  const labels = labelsIn(options.state);
  const now: number[] = [];
  const suggested: number[] = [];
  for (const [name, question] of Object.entries(spec.questions)) {
    const stored = (record: Kept): number | undefined => record.answers[name];
    const answered = kept.filter((record) => stored(record) !== undefined).length;
    const decides = question.threshold !== undefined && Boolean(question.level);
    out.push("");
    out.push(`${name}${decides ? ` (${question.alone ? "alone" : `with ${question.agrees!.join("/")}`}, ${question.level}, fires ${question.below ? "at or below" : "at or above"} ${fixed(question.threshold)})` : " (label-only)"}`);
    const answeredAgain = replayed ? [...replayed.values()].filter((answers) => answers[name] !== undefined).length : 0;
    out.push(`  answered ${answered} times as kept${replayed ? `, ${answeredAgain} times asked again` : ""}`);
    if (!decides || answered + answeredAgain === 0) continue;
    const scored: { label: Label["label"]; p: number; again?: number }[] = [];
    let unmatched = 0;
    for (const label of labels.filter((item) => item.kind === name)) {
      const during = kept.filter((record) => record.seat === label.seat && record.found.includes(name) && record.at >= label.opened - 1000 && record.at <= label.last);
      const ps = during.map(stored).filter((p): p is number => p !== undefined);
      if (ps.length === 0) {
        unmatched += 1;
        continue;
      }
      const again = replayed ? during.map((record) => replayed.get(record)?.[name]).filter((p): p is number => p !== undefined) : [];
      scored.push({ label: label.label, p: question.below ? Math.min(...ps) : Math.max(...ps), ...(again.length > 0 ? { again: question.below ? Math.min(...again) : Math.max(...again) } : {}) });
    }
    const useful = scored.filter((item) => item.label === "useful");
    const noise = scored.filter((item) => item.label === "noise");
    out.push(`  marked: ${useful.length} useful, ${noise.length} noise${unmatched > 0 ? ` (${unmatched} more marked incidents have no kept assessment)` : ""}`);
    const asKept = auroc(useful.map((item) => score(question, item.p)), noise.map((item) => score(question, item.p)));
    const withAgain = scored.filter((item) => item.again !== undefined);
    const usefulAgain = withAgain.filter((item) => item.label === "useful");
    const noiseAgain = withAgain.filter((item) => item.label === "noise");
    const asAsked = replayed ? auroc(usefulAgain.map((item) => score(question, item.again!)), noiseAgain.map((item) => score(question, item.again!))) : undefined;
    out.push(`  AUROC as kept: ${fixed(asKept)}${replayed ? `; asked again: ${fixed(asAsked)} (${usefulAgain.length} useful, ${noiseAgain.length} noise answered)` : ""}`);
    const current = question.threshold!;
    const times = (threshold: number, answer = stored) => firedAt(kept, name, question, answer, threshold);
    const atCurrent = times(current);
    out.push(`  at ${fixed(current)}: fires on ${atCurrent.length} turns, at most ${peak(atCurrent)} in 24 hours; precision ${precision(scored, question, current)}`);
    if (question.level === "attend") {
      now.push(...atCurrent);
      const order = question.below ? [...CANDIDATES].reverse() : CANDIDATES;
      const within = order.find((threshold) => peak(times(threshold)) <= perDay);
      if (within === undefined) {
        out.push(`  no threshold keeps it within ${perDay} in 24 hours`);
        suggested.push(...atCurrent);
      } else {
        const at = times(within);
        suggested.push(...at);
        out.push(`  most sensitive threshold within ${perDay} in 24 hours, were it the only thing firing: ${fixed(within)} (at most ${peak(at)}; precision ${precision(scored, question, within)})`);
      }
      if (replayed) {
        const again = (record: Kept): number | undefined => replayed.get(record)?.[name];
        const withinAgain = order.find((threshold) => peak(times(threshold, again)) <= perDay);
        out.push(failedAgain > 0 ? `  asked again: not computed, since ${failedAgain} assessments could not be asked again` : `  asked again, the same: ${withinAgain === undefined ? "no threshold" : fixed(withinAgain)}`);
      }
    }
    const [judged, marks] = replayed ? [asAsked, [usefulAgain.length, noiseAgain.length]] : [asKept, [useful.length, noise.length]];
    const enough = marks[0]! >= ENOUGH && marks[1]! >= ENOUGH;
    out.push(`  → ${!enough ? `not enough marks${replayed ? " answered again" : ""} to judge (${ENOUGH} of each are needed)` : judged! < 0.55 ? "make it label-only: its answers barely separate useful from noise" : "keep"}`);
  }
  const questions = new Set(Object.keys(spec.questions));
  const opened = factOpens(options.state, questions);
  out.push("");
  out.push(`together, with the ${opened.length} attend incidents code facts opened: at most ${peak([...now, ...opened])} in 24 hours at the thresholds set, ${peak([...suggested, ...opened])} at the ones suggested above; the budget is ${perDay}`);
  const facts = new Map<string, { useful: number; noise: number }>();
  for (const label of labels) {
    if (questions.has(label.kind)) continue;
    const tally = facts.get(label.kind) ?? { useful: 0, noise: 0 };
    tally[label.label] += 1;
    facts.set(label.kind, tally);
  }
  if (facts.size > 0) {
    out.push("");
    out.push("incidents raised by code facts, as marked:");
    for (const [kind, tally] of [...facts].sort()) out.push(`  ${kind}: ${tally.useful} useful, ${tally.noise} noise (precision ${(tally.useful / (tally.useful + tally.noise)).toFixed(2)})`);
  }
  out.push("");
  out.push("Every mark comes from an incident that fired, so AUROC here ranks within what already crossed a threshold, and says nothing of what was never raised.");
  return out.join("\n");
}

function projectFor(path: string): Project {
  const full = resolve(path);
  if (existsSync(join(full, "assessments")) || existsSync(join(full, "incidents.json"))) return { root: "", slug: basename(full), state: full };
  return projectOf(full);
}

function whole(value: string | undefined, least: number): number | undefined {
  if (value === undefined) return undefined;
  return /^\d+$/.test(value) && Number(value) >= least ? Number(value) : Number.NaN;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { ask: { type: "boolean" }, limit: { type: "string" }, "per-day": { type: "string" }, help: { type: "boolean" } } });
  const limit = whole(values.limit, 1);
  const perDay = whole(values["per-day"], 0);
  if (values.help || positionals.length !== 1 || Number.isNaN(limit) || Number.isNaN(perDay)) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 2);
  }
  const project = projectFor(positionals[0]!);
  console.log(await calibrate({ state: project.state, project, ask: values.ask, limit, perDay }));
}
