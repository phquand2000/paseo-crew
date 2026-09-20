import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type SensorSpec, loadKit, sensorProblems } from "../../server/catalog/kit.ts";
import { mask } from "../../server/runtime/watch/mask.ts";
import { Assessor, NO_GATE, NO_GOAL, Pacer, SensorError, assess, readAnswers, stateOf } from "../../server/runtime/watch/sensor.ts";
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
  const state = stateOf(window, { goal: "Task L1-T1: login", role: "Peer", gate: "npm test", turn: "ended" }, 4000);
  assert.deepEqual(Object.keys(state), ["goal", "prompt", "role", "gate", "turn", "recent", "final_message"]);
  assert.equal(state.gate, "npm test");
  assert.ok(JSON.stringify(state).length <= 4000);
  const recent = state.recent as string[];
  assert.match(recent[0]!, /^\[… \d+ earlier steps left out …\]$/);
  assert.match(recent.at(-1)!, /^bash: cat part39\.txt/, "the words the turn ends on are the final message, not a step as well");
  assert.match(state.final_message as string, /^Set API_KEY=/);
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
    "asks q with a level, though it opens no incident of its own",
    "asks q with a threshold, though nothing decides on its answer",
  ]);
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", questions: { q: { instructions: "?", threshold: 0.7, confirms: ["destructive"], criteria: { true: "yes" } } } } as never), [
    "asks q with criteria that are not a true and a false text",
    "asks q with confirms that is not a list of attention-level fact kinds",
  ]);
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", unclaer: 0.2, questions: { q: { instructions: "?", criterion: { true: "a", false: "b" }, criteria: null } } } as never), [
    "has unclaer, which a sensor does not take",
    "asks q with criterion, which a question does not take",
    "asks q with criteria that are not a true and a false text",
  ], "a misspelt key is refused, not silently dropped");
});

