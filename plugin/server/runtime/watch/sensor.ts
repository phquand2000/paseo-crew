import type { Question, SensorSpec } from "../../catalog/kit.ts";
import { describe, failed, type Fact, sides, TRUNCATED, within } from "./facts.ts";
import { mask } from "./mask.ts";
import type { SeatWatch } from "./watches.ts";
import type { Call, Unit, Window } from "./window.ts";

export type Assessment = { answers: Record<string, number>; model: string; id: string | null; cost: number | null };

export class SensorError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export function readAnswers(body: unknown, spec: Pick<SensorSpec, "questions">): Assessment {
  const held = (body ?? {}) as { answers?: Record<string, { type?: unknown; noul?: unknown }>; model?: unknown; id?: unknown; usage?: { cost?: unknown } };
  const answers: Record<string, number> = {};
  for (const name of Object.keys(spec.questions)) {
    const answer = held.answers?.[name];
    if (!answer) throw new SensorError(`the answer to ${name} is missing`);
    if (answer.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) throw new SensorError(`the answer to ${name} is not a probability`);
    if (answer.noul < 0 || answer.noul > 1) throw new SensorError(`the answer to ${name} is ${answer.noul}, outside 0 to 1`);
    answers[name] = answer.noul;
  }
  if (typeof held.model !== "string") throw new SensorError("the response names no model");
  return { answers, model: held.model, id: typeof held.id === "string" ? held.id : null, cost: typeof held.usage?.cost === "number" ? held.usage.cost : null };
}

function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}

