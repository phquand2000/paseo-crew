import assert from "node:assert/strict";
import { test } from "node:test";
import { TEAM_SERVER } from "../../server/catalog/kit.ts";
import type { StreamMessage } from "../../server/core/stream.ts";
import { FACTS, callsTo, factTitle, stuck } from "../../server/runtime/watch/facts.ts";
import { SeatWatch } from "../../server/runtime/watch/watches.ts";
import { again, claudeTurn2, fixture, kinds, kit, opening, piRow, play, rules } from "./seat-replay.ts";

test("a failed shell call is seen on every harness however it says so, once, and never again from a reload's history", () => {
  for (const harness of ["claude", "pi", "codex"]) {
    const facts = play(fixture(harness), rules());
    const failures = facts.filter((fact) => fact.kind === "call-failed");
    assert.equal(failures.length, 1, `${harness}: ${JSON.stringify(facts)}`);
    assert.match(failures[0]!.quote, /cat \.\/does-not-exist\.txt/, harness);
    assert.ok(!kinds(facts).includes("destructive"), harness);
  }
});

test("a command OpenCode reports as completed is read as failed from the exit code it keeps beside the call", () => {
  // As Paseo maps an OpenCode shell call: its detail has no exit code, and the tool's own metadata rides on the item.
  const exited = (code: number) => {
    const row = again(piRow(15), `cat-${code}`, 2);
    Object.assign(row.event.item!, { status: "completed", error: null, detail: { type: "shell", command: "cat ./does-not-exist.txt", output: "cat: ./does-not-exist.txt: No such file or directory\n" }, metadata: { exit: code, truncated: false } });
    return row;
  };
  const quirks = kit.harnesses.opencode!.timeline;
  assert.deepEqual(kinds(play([...opening(), exited(1)], rules(), undefined, quirks)), ["call-failed"]);
  assert.deepEqual(kinds(play([...opening(), exited(0)], rules(), undefined, quirks)), []);
  assert.deepEqual(kinds(play([...opening(), exited(1)], rules())), [], "a harness that names no such field is read by the call's own status");
});

test("an irreversible command is caught the moment its command is known, before the call finishes, and only once", () => {
  const rewritten = fixture("claude").map((message) => JSON.parse(JSON.stringify(message).replaceAll("sleep 4; echo step-one", "rm -rf build")) as StreamMessage);
  const facts = play(rewritten, rules()).filter((fact) => fact.kind === "destructive");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]!.level, "page");
  assert.equal(facts[0]!.seq, 3, "Claude's first row for the call has no command; the second has it, and the call is still running");
  const settledAt = rewritten.find((message) => message.event.item?.status === "completed" && JSON.stringify(message).includes("rm -rf build"))!.seq!;
  assert.ok(facts[0]!.seq < settledAt);
});

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

test("Claude's task notifications are not calls, so three failing runs of one command are the same action failing three times", () => {
  const facts = play(claudeTurn2(), rules());
  assert.equal(facts.filter((fact) => fact.kind === "call-failed" && fact.quote.includes("npm test")).length, 3);
  assert.match(facts.find((fact) => fact.kind === "stuck")!.quote, /the same action failing 3 times: Bash: npm test/);
});

test("two actions alternating are stuck only when their results alternate too", () => {
  const done = piRow(11);
  const moving = (callId: string, seq: number, command: string, output: string) => again(done, callId, seq, (detail) => Object.assign(detail, { command, output }));
  const progressing = [...opening(), moving("a", 2, "npm test", "3 failing"), moving("b", 3, "vim", "x"), moving("c", 4, "npm test", "2 failing"), moving("d", 5, "vim", "x"), moving("e", 6, "npm test", "1 failing"), moving("f", 7, "vim", "x")];
  assert.deepEqual(kinds(play(progressing, rules())).filter((kind) => kind === "stuck"), []);
});

