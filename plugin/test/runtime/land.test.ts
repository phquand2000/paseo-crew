import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";
import { heldLook } from "./lane-gates.ts";
import { laneWith, risky } from "./landable.ts";

type Harness = ReturnType<typeof harness>;

const scope = { acceptance: ["done"], outOfScope: ["anything else in the repository"] };

/** Writes and commits `files` where `cwd` has its branch checked out. */
function commitAll(h: Harness, cwd: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  h.git(cwd, "add", "-A");
  h.git(cwd, "commit", "-qm", Object.keys(files).join(", "));
}

test("a lane lands after another moved main, gated with main's newer work in it, even while a third holds the project's copy", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f b/b.txt || test -f c/c.txt" });
  for (const [title, path] of [
    ["Part A", "a/**"],
    ["Part B", "b/**"],
    ["Part C", "c/**"],
  ] as const) {
    const lane = { title, outcome: title, ...scope, writeSet: [path], isolate: title !== "Part A" };
    assert.equal((await h.call(sup, "supervisor", "open_lane", lane)).ok, true);
  }
  const lanes = h.ledger().lanes;
  for (const lane of Object.values(lanes)) h.agents.get(lane.lead!)!.status = "idle";
  assert.equal(lanes.L1!.slot, undefined);
  commitAll(h, lanes.L2!.worktree!, { "b/b.txt": "b/b.txt\n" });
  commitAll(h, lanes.L3!.worktree!, { "c/c.txt": "c/c.txt\n" });
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L3" })).ok, true);
  const second = await h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  assert.equal(second.ok, true, second.text);
  assert.doesNotMatch(second.text, /not landed/);
  assert.deepEqual(
    ["b/b.txt", "c/c.txt"].map((path) => h.git(h.root, "show", `main:${path}`)),
    ["b/b.txt\n", "c/c.txt\n"],
  );
  for (const id of ["L2", "L3"]) assert.equal((await h.call(sup, "supervisor", "release", { lane: id })).ok, true);
  assert.equal(h.git(h.root, "branch", "--list", lanes.L2!.branch, lanes.L3!.branch).trim(), "");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), lanes.L1!.branch);
  assert.equal(h.ledger().lanes.L1!.status, "open");
});

test("a red gate or a red rehearsal holds a landing until the Supervisor lands over it with a reason", async () => {
  const { h, sup, lane, land, onMain } = await laneWith({ "src/db/001.sql": "create table t (id int);\n" });
  const rule = (paths: string[]) => ({
    paths,
    invariant: "running it twice changes nothing",
    reviewQuestion: "What does a second run do?",
    rehearse: "false",
  });
  const ready = async () => {
    await h.call(lane.lead!, "lead", "report", { summary: `ready ${Date.now()}`, ready: true });
    await h.idle(sup);
    return h
      .heard(sup)
      .filter((text) => text.startsWith("REPORT"))
      .at(-1)!;
  };
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["migrations"])] });
  assert.doesNotMatch(await ready(), /rehearsing/);
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["src/db"])] });
  assert.match(
    await ready(),
    /Gate: true passed on the lane branch in \d+s\n\nfalse, rehearsing that running it twice changes nothing, failed with exit 1 on the lane branch\./,
  );
  const refused = await land();
  assert.equal(refused.ok, false);
  assert.match(
    refused.text,
    /false, rehearsing that running it twice changes nothing, failed with exit 1[^]*land_lane it over the gate with overGate true and your reason/,
  );
  const bare = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true });
  assert.equal(bare.ok, false);
  assert.match(bare.text, /needs its reason/);
  assert.equal(onMain("src/db/001.sql"), false);
  const over = await h.call(sup, "supervisor", "land_lane", {
    lane: "L1",
    overGate: true,
    reason: "the rehearsal is known broken",
  });
  assert.equal(over.ok, true, over.text);
  assert.ok(onMain("src/db/001.sql"));
});

