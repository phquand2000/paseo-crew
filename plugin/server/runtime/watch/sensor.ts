import type { SensorSpec } from "../../catalog/kit.ts";
import { describe, failed, type Fact } from "./facts.ts";
import { mask } from "./mask.ts";
import type { SeatWatch } from "./watches.ts";
import type { Unit, Window } from "./window.ts";

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

export function readAnswers(body: unknown, spec: SensorSpec): Assessment {
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

export async function assess(spec: SensorSpec, key: string, state: unknown, session: string, fetcher: Fetch = fetch as unknown as Fetch): Promise<Assessment> {
  const questions = Object.fromEntries(Object.entries(spec.questions).map(([name, question]) => [name, { type: "noul", instructions: question.instructions }]));
  const body = JSON.stringify({ model: spec.model, state, questions, session_id: session.slice(0, 256) });
  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(spec.timeoutSeconds * 1000);
    let status: number;
    let wait: number | undefined;
    let said = "";
    try {
      const response = await bounded(fetcher(spec.url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body, signal }), signal);
      if (response.ok) return readAnswers(await bounded(response.json(), signal), spec);
      status = response.status;
      const after = Number(response.headers.get("retry-after"));
      if (Number.isFinite(after) && after > 0) wait = Math.min(after, 10) * 1000;
      said = await bounded(response.text(), signal).catch(() => "");
    } catch (error) {
      if (error instanceof SensorError) throw error;
      if (attempt < spec.retries) {
        await pause(500 * 2 ** attempt);
        continue;
      }
      throw new SensorError(signal.aborted ? `no answer within ${spec.timeoutSeconds} s` : `unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= spec.retries) throw new SensorError(`${status}: ${said.replace(/\s+/g, " ").slice(0, 200)}`, status);
    await pause(wait ?? 500 * 2 ** attempt);
  }
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

function errorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const held = error as { content?: unknown; message?: unknown; text?: unknown };
  for (const value of [held.content, held.message, held.text]) if (typeof value === "string") return value;
  return JSON.stringify(error);
}

function line(unit: Unit, exit?: RegExp): string {
  if (unit.kind === "call") {
    const call = unit.call;
    const outcome = !call.ended ? "running" : failed(call, exit) ? "failed" : call.status;
    const output = typeof call.detail.output === "string" ? call.detail.output : errorText(call.error);
    return clip(flat(mask(`${describe(call)} [${outcome}]${output ? ` → ${output}` : ""}`)), 400);
  }
  if (unit.kind === "said") return `said: ${clip(flat(mask(unit.text)), 400)}`;
  if (unit.kind === "thought") return `thought: ${clip(flat(mask(unit.text)), 300)}`;
  if (unit.kind === "user") return `told: ${clip(flat(mask(unit.text)), 300)}`;
  if (unit.kind === "error") return `error: ${clip(flat(mask(unit.text)), 300)}`;
  return "context compacted";
}

export type Brief = { goal: string; role: string; exit?: RegExp };

export function stateOf(window: Window, noted: Fact[], brief: Brief, limit: number): Record<string, unknown> {
  const units = window.sinceInstruction().slice(-30);
  const last = [...units].reverse().find((unit) => unit.kind === "said");
  const steps = units.map((unit) => line(unit, brief.exit));
  let recent = steps;
  const state = () => ({
    goal: clip(mask(brief.goal), 2000),
    prompt: clip(flat(mask(window.lastInstruction())), 1000),
    role: brief.role,
    facts: noted.map((fact) => `${fact.kind}: ${fact.quote}`),
    recent,
    final_message: last?.kind === "said" ? clip(flat(mask(last.text)), 1500) : "",
  });
  for (let from = 1; JSON.stringify(state()).length > limit && from < steps.length; from++) {
    recent = [`[… ${from} earlier step${from === 1 ? "" : "s"} left out …]`, ...steps.slice(from)];
  }
  return state();
}

export class Pacer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waitingSince = 0;
  private running = false;
  private again = false;
  private stopped = false;
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

export type AssessorDeps = {
  sensing: (watch: SeatWatch) => Sensing | undefined;
  done: (watch: SeatWatch, assessment: Assessment, state: Record<string, unknown>) => void;
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
    const state = stateOf(watch.window, watch.noted, sensing.brief, sensing.spec.stateChars);
    let assessment: Assessment;
    try {
      assessment = await assess(sensing.spec, sensing.key, state, watch.seat.id, this.deps.fetcher);
    } catch (error) {
      if (this.pacers.get(watch.seat.id) === pacer) this.deps.failed(watch, error instanceof SensorError ? error : new SensorError(error instanceof Error ? error.message : String(error)));
      return;
    }
    if (this.pacers.get(watch.seat.id) === pacer) this.deps.done(watch, assessment, state);
  }
}
