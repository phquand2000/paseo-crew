import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import type { Seen } from "../../server/core/ports.ts";
import type { StreamMessage } from "../../server/core/stream.ts";
import { DESTRUCTIVE, type Fact, type Rules, SUPPRESSED, TEST_PATH } from "../../server/runtime/watch/facts.ts";
import { SeatWatch } from "../../server/runtime/watch/watches.ts";

const here = dirname(fileURLToPath(import.meta.url));
const kit = loadKit(join(here, "..", ".."));

const fixture = (name: string): StreamMessage[] =>
  readFileSync(join(here, "..", "fixtures", "stream", `${name}.jsonl`), "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const rules = (extra: Partial<Rules> = {}): Rules => ({
  destructive: new RegExp(DESTRUCTIVE, "i"),
  testPath: new RegExp(TEST_PATH, "i"),
  suppressed: new RegExp(SUPPRESSED, "i"),
  repeatsAt: 3,
  recoverWithin: 10,
  ...extra,
});

function toSeen(message: StreamMessage, epochs: Map<string, number>): Seen | undefined {
  const { event } = message;
  if (event.type === "turn_started") return { kind: "turn", phase: "started", turnId: event.turnId ?? null };
  if (event.type === "turn_completed") return { kind: "turn", phase: "completed", turnId: event.turnId ?? null };
  if (event.type !== "timeline" || typeof message.seq !== "number") return undefined;
  if (!epochs.has(message.epoch!)) epochs.set(message.epoch!, epochs.size);
  const replay = epochs.get(message.epoch!)! > 0;
  return { kind: "row", row: { item: event.item!, seq: message.seq, epoch: message.epoch!, turnId: event.turnId ?? null, replay } };
}

function play(messages: StreamMessage[], given: Rules, heard = false) {
  const watch = new SeatWatch({ id: "s1", provider: "sw2-peer-claude", cwd: "/work" }, () => ({ rules: given, heardSince: () => heard, goal: "", role: "Peer" }));
  const facts: (Fact & { seq?: number })[] = [];
  const epochs = new Map<string, number>();
  let now = 1_000;
  for (const message of messages) {
    const fresh = typeof message.epoch === "string" && epochs.size > 0 && !epochs.has(message.epoch);
    const seen = toSeen(message, epochs);
    if (!seen) continue;
    if (fresh) watch.see({ kind: "reset" }, now);
    now += 1_000;
    for (const fact of watch.see(seen, now)) facts.push({ ...fact, seq: message.seq });
  }
  return facts;
}

const kinds = (facts: Fact[]) => facts.map((fact) => fact.kind);

test("a failed shell call is seen on every harness however it says so, once, and never again from a reload's history", () => {
  for (const harness of ["claude", "pi", "codex", "devin"]) {
    const exit = kit.harnesses[harness]?.exitPattern;
    const facts = play(fixture(harness), rules(exit ? { exit: new RegExp(exit) } : {}));
    const failures = facts.filter((fact) => fact.kind === "call-failed");
    assert.equal(failures.length, 1, `${harness}: ${JSON.stringify(facts)}`);
    assert.match(failures[0]!.quote, /cat \.\/does-not-exist\.txt/, harness);
    assert.ok(!kinds(facts).includes("destructive"), harness);
  }
});

test("Devin's failures are visible only through the exit pattern its harness declares", () => {
  assert.deepEqual(kinds(play(fixture("devin"), rules())).filter((kind) => kind === "call-failed"), [], "without the pattern a failed command reads as completed");
});

test("an irreversible command is caught the moment its command is known, before the call finishes, and only once", () => {
  const rewritten = fixture("claude").map((message) => JSON.parse(JSON.stringify(message).replaceAll("sleep 4; echo step-one", "rm -rf build")) as StreamMessage);
  const facts = play(rewritten, rules()).filter((fact) => fact.kind === "destructive");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.level, "page");
  assert.equal(facts[0]!.seq, 3, "Claude's first row for the call has no command; the second has it, and the call is still running");
  const settledAt = rewritten.find((message) => message.event.item?.status === "completed" && JSON.stringify(message).includes("rm -rf build"))!.seq!;
  assert.ok(facts[0]!.seq! < settledAt);
});

const piRow = (seq: number) => fixture("pi").find((message) => message.seq === seq && message.epoch === fixture("pi")[1]!.epoch)!;

function again(message: StreamMessage, callId: string, seq: number, change: (detail: Record<string, unknown>) => void = () => {}): StreamMessage {
  const copy = JSON.parse(JSON.stringify(message)) as StreamMessage;
  copy.event.item!.callId = callId;
  change(copy.event.item!.detail as Record<string, unknown>);
  copy.seq = seq;
  copy.epoch = fixture("pi")[1]!.epoch;
  return copy;
}

const opening = (): StreamMessage[] => [fixture("pi")[0]!, fixture("pi")[1]!];

test("the same action failing three times is stuck", () => {
  const failedCat = piRow(15);
  const messages = [...opening(), again(failedCat, "a", 2), again(failedCat, "b", 3), again(failedCat, "c", 4)];
  const stuck = play(messages, rules()).filter((fact) => fact.kind === "stuck");
  assert.equal(stuck.length, 1);
  assert.match(stuck[0]!.quote, /the same action failing 3 times: bash: cat \.\/does-not-exist\.txt/);
});