test("a gate the plugin stops as it stops says so, and is recorded as stopped rather than failed", async () => {
  const { h, sup, lane } = await laneWith({ "a.txt": "cart\n" });
  const started = join(tempDir("crew-gate-"), "started");
  await h.call(sup, "supervisor", "set_project", { gate: `touch '${started}'; while :; do sleep 0.02; done` });
  const report = h.call(lane.lead!, "lead", "report", { summary: "again", ready: true });
  for (let tries = 0; !existsSync(started); tries++) {
    assert.ok(tries < 250, "the gate never started");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  h.runtime.dispose();
  assert.equal((await report).ok, true);
  assert.match(h.heard(sup).join("\n"), /was stopped as the plugin stopped on the lane branch/);
  assert.deepEqual(
    h.events("gate.stopped").map((event) => event.command),
    [`touch '${started}'; while :; do sleep 0.02; done`],
  );
  assert.equal(h.events("gate.failed").length, 0, "a stopped gate is no evidence the work fails");
});

test("work nobody committed in a lane's copy never lands, over the gate or not, and the desk never deletes it: READY waits for it, landing stops, a drop keeps the copy", async () => {
  const { h, sup, lane, land } = await laneWith({ "a.txt": "cart\n" }, [], true);
  const copy = lane.worktree!;
  writeFileSync(join(copy, "notes.txt"), "half a thought\n");
  const ready = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.equal(ready.ok, false, ready.text);
  assert.match(ready.text, /working copy has work uncommitted \(\?\? notes\.txt\)/);
  const over = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "judged safe" });
  assert.equal(over.ok, false, over.text);
  assert.match(
    over.text,
    /^Lane L1 was not closed: its working copy has work uncommitted \(\?\? notes\.txt\)\. Only what is committed lands, so overGate does not pass it/,
  );
  assert.notEqual(h.git(h.root, "show", "main:a.txt"), "cart\n");
  assert.equal((await land()).ok, false);

  Object.assign(h.agents.get(lane.lead!)!, { status: "closed", archivedAt: new Date().toISOString() });
  const dropped = await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" });
  assert.equal(dropped.ok, true, dropped.text);
  assert.ok(
    dropped.text.includes(`Its working copy ${lane.slot} holds work nobody committed, so it stays at ${copy}`),
    dropped.text,
  );
  await h.tick();
  assert.equal(readFileSync(join(copy, "notes.txt"), "utf-8"), "half a thought\n", "the desk never deletes work");
});

test("in the Human's own checkout, files git does not track are theirs and stop no lane, while changes to tracked files still stop its gate", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main", gate: "true" });
  writeFileSync(join(h.root, "notes.txt"), "the Human's own notes\n");
  assert.doesNotMatch((await h.call(sup, "supervisor", "status", {})).text, /Nothing on record places the next lane/);
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  assert.equal(lane.slot, undefined, "it opened in the project's own copy");
  writeFileSync(join(h.root, "a.txt"), "cart\n");
  h.git(h.root, "commit", "-qam", "cart");
  writeFileSync(join(h.root, "b.txt"), "the Human is editing\n");
  const land = () => h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  h.agents.get(lane.lead!)!.status = "idle";
  assert.match(
    (await land()).text,
    /its working copy has work uncommitted \(M b\.txt\)\. Only what is committed lands/,
  );
  h.git(h.root, "checkout", "--", "b.txt");
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.equal(readFileSync(join(h.root, "notes.txt"), "utf-8"), "the Human's own notes\n");
  assert.equal(h.git(h.root, "show", "main:a.txt"), "cart\n");
});

