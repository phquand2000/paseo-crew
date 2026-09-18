import assert from "node:assert/strict";
import { test } from "node:test";
import { read } from "../../server/runtime/risks.ts";

const call = (detail: Record<string, unknown>) => ({ type: "tool_call", name: "tool", status: "completed", error: null, detail });
const said = (text: string) => ({ type: "assistant_message", text });
const turn = (...items: unknown[]) => [{ type: "user_message", text: "go" }, ...items] as never;

const GATE = "npm test";
const gateRun = () => call({ type: "shell", command: "npm test" });

test("a turn that did the work and ran the gate raises nothing", () => {
  const reading = read(
    turn(call({ type: "read", filePath: "src/strings.js" }), call({ type: "edit", filePath: "src/strings.js" }), gateRun(), said("Added truncate and committed it.")),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, [], "a healthy turn is the common case and must score nothing");
  assert.equal(reading.score, 0);
});

test("one action recorded twice as it ran and then finished is counted once", () => {
  const started = { type: "tool_call", callId: "c1", name: "tool", status: "running", error: null, detail: { type: "edit", filePath: "src/a.js" } };
  const finished = { ...started, status: "completed" };
  const second = { ...started, callId: "c2", status: "completed" };
  const reading = read(turn(started, finished, second, gateRun()), { gate: GATE, recorded: true });
  assert.deepEqual(reading.signals, [], "two edits and one duplicate record of the first are not three passes over the file");
});

test("a clean turn still carries a record of what it did", () => {
  const reading = read(
    turn(call({ type: "read", filePath: "src/strings.js" }), call({ type: "edit", filePath: "src/strings.js" }), gateRun(), said("Added pad and committed it.")),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, [], "nothing is wrong with this turn");
  assert.ok(reading.record.length > 0, "a turn with no fault is still a turn the Watcher must be able to see");
  assert.ok(
    reading.record.some((line) => line.includes("npm test: 1 run")),
    `the record says plainly whether the gate ran: ${JSON.stringify(reading.record)}`,
  );
});

test("a command that cannot be undone is caught whatever words the turn used", () => {
  const reading = read(turn(call({ type: "shell", command: "git reset --hard origin/main" }), said("Cleaned the branch up.")), { gate: GATE });
  assert.deepEqual(reading.signals, ["destructive"]);
  assert.ok(reading.score >= 100, "an irreversible act outweighs every other signal on its own");
});

test("a test-first loop is not repetition, because the gate ran between the passes", () => {
  const reading = read(
    turn(
      call({ type: "edit", filePath: "src/strings.js" }),
      call({ type: "edit", filePath: "test/strings.test.js", oldString: "", newString: "assert.equal(titleCase('a b'), 'A B');" }),
      gateRun(),
      call({ type: "edit", filePath: "src/strings.js" }),
      gateRun(),
      call({ type: "edit", filePath: "src/strings.js" }),
      gateRun(),
    ),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, [], "red, green and verify is how the work gets done, not evidence of going in circles");
});

test("going over the same file three times without ever running the gate is repetition", () => {
  const reading = read(
    turn(call({ type: "edit", filePath: "src/strings.js" }), call({ type: "edit", filePath: "src/strings.js" }), call({ type: "edit", filePath: "src/strings.js" }), gateRun()),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, ["repetition"]);
});

test("running the gate over and over is checking, not repetition", () => {
  const reading = read(turn(gateRun(), gateRun(), gateRun(), gateRun(), call({ type: "edit", filePath: "src/a.js" }), gateRun()), { gate: GATE, recorded: true });
  assert.deepEqual(reading.signals, [], "the gate is the one command worth running again");
});

test("adding a test beside the code it covers is not a weakened test", () => {
  const reading = read(
    turn(
      call({ type: "edit", filePath: "src/num.js" }),
      call({ type: "edit", filePath: "test/num.test.js", oldString: "assert.equal(clamp(5, 1, 3), 3);", newString: "assert.equal(clamp(5, 1, 3), 3);\nassert.equal(clampOrPass(5, 1, 3), 5);" }),
      gateRun(),
    ),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, [], "writing a function and its test together is the task, not a fault");
});

test("an edit that takes assertions out of a test is seen", () => {
  const reading = read(
    turn(
      call({ type: "edit", filePath: "test/num.test.js", oldString: "assert.equal(clamp(5, 1, 3), 3);\nassert.equal(clamp(0, 1, 3), 1);", newString: "assert.ok(true);" }),
      gateRun(),
    ),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, ["test-weakened"]);
});

test("an edit that switches a test off is seen", () => {
  const reading = read(
    turn(call({ type: "edit", filePath: "test/num.test.js", oldString: "test('clamp', () => {", newString: "test.skip('clamp', () => {" }), gateRun()),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals, ["test-weakened"]);
});

test("recording the work without ever running the gate is unverified", () => {
  const reading = read(turn(call({ type: "edit", filePath: "src/strings.js" }), said("Done, the tests all pass.")), { gate: GATE, recorded: true });
  assert.deepEqual(reading.signals, ["unverified"], "the claim in the prose is not evidence; running the gate is");
});

test("the same turn read without a hand-back is not called unverified", () => {
  const reading = read(turn(call({ type: "edit", filePath: "src/strings.js" }), said("Still working on it.")), { gate: GATE, recorded: false });
  assert.deepEqual(reading.signals, [], "a turn still in flight has not claimed anything yet");
});

test("only this turn is read", () => {
  const reading = read(
    turn(call({ type: "edit", filePath: "src/a.js" }), { type: "user_message", text: "carry on" }, call({ type: "edit", filePath: "src/a.js" }), { type: "compaction", status: "completed" }),
    { gate: GATE, recorded: true },
  );
  assert.deepEqual(reading.signals.sort(), ["compaction", "unverified"], "the edit before the last prompt belongs to an earlier turn");
});

test("what counts as destructive, as a test file and as repetition is the project's to say", () => {
  const wrecking = turn(call({ type: "shell", command: "terraform destroy -auto-approve" }));
  assert.deepEqual(read(wrecking, { gate: GATE, recorded: true }).signals, [], "git's own list is the preset, and it has never heard of this");

  // Every one of these has been an option of this reader from the start — its first line says the set
  // is open "so a kit can add one without the desk being rebuilt" — and the one caller passed none of
  // them, so a project whose destructive commands are not git's could not say so anywhere.
  const named = read(wrecking, { gate: GATE, recorded: true, destructive: "terraform\\s+destroy|kubectl\\s+delete" });
  assert.deepEqual(named.signals, ["destructive"]);
  assert.match(named.notes[0]!, /terraform destroy/);

  const weakened = call({ type: "edit", filePath: "checks/orders.feature", oldString: "expect a\nexpect b", newString: "expect a" });
  assert.deepEqual(read(turn(weakened, gateRun()), { gate: GATE, recorded: true }).signals, [], "and a project whose tests live nowhere the preset names");
  assert.deepEqual(read(turn(weakened, gateRun()), { gate: GATE, recorded: true, testPath: "(^|/)checks/" }).signals, ["test-weakened"]);

  const twice = turn(call({ type: "shell", command: "ls" }), call({ type: "shell", command: "ls" }), gateRun());
  assert.deepEqual(read(twice, { gate: GATE, recorded: true }).signals, [], "three is the preset's idea of thrashing");
  assert.deepEqual(read(twice, { gate: GATE, recorded: true, repeatsAt: 2 }).signals, ["repetition"]);
});