export async function assess(spec: SensorSpec, key: string, state: unknown, session: string, fetcher: Fetch = fetch as unknown as Fetch, halt?: AbortSignal): Promise<Assessment> {
  const questions = Object.fromEntries(Object.entries(spec.questions).map(([name, question]) => [name, { type: "noul", instructions: question.instructions }]));
  const body = JSON.stringify({ model: spec.model, state, questions, session_id: session.slice(0, 256) });
  for (let attempt = 0; ; attempt++) {
    if (halt?.aborted) throw new SensorError("let go");
    const late = AbortSignal.timeout(spec.timeoutSeconds * 1000);
    const signal = halt ? AbortSignal.any([halt, late]) : late;
    let status: number;
    let wait: number | undefined;
    let said = "";
    try {
      const response = await bounded(fetcher(spec.url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal }), signal);
      if (response.ok) {
        const answer = await bounded(response.json(), signal).catch((error: unknown) => {
          throw new SensorError(late.aborted ? `no answer within ${spec.timeoutSeconds} s` : halt?.aborted ? "let go" : `the answer is not JSON: ${error instanceof Error ? error.message : String(error)}`);
        });
        return readAnswers(answer, spec);
      }
      status = response.status;
      const after = Number(response.headers.get("retry-after"));
      if (Number.isFinite(after) && after > 0) wait = Math.min(after, 10) * 1000;
      said = await bounded(response.text(), signal).catch(() => "");
    } catch (error) {
      if (error instanceof SensorError) throw error;
      if (halt?.aborted) throw new SensorError("let go");
      if (attempt < spec.retries) {
        await pause(500 * 2 ** attempt);
        continue;
      }
      throw new SensorError(late.aborted ? `no answer within ${spec.timeoutSeconds} s` : `unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= spec.retries) throw new SensorError(`${status}: ${said.replace(/\s+/g, " ").slice(0, 200)}`, status);
    await pause(wait ?? 500 * 2 ** attempt);
  }
}

const clip = (text: string, limit: number) => (text.length > limit ? `${within(text, limit)}…` : text);
const tail = (text: string, limit: number) => (text.length > limit ? `…${text.slice(-limit).replace(/^[\uDC00-\uDFFF]/, "")}` : text);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const held = error as { content?: unknown; message?: unknown; text?: unknown };
  for (const value of [held.content, held.message, held.text]) if (typeof value === "string") return value;
  return JSON.stringify(error);
}

const BASE64_RUN = /^[A-Za-z0-9+/=]{40,}$/;

function linesOf(text: string): string[] {
  const body = text.replace(/\n$/, "");
  return body ? body.split("\n") : [];
}

const shown = (rows: string[]) => rows.map((row) => flat(row)).find((row) => row && !BASE64_RUN.test(row));

function changed(call: Call): string {
  const detail = call.detail;
  const diff = str(detail.unifiedDiff);
  const rows = diff.split("\n");
  const cut = diff !== "" && TRUNCATED.test(rows.at(-1)!);
  const both = sides(diff ? { ...detail, unifiedDiff: mask(cut ? rows.slice(0, -2).join("\n") : diff) } : detail);
  const note = cut ? " (diff cut short)" : "";
  if (!both) {
    const written = linesOf(mask(str(detail.content)));
    const first = shown(written);
    return written.length > 0 ? ` wrote ${written.length} lines${first ? `: ${clip(first, 120)}` : ""}` : "";
  }
  const [before, after] = both.map((text) => linesOf(mask(text)));
  const left = new Map<string, number>();
  for (const row of before!) left.set(row, (left.get(row) ?? 0) + 1);
  const added: string[] = [];
  for (const row of after!) {
    const held = left.get(row) ?? 0;
    if (held > 0) left.set(row, held - 1);
    else added.push(row);
  }
  const removed = [...left.values()].reduce((sum, held) => sum + held, 0);
  if (added.length === 0 && removed === 0) return note;
  const first = shown(added);
  return ` +${added.length} -${removed}${note}${first ? `: ${clip(first, 120)}` : ""}`;
}

function line(unit: Unit, exit?: RegExp): string {
  if (unit.kind === "call") {
    const call = unit.call;
    const bad = call.ended && failed(call, exit);
    const code = typeof call.detail.exitCode === "number" && call.detail.exitCode !== 0 ? `, exit ${call.detail.exitCode}` : "";
    const head = `${clip(flat(mask(describe(call))), 150)} [${!call.ended ? "running" : bad ? "failed" : call.status}${code}]`;
    if ((call.detail.type === "edit" || call.detail.type === "write") && !bad) return `${head}${changed(call)}`;
    const output = flat(mask(str(call.detail.output) || errorText(call.error)));
    return output ? `${head} → ${tail(output, 250)}` : head;
  }
  if (unit.kind === "said") return `said: ${clip(flat(mask(unit.text)), 400)}`;
  if (unit.kind === "thought") return `thought: ${clip(flat(mask(unit.text)), 300)}`;
  if (unit.kind === "user") return `told: ${clip(flat(mask(unit.text)), 300)}`;
  if (unit.kind === "error") return `error: ${clip(flat(mask(unit.text)), 300)}`;
  return "context compacted";
}

export type Brief = { goal: string; role: string; exit?: RegExp };

export const NO_GOAL = "none recorded: this seat has no task or lane in the ledger";

export const STATE_FIELDS = ["goal", "prompt", "role", "facts", "recent", "final_message"] as const;

export const LEAST_STATE_CHARS = 1000;

const size = (value: unknown) => JSON.stringify(value).length;
const leftOut = (count: number) => `[… ${count} earlier step${count === 1 ? "" : "s"} left out …]`;
const RANK: Record<Fact["level"], number> = { page: 0, attend: 1, note: 2 };

export function stateOf(window: Window, noted: Fact[], brief: Brief, limit: number): { state: Record<string, unknown>; sent: Fact[] } {
  const units = window.sinceInstruction();
  let end = units.length;
  while (end > 0 && units[end - 1]!.kind === "thought") end -= 1;
  const closing = units[end - 1]?.kind === "said" ? units[end - 1] : undefined;
  const steps = units.filter((unit) => unit !== closing).map((unit) => line(unit, brief.exit));
  const lost = window.lostSinceInstruction();
  const share = (part: number) => Math.floor(limit * part);
  const picked: { fact: Fact; index: number; text: string }[] = [];
  let room = share(0.1);
  const ranked = noted.map((fact, index) => ({ fact, index })).sort((a, b) => RANK[a.fact.level] - RANK[b.fact.level] || b.index - a.index);
  for (const { fact, index } of ranked) {
    const text = clip(mask(`${fact.kind}: ${fact.quote}`), 240);
    if (size(text) + 1 > room) continue;
    room -= size(text) + 1;
    picked.push({ fact, index, text });
  }
  const inOrder = () => [...picked].sort((a, b) => a.index - b.index);
  const fields = {
    goal: brief.goal.trim() ? clip(mask(brief.goal), share(0.15)) : NO_GOAL,
    prompt: clip(flat(mask(window.lastInstruction())), share(0.1)),
    role: clip(brief.role, share(0.05)),
    facts: inOrder().map((item) => item.text),
    final_message: closing?.kind === "said" ? clip(flat(mask(closing.text)), share(0.1)) : "",
  };
  const floor = () => size({ ...fields, recent: steps.length + lost > 0 ? [leftOut(steps.length + lost)] : [] });
  while (floor() > limit) {
    if (picked.length > 0) {
      picked.pop();
      fields.facts = inOrder().map((item) => item.text);
      continue;
    }
    const shrinkable = (["final_message", "goal", "prompt", "role"] as const).filter((key) => fields[key] !== "" && fields[key] !== NO_GOAL);
    if (shrinkable.length === 0) break;
    const largest = shrinkable.reduce((a, b) => (size(fields[b]) > size(fields[a]) ? b : a));
    fields[largest] = fields[largest].length <= 2 ? "" : clip(fields[largest], Math.floor(fields[largest].length / 2));
  }
  room = limit - size({ ...fields, recent: [] });
  const kept: string[] = [];
  for (let index = steps.length - 1; index >= 0; index--) {
    const cost = size(steps[index]) + 1;
    const reserve = index + lost > 0 ? size(leftOut(index + lost)) + 1 : 0;
    if (cost + reserve > room) break;
    kept.unshift(steps[index]!);
    room -= cost;
  }
  const dropped = lost + steps.length - kept.length;
  return {
    state: { goal: fields.goal, prompt: fields.prompt, role: fields.role, facts: fields.facts, recent: dropped > 0 ? [leftOut(dropped), ...kept] : kept, final_message: fields.final_message },
    sent: inOrder().map((item) => item.fact),
  };
}

const blank = (value: unknown) => value === undefined || value === "" || value === NO_GOAL || (Array.isArray(value) && value.length === 0);

export function asked(questions: Record<string, Question>, state: Record<string, unknown>): Record<string, Question> {
  return Object.fromEntries(Object.entries(questions).filter(([, question]) => !question.needs || question.needs.some((field) => !blank(state[field]))));
}

export class Pacer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waitingSince = 0;
  private running = false;
  private again = false;
  private stopped = false;
  readonly halt = new AbortController();
  private readonly quiet: number;
  private readonly most: number;
  private readonly run: () => Promise<void>;

  constructor(quietMs: number, mostMs: number, run: () => Promise<void>) {
    this.quiet = quietMs;
    this.most = mostMs;
    this.run = run;
  }

  nudge(now = Date.now()): void {
    if (this.stopped) return;
    if (!this.timer) this.waitingSince = now;
    const at = Math.min(now + this.quiet, this.waitingSince + this.most);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), Math.max(0, at - now));
    this.timer.unref?.();
  }

  now(): void {
    if (this.stopped) return;
    this.fire();
  }

  stop(): void {
    this.stopped = true;
    this.halt.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.run()
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
        if (this.again && !this.stopped) {
          this.again = false;
          this.fire();
        }
      });
  }
}

export type Sensing = { spec: SensorSpec; key: string; brief: Brief };

export type Reading = { sensor: string; askedAt: number; turnId: string | null; running: boolean; assessment: Assessment; state: Record<string, unknown>; questions: Record<string, Question>; facts: Fact[] };

export type AssessorDeps = {
  sensing: (watch: SeatWatch) => Sensing | undefined;
  done: (watch: SeatWatch, reading: Reading) => void;
  failed: (watch: SeatWatch, error: SensorError) => void;
  fetcher?: Fetch;
};

export class Assessor {
  private readonly deps: AssessorDeps;
  private readonly pacers = new Map<string, Pacer>();

  constructor(deps: AssessorDeps) {
    this.deps = deps;
  }

  moment(watch: SeatWatch, urgent: boolean): void {
    const sensing = this.deps.sensing(watch);
    if (!sensing) return;
    let pacer = this.pacers.get(watch.seat.id);
    if (!pacer) {
      const made: Pacer = new Pacer(sensing.spec.debounceSeconds * 1000, sensing.spec.everySeconds * 1000, () => this.run(watch, made));
      pacer = made;
      this.pacers.set(watch.seat.id, pacer);
    }
    if (urgent) pacer.now();
    else pacer.nudge();
  }

  drop(id: string): void {
    this.pacers.get(id)?.stop();
    this.pacers.delete(id);
  }

  dispose(): void {
    for (const id of [...this.pacers.keys()]) this.drop(id);
  }

  private async run(watch: SeatWatch, pacer: Pacer): Promise<void> {
    const sensing = this.deps.sensing(watch);
    if (!sensing) return;
    const askedAt = Date.now();
    const { turnId, running } = watch;
    const { state, sent: facts } = stateOf(watch.window, [...watch.noted], sensing.brief, sensing.spec.stateChars);
    const questions = asked(sensing.spec.questions, state);
    if (Object.keys(questions).length === 0) return;
    let assessment: Assessment;
    try {
      assessment = await assess({ ...sensing.spec, questions }, sensing.key, state, watch.seat.id, this.deps.fetcher, pacer.halt.signal);
    } catch (error) {
      if (this.pacers.get(watch.seat.id) === pacer) this.deps.failed(watch, error instanceof SensorError ? error : new SensorError(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (this.pacers.get(watch.seat.id) === pacer) this.deps.done(watch, { sensor: sensing.spec.id, askedAt, turnId, running, assessment, state, questions, facts });
  }
}