test("what git shows of a lane goes with its landing as evidence, and holds nothing back", async () => {
  const { h, sup, land, onMain } = await laneWith(risky);
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.ok(onMain("src/auth/login.ts"));
  assert.match(
    landed.text,
    /Evidence: 1 commit; 1 file, 1 line changed\. Gate: passed on the lane\. No review of the whole lane is on record\./,
  );

  commitAll(h, h.root, {
    "test/cart.test.ts": "assert.equal(total, 1);\nassert.ok(total);\n",
    "test/old.test.ts": "assert.ok(true);\n",
  });
  await h.call(sup, "supervisor", "set_project", { gate: "false", gateOn: "task" });
  const cart = { title: "Cart", outcome: "a cart", ...scope, writeSet: ["src/**", "test/**"], isolate: true };
  await h.call(sup, "supervisor", "open_lane", cart);
  const lane = h.ledger().lanes.L2!;
  const tasks = [{ key: "t", title: "Totals", goal: "g", ...scope, hints: ["src/cart.ts"] }];
  await h.call(lane.lead!, "lead", "add_tasks", { tasks });
  const task = h.ledger().tasks["L2-T1"]!;
  rmSync(join(task.worktree!, "test/old.test.ts"));
  commitAll(h, task.worktree!, {
    "src/cart.ts": "export const total = 2;\n",
    "test/cart.test.ts": "assert.equal(total, 2);\nit.skip('later', () => {});\n",
    "docs/notes.md": "x\n".repeat(600),
    "package-lock.json": `${"{}\n".repeat(900)}`,
  });
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "totals" });
  h.agents.get(task.peer!)!.status = "idle";
  const accepted = await h.call(lane.lead!, "lead", "accept", {
    task: "L2-T1",
    overGate: true,
    reason: "a known flake",
  });
  assert.equal(accepted.ok, true, accepted.text);
  await h.runtime.desk.settled(h.project);
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  h.agents.get(lane.lead!)!.status = "idle";
  const over = await h.call(sup, "supervisor", "land_lane", { lane: "L2", overGate: true, reason: "the flake again" });
  assert.equal(over.ok, true, over.text);
  const evidence = over.text.slice(over.text.indexOf("Evidence: "));
  for (const line of [
    "Gate: failed on the lane.",
    "Tests changed: test/cart.test.ts, test/old.test.ts.",
    "test/old.test.ts is deleted.",
    "test/cart.test.ts: adds a skip marker.",
    "docs/notes.md is outside the lane's write set, src/**, test/**.",
    "package-lock.json is outside the lane's write set, src/**, test/**.",
    "L2-T1 was accepted over its red gate: false: the gate failed with exit 1.",
  ])
    assert.ok(evidence.includes(line), `${line}\n${evidence}`);
});

test("what the record holds of a lane goes to whoever lands it, and never to the Lead it is about", async () => {
  const { h, sup, lane, peer, timeline } = await laneWithPeer({ attention: { watch: true } }, undefined, {
    holds: ["a.txt"],
    parallel: true,
  });
  const lead = lane.lead!;
  await h.call(sup, "supervisor", "set_project", { gate: "npm test", gateOn: "lane" });
  const worktree = h.ledger().tasks["L1-T1"]!.worktree!;
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  const edit = { type: "edit", filePath: join(worktree, "a.txt"), oldString: "one", newString: "uno" };
  timeline.add({ type: "tool_call", callId: "w1", name: "Edit", status: "completed", detail: edit }, "t1");
  const run = { type: "shell", command: "npm test", output: "1 failing", exitCode: 1 };
  timeline.add({ type: "tool_call", callId: "g1", name: "Bash", status: "completed", detail: run }, "t1");
  await settle();
  const handed = await h.call(peer, "peer", "done", {
    outcome: "complete",
    summary: "done",
    checks: "npm test passes",
  });
  assert.equal(handed.ok, true);
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await h.idle(peer);
  await h.idle(lead);
  assert.match(
    h.agents.get(lead)!.sent.join("\n"),
    /INCIDENT I\d+ \(claim-contradicted, attend\) on the Peer on L1-T1[^]*handed back as complete, but `npm test` failed the last time it ran, after the last edit/,
  );

  const beside = [{ key: "s", title: "Side", goal: "g", ...scope, holds: ["c.txt"], parallel: true }];
  await h.call(lead, "lead", "add_tasks", { tasks: beside });
  await h.call(lead, "lead", "start_review", { focus: "the lane as a whole" });
  const review = Object.values(h.ledger().tasks).find((task) => task.kind === "review")!;
  await h.call(review.peer!, "reviewer", "done", { verdict: "accept", answer: "Right." });
  await h.call(sup, "supervisor", "open_lane", { title: "Other", outcome: "x", ...scope, isolate: true });
  const other = h.ledger().lanes.L2!;
  await h.call(other.lead!, "lead", "add_tasks", { tasks: [{ key: "o", title: "Push", goal: "g", ...scope }] });
  await h.tick();
  const pushing = h.timelineOf(h.ledger().tasks["L2-T1"]!.peer!);
  pushing.beat("turn_started", "p1");
  const force = { type: "shell", command: "git push --force origin main" };
  pushing.add({ type: "tool_call", callId: "c1", name: "Bash", status: "running", detail: force }, "p1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    h.events("incident.open").map((event) => [event.id, event.finding]),
    [
      ["I1", "claim-contradicted"],
      ["I2", "irreversible"],
    ],
  );

  const reported = await h.call(lead, "lead", "report", { summary: "done", ready: true });
  assert.doesNotMatch(reported.text, /Incident|claim-contradicted/);
  await h.idle(sup);
  const report = h
    .heard(sup)
    .filter((text) => text.includes("REPORT L1"))
    .at(-1)!;
  assert.match(
    report,
    /REPORT L1 \(Build\): ready to land[^]*- Incident I\d+ on this lane is still open: claim-contradicted\./,
  );
  assert.match(report, /L1-T2 is running: landing cuts it\./);
  assert.match(report, /L1-R1 review: accept\./);
  assert.doesNotMatch(report, /L1-R1 is|irreversible/);
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "judged safe" });
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, /Incident I\d+ on this lane is still open: claim-contradicted\./);
  assert.match(landed.text, /It cut L1-T1, L1-T2, which were not finished\./);
});

