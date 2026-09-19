import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type SensorSpec, loadKit, sensorProblems } from "../../server/catalog/kit.ts";
import { mask } from "../../server/runtime/watch/mask.ts";
import { Assessor, Pacer, SensorError, assess, readAnswers, stateOf } from "../../server/runtime/watch/sensor.ts";
import { Window } from "../../server/runtime/watch/window.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kit = loadKit(join(here, "..", ".."));
const shipped = Object.values(kit.sensors)[0]!;

const spec = (questions: SensorSpec["questions"], extra: Partial<SensorSpec> = {}): SensorSpec => ({ ...shipped, retries: 2, timeoutSeconds: 1, questions, ...extra });
const noul = (instructions = "q") => ({ instructions, threshold: 0.7, level: "attend" as const });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the response OpenRouter documents for its Decisions endpoint reads as an assessment", () => {
  const documented = JSON.parse(readFileSync(join(here, "..", "fixtures", "decisions-response.json"), "utf-8"));
  assert.deepEqual(readAnswers(documented, spec({ is_bug: noul() })), {
    answers: { is_bug: 0.96 },
    model: "typesafe/jev-1.13-20260917",
    id: "gen-dec-1789738314-X5e5eKGQdvR9rblyX250",
    cost: 0.000019992,
  });
});

test("one answer missing, not a probability, or outside 0 to 1 voids the whole assessment", () => {
  const asked = spec({ a: noul(), b: noul() });
  const body = (b: unknown) => ({ answers: { a: { type: "noul", noul: 0.4 }, ...(b === undefined ? {} : { b }) }, model: "m", id: "i" });
  assert.throws(() => readAnswers(body(undefined), asked), /the answer to b is missing/);
  assert.throws(() => readAnswers(body({ type: "noul", noul: "0.9" }), asked), /the answer to b is not a probability/);
  assert.throws(() => readAnswers(body({ type: "choice", choice: "x" }), asked), /the answer to b is not a probability/);
  assert.throws(() => readAnswers(body({ type: "noul", noul: 1.2 }), asked), /the answer to b is 1.2, outside 0 to 1/);
  assert.deepEqual(readAnswers(body({ type: "noul", noul: 1 }), asked).answers, { a: 0.4, b: 1 });
});

type Reply = { status: number; body?: unknown; retryAfter?: string };

function server(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetcher = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const reply = replies.shift() ?? { status: 500 };
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: (name: string) => (name === "retry-after" ? (reply.retryAfter ?? null) : null) },
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body ?? { error: "x" }),
    };
  };
  return { calls, fetcher };
}

const good = { answers: { a: { type: "noul", noul: 0.9 } }, model: "typesafe/jev-1.13-20260917", id: "gen-1", usage: { cost: 0.00002 } };

test("a busy or failing endpoint is asked again, and a refusal that retrying cannot fix is not", async () => {
  const asked = spec({ a: noul("is it?") });
  const busy = server([{ status: 429, retryAfter: "0.01" }, { status: 503, retryAfter: "0.01" }, { status: 200, body: good }]);
  const assessment = await assess(asked, "sk-or-secret", { goal: "g" }, "seat-1", busy.fetcher as never);
  assert.equal(assessment.answers.a, 0.9);
  assert.equal(busy.calls.length, 3);
  assert.deepEqual(busy.calls[0]!.body, { model: asked.model, state: { goal: "g" }, questions: { a: { type: "noul", instructions: "is it?" } }, session_id: "seat-1" });
  assert.equal(busy.calls[0]!.headers.Authorization, "Bearer sk-or-secret");
  for (const status of [400, 401, 402, 413]) {
    const refused = server([{ status, body: { error: { message: "no" } } }, { status: 200, body: good }]);
    const error = await assess(asked, "sk-or-secret", {}, "seat-1", refused.fetcher as never).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof SensorError && error.status === status, String(status));
    assert.equal(refused.calls.length, 1, `${status} is a setting to fix, not a moment to wait out`);
    assert.doesNotMatch(error.message, /sk-or-secret/);
  }
  const down = server([{ status: 500, retryAfter: "0.01" }, { status: 502, retryAfter: "0.01" }, { status: 503 }, { status: 200, body: good }]);
  await assert.rejects(assess(asked, "k", {}, "s", down.fetcher as never), (error: unknown) => error instanceof SensorError && error.status === 503);
  assert.equal(down.calls.length, 3, "two retries, then it gives up");
});

test("the state leads with the goal, keeps what fits, and carries no secret the seat printed", () => {
  const window = new Window();
  window.add({ item: { type: "user_message", text: "Fix the login bug" }, seq: 1, epoch: "e", turnId: "t", replay: false });
  for (let index = 0; index < 40; index++) {
    window.add({ item: { type: "tool_call", callId: `c${index}`, name: "bash", status: "completed", detail: { type: "shell", command: `cat part${index}.txt`, output: "x".repeat(300) } }, seq: index + 2, epoch: "e", turnId: "t", replay: false });
  }
  window.add({ item: { type: "assistant_message", text: "Set API_KEY=abcd1234efgh5678 and ghp_0123456789abcdefghij done" }, seq: 99, epoch: "e", turnId: "t", replay: false });
  const state = stateOf(window, [{ kind: "stuck", level: "attend", quote: "q" }], { goal: "Task L1-T1: login", role: "Peer" }, 4000);
  assert.deepEqual(Object.keys(state), ["goal", "prompt", "role", "facts", "recent", "final_message"]);
  assert.ok(JSON.stringify(state).length <= 4000);
  const recent = state.recent as string[];
  assert.match(recent[0]!, /^\[… \d+ earlier steps left out …\]$/);
  assert.match(recent.at(-1)!, /^said: /);
  assert.doesNotMatch(JSON.stringify(state), /abcd1234efgh5678|ghp_0123456789/);
  assert.equal(mask("token: hunter2hunter2"), "token: [redacted]");
});