test("the same action with the same result four times is stuck, and three is not", () => {
  const done = piRow(11);
  const three = [...opening(), again(done, "a", 2), again(done, "b", 3), again(done, "c", 4)];
  assert.deepEqual(kinds(play(three, rules())).filter((kind) => kind === "stuck"), []);
  const stuck = play([...three, again(done, "d", 5)], rules()).filter((fact) => fact.kind === "stuck");
  assert.match(stuck[0]!.quote, /the same action with the same result 4 times: bash: sleep 4; echo step-one/);
});

test("alternating between two actions three times is stuck", () => {
  const done = piRow(11);
  const other = (callId: string, seq: number) => again(done, callId, seq, (detail) => (detail.command = "ls"));
  const messages = [...opening(), again(done, "a", 2), other("b", 3), again(done, "c", 4), other("d", 5), again(done, "e", 6), other("f", 7)];
  const stuck = play(messages, rules()).filter((fact) => fact.kind === "stuck");
  assert.match(stuck[0]!.quote, /alternating between two actions 3 times/);
});

test("saying the same thing three times with nothing done between is stuck", () => {
  const said = fixture("pi").find((message) => message.event.item?.type === "assistant_message")!;
  const say = (seq: number, id: string) => {
    const copy = JSON.parse(JSON.stringify(said)) as StreamMessage;
    copy.event.item = { ...copy.event.item!, messageId: id, text: "Let me check the file again." };
    copy.seq = seq;
    return copy;
  };
  const stuck = play([...opening(), say(2, "m1"), say(3, "m2"), say(4, "m3"), again(piRow(11), "x", 5)], rules()).filter((fact) => fact.kind === "stuck");
  assert.match(stuck[0]!.quote, /the same words 3 times/);
});

test("a failure the seat has not climbed out of in ten steps is noticed, and a pass of the same command ends it", () => {
  const failedCat = piRow(15);
  const done = piRow(11);
  const steps = (count: number, from: number) => Array.from({ length: count }, (_, index) => again(done, `ok-${from + index}`, from + index, (detail) => (detail.command = `echo ${index}`)));
  const lost = play([...opening(), again(failedCat, "bad", 2), ...steps(10, 3)], rules()).filter((fact) => fact.kind === "no-recovery");
  assert.equal(lost.length, 1);
  const cured = again(failedCat, "good", 3, (detail) => Object.assign(detail, { exitCode: 0, output: "hello" }));
  const recovered = play([...opening(), again(failedCat, "bad", 2), { ...cured, event: { ...cured.event, item: { ...cured.event.item!, status: "completed" } } }, ...steps(10, 4)], rules());
  assert.deepEqual(kinds(recovered).filter((kind) => kind === "no-recovery"), []);
});

test("an edit that takes assertions out of a test, or silences a check, is noticed when it lands", () => {
  const edit = fixture("devin").find((message) => message.event.item?.type === "tool_call" && message.event.item?.name === "edit" && message.event.item?.status === "completed")!;
  const weakened = again(edit, "e1", 2, (detail) =>
    Object.assign(detail, { filePath: "test/strings.test.ts", oldString: "assert.equal(a, 1);\nassert.equal(b, 2);", newString: "assert.equal(a, 1);" }),
  );
  const silenced = again(edit, "e2", 3, (detail) => Object.assign(detail, { filePath: "src/a.ts", oldString: "const x = f();", newString: "// @ts-ignore\nconst x = f();" }));
  const facts = play([...opening(), weakened, silenced], rules());
  assert.deepEqual(
    facts.filter((fact) => fact.level === "attend").map((fact) => [fact.kind, fact.quote]),
    [
      ["test-weakened", "test/strings.test.ts: 2 assertions become 1"],
      ["suppressed", "src/a.ts: adds @ts-ignore"],
    ],
  );
});

test("a turn that reports having written files the gate never saw afterwards is unverified, and one that ran it is not", () => {
  const edit = fixture("devin").find((message) => message.event.item?.type === "tool_call" && message.event.item?.name === "edit" && message.event.item?.status === "completed")!;
  const wrote = again(edit, "w", 2, (detail) => Object.assign(detail, { filePath: "src/a.ts" }));
  const gate = again(piRow(11), "g", 3, (detail) => Object.assign(detail, { command: "npm test" }));
  const start: StreamMessage = { event: { type: "turn_started", turnId: "t" } };
  const end: StreamMessage = { event: { type: "turn_completed", turnId: "t" } };
  const skipped = play([start, ...opening(), wrote, end], rules({ gate: "npm test" }), true);
  assert.deepEqual(kinds(skipped).filter((kind) => kind === "unverified"), ["unverified"]);
  assert.deepEqual(kinds(play([start, ...opening(), wrote, gate, end], rules({ gate: "npm test" }), true)).filter((kind) => kind === "unverified"), []);
  assert.deepEqual(kinds(play([start, ...opening(), wrote, end], rules({ gate: "npm test" }), false)).filter((kind) => kind === "unverified"), [], "a turn that reported nothing claimed nothing");
});