test("two lanes landed at once each stay on the base: the second waits for the first, and a landing never erases another", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const gate = tempDir("crew-gate-");
  const hold = `test ! -f hold || test ! -f ${gate}/armed || { : > ${gate}/reached; until test -f ${gate}/open; do sleep 0.02; done; }`;
  await h.call(sup, "supervisor", "set_project", { gate: hold });
  for (const [title, file] of [
    ["Cart", "cart.txt"],
    ["Order", "order.txt"],
  ] as const) {
    const opened = await h.call(sup, "supervisor", "open_lane", {
      title,
      outcome: title,
      ...scope,
      writeSet: title === "Cart" ? [file, "hold"] : [file],
      isolate: true,
    });
    assert.equal(opened.ok, true, opened.text);
    const lane = Object.values(h.ledger().lanes).find((entry) => entry.title === title)!;
    commitAll(h, lane.worktree!, title === "Cart" ? { [file]: `${title}\n`, hold: "" } : { [file]: `${title}\n` });
    h.agents.get(lane.lead!)!.status = "idle";
  }
  h.git(h.root, "switch", "-qc", "human-work");
  writeFileSync(join(gate, "armed"), "");
  const first = h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  // The gate is a shell the desk runs, so only its own file says it got there: waited for by time, not by settles.
  for (const end = Date.now() + 10_000; !existsSync(join(gate, "reached")) && Date.now() < end;)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(existsSync(join(gate, "reached")), "the first landing is held in its gate");
  const looked = heldLook(h, sup);
  const second = h.call(sup, "supervisor", "land_lane", { lane: "L2" });
  await looked.reached;
  looked.release();
  await settle();
  writeFileSync(join(gate, "open"), "");
  const replies = await Promise.all([first, second]);
  assert.deepEqual(
    replies.map((reply) => reply.ok),
    [true, true],
    replies.map((reply) => reply.text).join("\n"),
  );
  const onMain = h.git(h.root, "ls-tree", "--name-only", "-r", "main").split("\n");
  assert.deepEqual(
    ["cart.txt", "order.txt"].filter((file) => onMain.includes(file)),
    ["cart.txt", "order.txt"],
  );
});

test("a lane whose head git cannot read as its gate is taken refuses with that reason, not as moved, and lands once it reads", async () => {
  const { lane, land, onMain } = await laneWith({ "src/cart.ts": "cart\n" });
  const fake = tempDir("crew-fake-git-");
  const path = process.env.PATH ?? "";
  writeFileSync(
    join(fake, "git"),
    `#!/bin/sh\nfor a; do last=$a; done\nif [ "$last" = '${lane.branch}^{commit}' ]; then n=$(( $(cat '${fake}/n' 2>/dev/null || echo 0) + 1 )); echo $n > '${fake}/n'; [ $n = 2 ] && exit 128; fi\nPATH='${path}' exec git "$@"\n`,
  );
  chmodSync(join(fake, "git"), 0o755);
  process.env.PATH = `${fake}:${path}`;
  const refused = await land().finally(() => (process.env.PATH = path));
  assert.equal(refused.ok, false);
  assert.match(refused.text, new RegExp(`^Lane L1 was not closed: git could not read ${lane.branch}`));
  assert.doesNotMatch(refused.text, /moved after its gate ran/);
  assert.equal(onMain("src/cart.ts"), false);
  assert.equal((await land()).ok, true);
  assert.equal(onMain("src/cart.ts"), true);
});