test("a failure is climbed out of when the same program passes, and the latest failure is the one tracked", () => {
  const failedCat = piRow(15);
  const done = piRow(11);
  const run = (callId: string, seq: number, command: string, ok: boolean) =>
    again(ok ? done : failedCat, callId, seq, (detail) => Object.assign(detail, { command, ...(ok ? { exitCode: 0 } : {}) }));
  const steps = (count: number, from: number) => Array.from({ length: count }, (_, index) => again(done, `ok-${from + index}`, from + index, (detail) => (detail.command = `cat file${index}`)));
  const cured = play([...opening(), run("f", 2, "npm test", false), run("p", 3, "npm test 2>&1 | tail -30", true), ...steps(12, 4)], rules());
  assert.deepEqual(kinds(cured).filter((kind) => kind === "no-recovery"), []);
  const moved = play([...opening(), run("probe", 2, "rg legacyFlag src", false), run("f", 3, "npm test", false), ...steps(10, 4)], rules());
  assert.match(moved.find((fact) => fact.kind === "no-recovery")!.quote, /`npm test` failed/, "the fact names the failure the seat is in now, not an earlier probe");
});

test("a second loop in the same turn is reported, once the first has been broken", () => {
  const failedCat = piRow(15);
  const done = piRow(11);
  const fail = (callId: string, seq: number, command: string) => again(failedCat, callId, seq, (detail) => (detail.command = command));
  const loop = [...opening(), fail("a", 2, "make"), fail("b", 3, "make"), fail("c", 4, "make"), again(done, "ok", 5), fail("d", 6, "cargo build"), fail("e", 7, "cargo build"), fail("f", 8, "cargo build")];
  assert.equal(kinds(play(loop, rules())).filter((kind) => kind === "stuck").length, 2);
});

test("a message steered into a long turn does not make it long again", () => {
  const watch = new SeatWatch({ id: "s1", provider: "sw2-peer-claude", cwd: "/work" }, () => ({ rules: rules(), handedBack: () => undefined, placed: true }));
  const t0 = Date.parse("2026-09-19T10:00:00Z");
  watch.see({ kind: "turn", phase: "started", turnId: "t" }, t0);
  assert.equal(watch.longTurn(t0 + 40 * 60_000, 30).length, 1);
  watch.see({ kind: "row", row: { item: { type: "user_message", text: "Also check the README" }, seqStart: 1, seq: 1, epoch: "e", turnId: "t", replay: false } }, t0 + 40 * 60_000);
  assert.deepEqual(watch.longTurn(t0 + 45 * 60_000, 30), []);
});

test("irreversible commands are caught where a command starts, in any flag order, and not in quoted text", () => {
  const destructive = new RegExp(kit.attention.destructive, "i");
  for (const command of ["rm -r -f build", "sudo rm -rf /", "cd x && rm -fr dist", "find . -exec rm -f {} \;", "bash -c \"rm -rf tmp\"", "git -C repo push --force", "git branch -df feat", "git branch -d -f feat", "git branch --delete --force x"]) {
    assert.equal(destructive.test(command), true, command);
  }
  for (const command of ["echo 'rm -rf /'", "grep -rn 'git reset --hard' docs", "terraform -chdir=x plan", "git branch -d feat", "git branch -f feat HEAD", "rm -i a"]) {
    assert.equal(destructive.test(command), false, command);
  }
});

test("a failure stretch ends when the same program passes, but a red gate is not climbed out of by another script passing", () => {
  const failedCat = piRow(15);
  const done = piRow(11);
  const run = (callId: string, seq: number, command: string, ok: boolean) =>
    again(ok ? done : failedCat, callId, seq, (detail) => Object.assign(detail, { command, ...(ok ? { exitCode: 0 } : {}) }));
  const steps = (count: number, from: number) => Array.from({ length: count }, (_, index) => again(done, `ok-${from + index}`, from + index, (detail) => (detail.command = `cat file${index}`)));
  assert.deepEqual(kinds(play([...opening(), run("a", 2, "rg legacyFlag src", false), run("b", 3, "rg otherThing src", true), ...steps(12, 4)], rules())).filter((kind) => kind === "no-recovery"), []);
  assert.deepEqual(kinds(play([...opening(), run("a", 2, "npm run check", false), run("b", 3, "npm run lint", true), ...steps(10, 4)], rules())).filter((kind) => kind === "no-recovery"), ["no-recovery"]);
});

