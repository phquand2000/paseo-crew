import { configFault } from "../core/config-file.ts";
import { changedFiles, commitsAhead, diffCounts, git, kindOf, mergeBase } from "../core/git.ts";
import { coverOf, globToRegex, uncovered } from "../core/scope.ts";
import { capped } from "../core/text.ts";
import { type Kit, fileKinds, testMarkers, weakened } from "../catalog/kit.ts";
import { SETTLED } from "../domain/task.ts";
import { loadIncidents } from "./incidents.ts";
import { type Lane, type Ledger, type Task, tasksOf } from "./ledger.ts";
import { type Project, configFile, loadConfig, serialOnlyOf } from "./project.ts";

type LandGate = { set: boolean; ok: boolean };

/** What a lane changed, from where it left its base, or where an onBranch lane began on a branch that had history before it. */
type Change = { from?: string; files?: string[] };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const SHOWN = 5;

type Reviewed = Task & { handback: NonNullable<Task["handback"]> };

/** A task accepted after its own latest review did not accept it: whether it was handed back again after that review, and whether a review accepted it since. */
type Over = { task: string; review: string; outcome: string; again: boolean; since: boolean };

/** A lane's reviews as the record has them, by when each came back rather than when it was asked for. */
function reviewRecord(ledger: Ledger, lane: Lane): { whole: boolean; latest?: Reviewed; after: string[]; over: Over[] } {
  const tasks = tasksOf(ledger, lane.id);
  const reviews = tasks.filter((task): task is Reviewed => task.kind === "review" && task.handback !== undefined).sort((a, b) => a.handback.at - b.handback.at);
  const accepted = tasks.filter((task): task is Task & { acceptedAt: number } => task.kind === "code" && task.status === "merged" && task.acceptedAt !== undefined);
  const latest = reviews.at(-1);
  const after = latest ? accepted.filter((task) => task.acceptedAt > latest.handback.at).map((task) => task.id) : [];
  const over = accepted.flatMap((task): Over[] => {
    const own = reviews.filter((review) => review.of === task.id && review.handback.at < task.acceptedAt).at(-1);
    if (!own || own.handback.outcome === "accept") return [];
    const since = reviews.some((review) => (!review.of || review.of === task.id) && review.handback.outcome === "accept" && review.handback.at > task.acceptedAt);
    return [{ task: task.id, review: own.id, outcome: own.handback.outcome, again: (task.handback?.at ?? 0) > own.handback.at, since }];
  });
  return { whole: reviews.some((review) => !review.of), latest, after, over };
}

/**
 * What a lane's reviews leave standing: no review of the whole lane, a latest review that did not accept, a task accepted
 * over its review's changes or on a later hand-back no review read. Evidence for whoever lands it, never a refusal.
 */
export function reviewFacts(ledger: Ledger, lane: Lane): string[] {
  const { whole, latest, after, over } = reviewRecord(ledger, lane);
  const facts = whole ? [] : ["No review of the whole lane is on record."];
  if (latest && latest.handback.outcome !== "accept") {
    const since = after.length > 0 ? `; ${after.join(", ")} ${after.length === 1 ? "was" : "were"} accepted after it, with no review since.` : ", and nothing was accepted after it.";
    facts.push(`The lane's latest review, ${latest.id}, ended in ${latest.handback.outcome}${since}`);
  }
  for (const entry of over) {
    if (!entry.again) facts.push(`${entry.task} was accepted over ${entry.review}, a review of it that ended in ${entry.outcome}.`);
    else if (!entry.since) facts.push(`${entry.task} was handed back again after ${entry.review}, a review of it that ended in ${entry.outcome}, and accepted with no review since.`);
  }
  return facts;
}

/**
 * Whether reviews asked for changes the record shows no answer to: the lane's latest review, with nothing accepted after
 * it, or a task accepted on the very hand-back its own review did not accept, with no review accepting it since.
 */
export function changesStanding(ledger: Ledger, lane: Lane): boolean {
  const { latest, after, over } = reviewRecord(ledger, lane);
  return (latest !== undefined && latest.handback.outcome !== "accept" && after.length === 0) || over.some((entry) => !entry.again && !entry.since);
}

export async function changeOf(project: Project, lane: Lane): Promise<Change> {
  const from = lane.onBranch ? lane.startSha : await mergeBase(project.root, lane.base, lane.branch);
  return { from, files: from ? await changedFiles(project.root, `${from}..${lane.branch}`) : undefined };
}

