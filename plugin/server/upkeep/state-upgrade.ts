import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../core/errors.ts";
import { isRecord } from "../core/json.ts";
import { STATE_VERSION } from "../core/state-version.ts";
import { readJsonFile, writeJson } from "../core/store.ts";

/** Run in order at plugin start, before anything reads a kept file. */
type StateStep = { to: number; machine?: (root: string) => void; project?: (state: string) => void };

const DROPPED_ATTENTION = ["destructive", "reviewsAt", "longTurnMinutes"];

/** State 5 drops the tuning of facts the watch no longer raises, which a strict settings layer would refuse. */
function dropAttention(file: string): void {
  const read = readJsonFile(file);
  if ("absent" in read) return;
  if ("fault" in read) throw new Error(`${file} could not be read: ${read.fault}`);
  if (!isRecord(read.value) || !isRecord(read.value.attention)) return;
  const attention = Object.fromEntries(
    Object.entries(read.value.attention).filter(([key]) => !DROPPED_ATTENTION.includes(key)),
  );
  writeJson(file, { ...read.value, attention });
}

// State 1 is the format 3.0.0 locked. State 2 lets a lane cite the Human for its lines, state 3 a task name the kept
// Peer it starts on, state 4 a task ask for its Peer's plan first, state 5 drops tuning no fact reads, state 6
// keeps a review's findings on its hand-back, state 7 lets the Human set where seats' temp directories go, state 8
// keeps the leases seats hold on what they share, state 9 lets the project set its disk's floors, and state 10 how many
// review rounds ending in changes stop them.
const STEPS: StateStep[] = [
  { to: 2 },
  { to: 3 },
  { to: 4 },
  {
    to: 5,
    machine: (root) => dropAttention(join(root, "settings.json")),
    project: (state) => dropAttention(join(state, "settings.json")),
  },
  { to: 6 },
  { to: 7 },
  { to: 8 },
  { to: 9 },
  { to: 10 },
];

const MACHINE_FILES = ["state.json", "settings.json", "outbox.json", "content.json", "intents.json", "keys.json"];
const PROJECT_FILES = ["ledger.json", "incidents.json", "project.json", "meta.json", "settings.json"];

export const STATE_BACKUP = /^backup-state-\d+-\d{8}-\d{6}$/;

export type StateReport = { upgraded: string[]; failed: { where: string; error: string }[] };

/** One place that carries a number: the machine, whose number is in `state.json`, or a project, whose is in its ledger. */
type Place = {
  where: string;
  dir: string;
  files: string[];
  from: number;
  numbered: boolean;
  run: (step: StateStep) => void;
  stamp: (version: number) => void;
};

/** What a file holds as its format: none is state 1, which every file written before 3.0.0 was in. */
function heldVersion(file: string, of: (value: Record<string, unknown>) => unknown): number | string {
  const read = readJsonFile(file);
  if ("absent" in read) return 1;
  if ("fault" in read) return read.fault;
  const held = isRecord(read.value) ? of(read.value) : undefined;
  if (held === undefined) return 1;
  return typeof held === "number" && Number.isInteger(held)
    ? held
    : `${file} holds ${JSON.stringify(held)} as its state`;
}

function stampOf(now: number): string {
  const digits = new Date(now).toISOString().replace(/\D/g, "").slice(0, 14);
  return `${digits.slice(0, 8)}-${digits.slice(8)}`;
}

/** Set aside first and put back whole when a step throws, so a failed upgrade leaves the place refused, not half-moved. */
function carry(place: Place, steps: StateStep[], current: number, now: number, report: StateReport): void {
  const { where, dir, from } = place;
  if (from > current) {
    const error = `its state is at ${from}, made by a newer Paseo Crew than this one, which reads ${current}`;
    report.failed.push({ where, error });
    return;
  }
  if (from === current) {
    if (!place.numbered) place.stamp(current);
    return;
  }
  const backup = join(dir, `backup-state-${from}-${stampOf(now)}`);
  const kept = place.files.filter((name) => existsSync(join(dir, name)));
  mkdirSync(backup, { recursive: true });
  for (const name of kept) copyFileSync(join(dir, name), join(backup, name));
  try {
    for (let to = from + 1; to <= current; to++) {
      const step = steps.find((entry) => entry.to === to);
      if (!step) throw new Error(`there is no step to state ${to}`);
      place.run(step);
    }
    place.stamp(current);
    report.upgraded.push(`${where}: ${from} → ${current}`);
  } catch (error) {
    for (const name of kept) copyFileSync(join(backup, name), join(dir, name));
    const why = `could not go from state ${from} to ${current}: ${errorText(error)}; its files are as they were, and a copy is in ${backup}`;
    report.failed.push({ where, error: why });
  }
}

function machine(root: string): Place | string {
  const file = join(root, "state.json");
  const from = heldVersion(file, (value) => value.format);
  if (typeof from === "string") return from;
  const read = readJsonFile(file);
  return {
    where: "machine",
    dir: root,
    files: MACHINE_FILES,
    from,
    numbered: "value" in read && isRecord(read.value) && read.value.format !== undefined,
    run: (step) => step.machine?.(root),
    stamp: (format) => writeJson(file, { format }),
  };
}

/** A project with no ledger has no work on record to carry; one that cannot be read is left to the ledger's own refusal. */
function project(state: string, slug: string): Place | string | undefined {
  const file = join(state, "ledger.json");
  const read = readJsonFile(file);
  if (!("value" in read) || !isRecord(read.value)) return undefined;
  const from = heldVersion(file, (value) => value.format);
  if (typeof from === "string") return from;
  return {
    where: slug,
    dir: state,
    files: PROJECT_FILES,
    from,
    numbered: read.value.format !== undefined,
    run: (step) => step.project?.(state),
    // Read again: a step may have rewritten the ledger. `version` is the number builds before 3.0.0 kept, which meant another format.
    stamp: (format) => {
      const carried = readJsonFile(file);
      if (!("value" in carried) || !isRecord(carried.value)) throw new Error(`${file} could not be read once carried`);
      const { version: _earlier, ...kept } = carried.value;
      writeJson(file, { ...kept, format });
    },
  };
}

export function upgradeState(root: string, steps = STEPS, current = STATE_VERSION, now = Date.now()): StateReport {
  const report: StateReport = { upgraded: [], failed: [] };
  if (!existsSync(root)) return report;
  const projects = join(root, "projects");
  const places = [
    ["machine", machine(root)] as const,
    ...(existsSync(projects) ? readdirSync(projects) : []).map(
      (slug) => [slug, project(join(projects, slug), slug)] as const,
    ),
  ];
  for (const [where, place] of places) {
    if (typeof place === "string") report.failed.push({ where, error: place });
    else if (place) carry(place, steps, current, now, report);
  }
  return report;
}