test("the end of a turn that is not the one the seat is in does not close it", () => {
  const watch = new SeatWatch({ id: "s1", provider: "sw2-peer-claude", cwd: "/work" }, () => ({ rules: rules(), handedBack: () => undefined, placed: true }));
  watch.see({ kind: "turn", phase: "started", turnId: "turn-2" }, 1_000);
  watch.see({ kind: "turn", phase: "completed", turnId: "turn-1" }, 2_000);
  assert.equal(watch.running, true);
  watch.see({ kind: "turn", phase: "completed", turnId: "turn-2" }, 3_000);
  assert.equal(watch.running, false);
});

test("Claude's task notifications are kept in the window as pseudo calls, which no fact counts", () => {
  const watch = new SeatWatch({ id: "s1", provider: "sw2-peer-claude", cwd: "/work" }, () => ({ rules: rules(), handedBack: () => undefined, placed: true }));
  for (const message of claudeTurn2()) {
    if (message.event.type !== "timeline") continue;
    watch.see({ kind: "row", row: { item: message.event.item!, seqStart: message.seq!, seq: message.seq!, epoch: message.epoch!, turnId: message.event.turnId ?? null, replay: false } });
  }
  assert.ok(watch.window.units.some((unit) => unit.kind === "call" && unit.call.name === "task_notification" && unit.call.pseudo));
});

test("every fact that can open an incident has a title a person can read", () => {
  // A note is evidence and never an incident on its own, so only the other levels need a title.
  for (const [kind, { level }] of Object.entries(FACTS)) {
    const title = factTitle(kind);
    if (level === "note") assert.equal(title, undefined, `${kind} never reaches a screen`);
    else assert.ok(title && !/[-_]/.test(title.split(" ")[0]!), `${kind} has no readable title`);
  }
});

test("calls the record cannot tell apart are not read as one call repeated", () => {
  // Paseo records a Claude seat's MCP calls with an empty input, so four different start_task calls compared equal.
  const call = (id: string, detail: Record<string, unknown>) => ({ kind: "call" as const, call: { id, name: "mcp__team__start_task", status: "completed", ended: true, error: null, detail: { type: "unknown", ...detail } } as never });
  const bare = ["1", "2", "3", "4"].map((id) => call(id, { input: {}, output: "started" }));
  assert.equal(stuck(bare, { repeatsAt: 3 }), undefined);
  const same = ["1", "2", "3", "4"].map((id) => call(id, { input: { title: "x" }, output: "started" }));
  assert.match(stuck(same, { repeatsAt: 3 }) ?? "", /the same action with the same result/, "the same call with the same arguments still is");
});

test("a refusal the desk gave a seat is not a failed call, on every harness that says which server answered: the desk already said why and what instead", () => {
  const failedCat = piRow(15);
  const failing = (name: string, seq: number, detail?: Record<string, unknown>) => {
    const copy = again(failedCat, `t${seq}`, seq);
    copy.event.item!.name = name;
    if (detail) copy.event.item!.detail = detail;
    return copy;
  };
  const deskOf = (harness: string) => rules({ desk: callsTo(kit.harnesses[harness]!.mcpCall, kit.harnesses[harness]!.mcpServerField, TEAM_SERVER) });
  // As each harness recorded a refused team call live.
  assert.deepEqual(kinds(play([...opening(), failing("mcp__team__start_task", 2)], deskOf("claude"))), [], "claude");
  // Pi names a call server_tool, so a pasted team_x server's calls start the same way; the server it records tells them apart.
  const pi = [
    failing("team_plan_tasks", 2, { type: "unknown", output: { content: [{ type: "text", text: "Error: The plan was not taken" }], details: { error: "tool_error", server: "team" } } }),
    failing("team_plan_tasks", 3, { type: "unknown", output: { content: [{ type: "text", text: 'Validation failed for tool "team_plan_tasks"' }], details: {} } }),
    failing("team_x_lookup", 4, { type: "unknown", output: { content: [{ type: "text", text: "Error: not found" }], details: { error: "tool_error", server: "team_x" } } }),
  ];
  assert.deepEqual(kinds(play([...opening(), ...pi], deskOf("pi"))), ["call-failed", "call-failed"], "pi: a call Pi refused before the desk saw it, and another server's, are still failures");
});