/** Why landing `change` waits for the Human: the paths it touches that they asked to be asked about first, or orders that cannot be read. */
export function askFirstHits(project: Project, change: Change): string[] {
  const fault = configFault(configFile(project.state));
  if (fault) return [`The Human's standing orders cannot be read (${fault}), so no landing goes ahead without them.`];
  const { askFirst } = loadConfig(project.state);
  if (askFirst.length === 0) return [];
  const files = change.files;
  if (!files) return ["What the lane changed could not be read, so it is not known to stay clear of what the Human asked to be asked about first."];
  return askFirst.flatMap((path) => {
    const cover = coverOf(path);
    const hit = files.filter((file) => cover.test(file));
    return hit.length > 0 ? [`It changes ${capped(hit, SHOWN)}, under ${path}, which the Human asked to be asked about first.`] : [];
  });
}

/** Work closing a lane would lose: a code task not merged, or a review still reading. A review that handed back its verdict is done. */
export function unfinished(task: Task): boolean {
  return !SETTLED.includes(task.status) && !(task.kind === "review" && task.status === "done");
}

async function changed(root: string, range: string, filter: "D" | "M"): Promise<string[]> {
  const run = await git(root, ["diff", "-z", "--name-only", `--diff-filter=${filter}`, range]);
  return run.stdout.split("\0").filter(Boolean);
}

/**
 * What a lane brings onto its base, read from git and the record rather than from anything a seat said: evidence for whoever
 * lands it and for the Human, never a reason to hold it. `gate` is left out where the gate's own verdict is already given.
 */
export async function landFacts(kit: Kit, project: Project, ledger: Ledger, lane: Lane, change: Change, gate?: LandGate): Promise<string[]> {
  const { root } = project;
  const { from } = change;
  if (!from) return [`What ${lane.branch} changed could not be read from git.`, ...reviewFacts(ledger, lane)];
  const range = `${from}..${lane.branch}`;
  const serial = serialOnlyOf(project, kit).map((rule) => globToRegex(rule));
  const kinds = fileKinds(kit);
  const counts = await diffCounts(root, from, lane.branch, kinds, (path) => serial.some((rule) => rule.test(path)));
  const files = [...new Set(counts?.files ?? [])];
  const lines = counts ? counts.src + counts.test + counts.docs : 0;
  const tests = files.filter((path) => kindOf(path, kinds) === "test");
  const deleted = (await changed(root, range, "D")).filter((path) => kindOf(path, kinds) === "test");
  const weaker: string[] = [];
  for (const path of (await changed(root, range, "M")).filter((file) => kindOf(file, kinds) === "test")) {
    const [before, after] = await Promise.all([from, lane.branch].map(async (ref) => (await git(root, ["show", `${ref}:${path}`])).stdout));
    const how = weakened(before!, after!, testMarkers(kit));
    if (how) weaker.push(`${path}: ${how}.`);
  }
  const tasks = tasksOf(ledger, lane.id);
  const open = Object.values(loadIncidents(project.state).items).filter((incident) => incident.open && incident.lane === lane.id);
  const commits = await commitsAhead(root, from, lane.branch);
  return [
    `${commits === undefined ? "Commits unknown" : plural(commits, "commit")}; ${plural(files.length, "file")}, ${plural(lines, "line")} changed.`,
    ...(!gate ? [] : !gate.set ? ["Gate: none set, so nothing ran the lane's checks."] : [`Gate: ${gate.ok ? "passed" : "failed"} on the lane.`]),
    ...(tests.length > 0 ? [`Tests changed: ${tests.join(", ")}.`] : []),
    ...deleted.map((path) => `${path} is deleted.`),
    ...weaker,
    ...(lane.writeSet.length > 0 ? uncovered(files, lane.writeSet).map((path) => `${path} is outside the lane's write set, ${lane.writeSet.join(", ")}.`) : []),
    ...tasks.filter((task) => task.status === "merged" && task.handback?.gate?.ok === false).map((task) => `${task.id} was accepted over its red gate: ${task.handback!.gate!.note}.`),
    ...tasks.filter(unfinished).map((task) => `${task.id} is ${task.status}: landing cuts it.`),
    ...open.map((incident) => `Incident ${incident.id} on this lane is still open: ${incident.kind}.`),
    ...tasks.filter((task) => task.kind === "review" && task.handback).map((task) => `${task.id} review: ${task.handback!.outcome}.`),
    ...reviewFacts(ledger, lane),
  ];
}