test("a secret is masked before anything is cut, so no part of it survives a clip", () => {
  const window = new Window();
  window.add({ item: { type: "user_message", text: "go" }, seq: 1, epoch: "e", turnId: "t", replay: false });
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----\n${"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo".repeat(20)}\n-----END OPENSSH PRIVATE KEY-----`;
  window.add({ item: { type: "tool_call", callId: "c", name: "Bash", status: "completed", detail: { type: "shell", command: "cat ~/.ssh/id_ed25519", output: key } }, seq: 2, epoch: "e", turnId: "t", replay: false });
  const state = JSON.stringify(stateOf(window, { goal: "g", role: "Peer", turn: "running" }, 8000));
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
    sensing: () => ({ spec: spec({ a: noul() }), key: "k", brief: { goal: "g", role: "Peer", turn: "running" as const } }),
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

test("ordinary words and identifiers that look like secret names are left alone", () => {
  for (const text of ["maxTokens: 12345678", "const pk_order_line_items_id = 3", "Basic auth is enabled on staging", "tokenizer=cl100k_base"]) assert.equal(mask(text), text, text);
});

test("an answer that is not JSON is not paid for again", async () => {
  const replies = server([{ status: 200 }, { status: 200, body: good }]);
  const broken = async (url: string, init: never) => ({ ...(await replies.fetcher(url, init)), json: async () => { throw new SyntaxError("Unexpected token <"); } });
  await assert.rejects(assess(spec({ a: noul() }), "k", {}, "s", broken as never), /the answer is not JSON/);
  assert.equal(replies.calls.length, 1);
});

test("letting a seat go stops the request it has in flight", async () => {
  let seen: AbortSignal | undefined;
  const fetcher = async (_url: string, init: { signal: AbortSignal }) => {
    seen = init.signal;
    return new Promise<never>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  };
  const watch = { seat: { id: "s1", provider: "p", cwd: "/w" }, window: new Window(), noted: [] } as never;
  const assessor = new Assessor({ sensing: () => ({ spec: spec({ a: noul() }, { timeoutSeconds: 5 }), key: "k", brief: { goal: "g", role: "Peer", turn: "running" as const } }), done: () => {}, failed: () => {}, fetcher: fetcher as never });
  assessor.moment(watch, true);
  await wait(10);
  assessor.drop("s1");
  await wait(10);
  assert.equal(seen?.aborted, true);
});

const row = (item: Record<string, unknown>, seq: number) => ({ item, seq, epoch: "e", turnId: "t", replay: false });
const shell = (id: string, command: string, extra: Record<string, unknown> = {}) => ({ type: "tool_call", callId: id, name: "Bash", status: "completed", detail: { type: "shell", command, output: "ok", ...extra } });

test("a turn longer than the window still carries the instruction it serves, and says how many steps it no longer holds", () => {
  const window = new Window();
  window.add(row({ type: "user_message", text: "Rename the config loader" }, 1));
  for (let index = 0; index < 85; index++) window.add(row(shell(`c${index}`, `ls dir${index}`), index + 2));
  const state = stateOf(window, { goal: "", role: "Peer", turn: "running" }, 8000);
  assert.equal(state.prompt, "Rename the config loader");
  assert.equal(state.goal, NO_GOAL, "an empty goal is said to be empty, not left for the reader to take as anything goes");
  assert.equal((state.recent as string[])[0], "[… 5 earlier steps left out …]", "the steps the window let go of are counted");
  window.add(row({ type: "user_message", text: "Now update the docs" }, 200));
  window.add(row(shell("d1", "ls docs"), 201));
  assert.deepEqual(stateOf(window, { goal: "g", role: "Peer", turn: "running" }, 8000).recent, ["Bash: ls docs [completed] → ok"]);
});

test("the cap holds, most of it goes to what the seat did, and none of it is what the code concluded", () => {
  const window = new Window();
  window.add(row({ type: "user_message", text: "Fix the parser" }, 1));
  for (let index = 0; index < 26; index++) window.add(row(shell(`c${index}`, `grep -rn "token${index}" src/parser`, { output: "src/parser/lex.ts:12: const token = next();".repeat(3) }), index + 2));
  const goal = `Task L1-T1: parser\nGoal: ${'"quoted" and\n'.repeat(200)}`;
  for (const limit of [8000, 3000, 1000]) {
    const state = stateOf(window, { goal, role: "Peer: carries out one task", gate: "npm run check ".repeat(40), turn: "running" }, limit);
    assert.ok(JSON.stringify(state).length <= limit, `${JSON.stringify(state).length} > ${limit}`);
    assert.ok(JSON.stringify(state.recent).length > limit / 2, "what the seat did has the larger share");
    assert.match((state.recent as string[]).at(-1)!, /token25/, "the newest step is always kept");
  }
  assert.equal((stateOf(window, { goal, role: "Peer", turn: "running" }, 8000).recent as string[]).length, 26, "at the shipped size nothing the seat did in this turn is left out");
  assert.equal(stateOf(window, { goal, role: "Peer", turn: "running" }, 8000).gate, NO_GATE);
  assert.deepEqual(sensorProblems("x", { ...shipped, id: "x", stateChars: 100 } as never), ["sends a state of fewer than 1000 characters, too few to say anything"]);
});

test("what a step did reaches the state: the end of what it printed, its error when it printed nothing, and what an edit changed, with no key in it", () => {
  const window = new Window();
  window.add(row({ type: "user_message", text: "go" }, 1));
  const edit = (id: string, detail: Record<string, unknown>) => ({ type: "tool_call", callId: id, name: "Edit", status: "completed", detail: { type: "edit", filePath: "src/a.ts", ...detail } });
  const body = "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDnewnewnewnew1";
  window.add(row(shell("c1", "npm test", { output: `${"😀".repeat(2000)} FAIL: expected 3 got 4`, exitCode: 1 }), 2));
  window.add(row({ type: "tool_call", callId: "c2", name: "Bash", status: "failed", detail: { type: "shell", command: "cat /root/x", output: "" }, error: { message: "permission denied" } }, 3));
  window.add(row(edit("c3", { oldString: "const a = 1;\nconst b = 2;", newString: "const a = 1;\nconst b = 3;\nconst c = 4;" }), 4));
  window.add(row(edit("c4", { unifiedDiff: "--- a/q.sql\n+++ b/q.sql\n@@ -1,4 +1,1 @@\n--- drop table users;\n--- drop table orders;\n+++i;\n SELECT 1;" }), 5));
  window.add(row(edit("c5", { unifiedDiff: "--- a/k.pem\n+++ b/k.pem\n@@ -1,3 +1,3 @@\n -----BEGIN PRIVATE KEY-----\n-MIIEvQold\n+" + body + "\n -----END PRIVATE KEY-----" }), 6));
  window.add(row(edit("c6", { oldString: "MIIEvQold", newString: body }), 7));
  window.add(row(edit("c7", { unifiedDiff: `diff --git a/src/gen.ts b/src/gen.ts\n--- /dev/null\n+++ b/src/gen.ts\n${"+export const x = 1;\n".repeat(500)}...[truncated 900 chars]` }), 8));
  window.add(row(edit("c8", { unifiedDiff: "  1 const a = 1;\n- 2 const b = 2;\n+ 2 const b = 2 * y;" }), 9));
  window.add(row({ type: "tool_call", callId: "c9", name: "Write", status: "completed", detail: { type: "write", filePath: "src/b.ts", content: "export const a = 1;\nexport const b = 2;\n" } }, 10));
  window.add(row({ type: "tool_call", callId: "c10", name: "mcp__team__done", status: "completed", detail: { type: "unknown", input: { summary: "Parser fixed; all tests pass", token: "hunter2hunter2" }, output: null } }, 11));
  const state = stateOf(window, { goal: "g", role: "Peer", turn: "ended" }, 8000);
  const recent = state.recent as string[];
  assert.match(recent[0]!, /^Bash: npm test \[failed, exit 1\] → …(😀)+ FAIL: expected 3 got 4$/);
  assert.doesNotMatch(JSON.stringify(state), /\\ud[89a-f]/i, "no character is cut in half");
  assert.equal(recent[1], "Bash: cat /root/x [failed] → permission denied");
  assert.equal(recent[2], "Edit: src/a.ts [completed] +2 -1: const b = 3;");
  assert.equal(recent[3], "Edit: src/a.ts [completed] +1 -2: ++i;", "a line of content that starts like a diff header is content");
  assert.doesNotMatch(JSON.stringify(state), /MIIEvgIBAD/, "a key's body is never shown, whether or not its header came with it");
  assert.match(recent[6]!, /^Edit: src\/a\.ts \[completed\] \+\d+ -0 \(diff cut short\): export const x = 1;$/);
  assert.equal(recent[7], "Edit: src/a.ts [completed] +1 -1: const b = 2 * y;");
  assert.equal(recent[8], "Write: src/b.ts [completed] wrote 2 lines: export const a = 1;");
  assert.equal(recent[9], 'mcp__team__done {"summary":"Parser fixed; all tests pass","token":"[redacted]"} [completed]', "what a seat handed to a tool with no command or path is what it said");
});

test("a question that reads only what is empty is not asked, and not paid for", async () => {
  const bodies: { questions: Record<string, unknown> }[] = [];
  const fetcher = async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { questions: Record<string, unknown> };
    bodies.push(body);
    const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { type: "noul", noul: 0.1 }]));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ answers, model: "m" }), text: async () => "" };
  };
  const readings: string[][] = [];
  let turn: "running" | "ended" = "running";
  let goal = "";
  const window = new Window();
  const watch = { seat: { id: "s1", provider: "p", cwd: "/w" }, window, noted: [] } as never;
  const assessor = new Assessor({
    sensing: () => ({ spec: shipped, key: "k", brief: { goal, role: "Peer", turn } }),
    done: (_watch, reading) => readings.push(Object.keys(reading.questions)),
    failed: () => {},
    fetcher: fetcher as never,
  });
  window.add(row(shell("c1", "ls"), 1));
  assessor.moment(watch, true);
  await wait(20);
  const needing = Object.entries(shipped.questions).filter(([, question]) => question.needs).map(([name]) => name);
  assert.ok(needing.includes("goal_drift") && needing.includes("unverified_success"));
  assert.deepEqual(Object.keys(bodies[0]!.questions), Object.keys(shipped.questions).filter((name) => !needing.includes(name)));
  assert.deepEqual(readings[0], Object.keys(bodies[0]!.questions), "the decision is made on what was asked");
  assert.deepEqual((bodies[0]!.questions.needs_human as { criteria: unknown }).criteria, shipped.questions.needs_human!.criteria, "a question's criteria go with it");
  window.add(row({ type: "user_message", text: "Fix it" }, 2));
  window.add(row({ type: "assistant_message", text: "Fixed, all tests pass", messageId: "m1" }, 3));
  assessor.moment(watch, true);
  await wait(20);
  assert.ok(!("unverified_success" in bodies[1]!.questions), "words said while the turn still runs are not its final message");
  turn = "ended";
  assessor.moment(watch, true);
  await wait(20);
  // A question is held back only when everything it reads is blank, so one that also reads the
  // instruction comes back as soon as there is one, with or without a goal.
  const thin = Object.keys(bodies[0]!.questions);
  assert.ok(Object.keys(shipped.questions).length > thin.length, "a seat with neither an instruction nor a goal is asked less than everything");
  assert.deepEqual(Object.keys(bodies[2]!.questions), Object.keys(shipped.questions), "a turn that has ended, with an instruction, brings every question back");
  goal = "Totals reflect the discount code";
  assessor.moment(watch, true);
  await wait(20);
  assert.deepEqual(Object.keys(bodies[3]!.questions), Object.keys(shipped.questions), "and so does a seat that has a goal as well");
  assessor.dispose();
});

test("a decision is made on the facts noted when the state was taken, whatever the seat noted while the answer was on its way", async () => {
  let answer: (value: unknown) => void = () => {};
  const fetcher = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: () => new Promise((resolve) => (answer = resolve)), text: async () => "" });
  const noted = [{ kind: "destructive", level: "page" as const, quote: "rm -rf build" }];
  const watch = { seat: { id: "s1", provider: "p", cwd: "/w" }, window: new Window(), noted } as never;
  const readings: { facts: string[] }[] = [];
  const assessor = new Assessor({
    sensing: () => ({ spec: spec({ a: noul() }), key: "k", brief: { goal: "g", role: "Peer", turn: "running" as const } }),
    done: (_watch, reading) => readings.push({ facts: reading.facts.map((fact) => fact.kind) }),
    failed: () => {},
    fetcher: fetcher as never,
  });
  assessor.moment(watch, true);
  await wait(10);
  noted.length = 0;
  noted.push({ kind: "outside-scope", level: "note" as never, quote: "/etc/hosts" });
  answer({ answers: { a: { type: "noul", noul: 0.9 } }, model: "m" });
  await wait(10);
  assert.deepEqual(readings, [{ facts: ["destructive"] }]);
  assessor.dispose();
});