test("pieces arriving close together make one assessment, a steady stream makes one per interval, and never two at once", async () => {
  let runs = 0;
  let inside = 0;
  let most = 0;
  const pacer = new Pacer(30, 90, async () => {
    runs += 1;
    inside += 1;
    most = Math.max(most, inside);
    await wait(40);
    inside -= 1;
  });
  pacer.nudge();
  await wait(10);
  pacer.nudge();
  await wait(10);
  pacer.nudge();
  await wait(60);
  assert.equal(runs, 1, "three nudges inside the quiet window are one assessment");
  await wait(60);
  const steady = runs;
  const started = Date.now();
  while (Date.now() - started < 150) {
    pacer.nudge();
    await wait(10);
  }
  assert.ok(runs - steady >= 1, "a seat that never goes quiet is still assessed");
  pacer.now();
  pacer.now();
  pacer.now();
  await wait(200);
  assert.equal(most, 1, "one assessment at a time");
  pacer.stop();
});

test("the shipped sensor asks only questions it can use, and the kit refuses one that could not be read", () => {
  assert.deepEqual(sensorProblems(shipped.id, shipped as unknown as Record<string, unknown>), []);
  assert.ok(Object.values(shipped.questions).some((question) => question.alone), "some questions stand alone");
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", url: "http://plain" } as never), ["sends its state somewhere that is not https"]);
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", questions: { q: { instructions: "?", threshold: 2, level: "loud", alone: true } } } as never), [
    "asks q with no threshold between 0 and 1",
    "asks q at a level that is neither page nor attend",
  ]);
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", questions: { q: { instructions: "?", threshold: 0.7, level: "attend" } } } as never), [
    "asks q with a threshold or level, though nothing decides on its answer",
  ]);
});

test("a secret is masked before anything is cut, so no part of it survives a clip", () => {
  const window = new Window();
  window.add({ item: { type: "user_message", text: "go" }, seq: 1, epoch: "e", turnId: "t", replay: false });
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(20)}\n-----END OPENSSH PRIVATE KEY-----`;
  window.add({ item: { type: "tool_call", callId: "c", name: "Bash", status: "completed", detail: { type: "shell", command: "cat ~/.ssh/id_ed25519", output: key } }, seq: 2, epoch: "e", turnId: "t", replay: false });
  const state = JSON.stringify(stateOf(window, [], { goal: "g", role: "Peer" }, 8000));
  assert.doesNotMatch(state, /QUJDREVGR0hJSktM/);
  assert.match(state, /\[private key\]/);
});

test("the usual shapes a secret is printed in are masked", () => {
  for (const [text, secret] of [
    ['curl -H "Authorization: Bearer 9f8e7d6c5b4a39281706"', "9f8e7d6c5b4a39281706"],
    ["STRIPE=sk_live_51HxQ2eLkYbq7ZzAbCdEf", "sk_live_51HxQ2eLkYbq7ZzAbCdEf"],
    ['{\\"password\\": \\"Tr0ub4dor&3xyz\\"}', "Tr0ub4dor&3xyz"],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG", "wJalrXUtnFEMI/K7MDENG"],
    ["git clone https://bob:hunter2hunter2@github.com/x/y", "hunter2hunter2"],
  ]) assert.ok(!mask(text).includes(secret), `${text} → ${mask(text)}`);
});

test("an answer whose body never finishes arriving is given up at the timeout", async () => {
  const stalled = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise<unknown>(() => {}), text: async () => "" });
  const started = Date.now();
  await assert.rejects(assess(spec({ a: noul() }, { timeoutSeconds: 0.05, retries: 0 }), "k", {}, "s", stalled as never), /no answer within 0.05 s/);
  assert.ok(Date.now() - started < 1000);
});

test("a response without an id still counts, since the endpoint does not promise one", () => {
  const documented = JSON.parse(readFileSync(join(here, "..", "fixtures", "decisions-response.json"), "utf-8"));
  delete documented.id;
  assert.equal(readAnswers(documented, spec({ is_bug: noul() })).id, null);
});

test("an assessment still in flight when its seat is let go is not recorded", async () => {
  let answer: (value: unknown) => void = () => {};
  const fetcher = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise((resolve) => (answer = resolve)), text: async () => "" });
  const done: string[] = [];
  const watch = { seat: { id: "s1", provider: "p", cwd: "/w" }, window: new Window(), noted: [] } as never;
  const assessor = new Assessor({
    sensing: () => ({ spec: spec({ a: noul() }), key: "k", brief: { goal: "g", role: "Peer" } }),
    done: () => done.push("done"),
    failed: () => done.push("failed"),
    fetcher: fetcher as never,
  });
  assessor.moment(watch, true);
  await wait(10);
  assessor.drop("s1");
  answer({ answers: { a: { type: "noul", noul: 0.9 } }, model: "m" });
  await wait(10);
  assert.deepEqual(done, []);
});
