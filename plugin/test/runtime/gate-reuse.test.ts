import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";
import { decide, laneWith, risky } from "./landable.ts";

type Harness = ReturnType<typeof harness>;

/** A gate that passes and writes a line per run: the branch it ran on, and whether `file` was in its tree. */
function countingGate(file = "b/b.txt") {
  const runs = join(tempDir("crew-gate-"), "runs");
  const gate = `echo "$(git branch --show-current) $(test -f ${file} && echo with || echo without)" >> '${runs}'`;
  const ran = () => (readFileSync(runs, "utf-8").trim() || "").split("\n");
  return { gate, ran };
}

function commitAll(h: Harness, cwd: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  h.git(cwd, "add", "-A");
  h.git(cwd, "commit", "-qm", Object.keys(files).join(", "));
}

test("a landing reuses the gate READY ran on the same tree, through the Human's hold and approval, and says so", async () => {
  const { gate, ran } = countingGate();
  const { h, land } = await laneWith(risky, ["src/auth"], false, gate);
  assert.equal(ran().length, 1);
  const held = await land();
  assert.match(held.text, /waits for the Human's approval/);
  assert.match(await decide(h, true, "fine"), /^Approved: Lane L1 closed/);
  assert.equal(ran().length, 1, "the tree READY gated is the tree that landed");
  assert.equal(h.events("gate.reused").length, 2);
  assert.equal(h.events("gate.passed")[0]!.tree, h.events("gate.reused")[0]!.tree);
});

test("READY gates the lane with base in, so a landing after it runs nothing again; a lane changed since runs it again", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const { gate, ran } = countingGate();
  await h.call(sup, "supervisor", "set_project", { gate });
  for (const title of ["a", "b"]) {
    const lane = { title, outcome: title, acceptance: ["done"], outOfScope: ["the rest"], writeSet: [`${title}/**`] };
    assert.equal((await h.call(sup, "supervisor", "open_lane", { ...lane, isolate: true })).ok, true);
  }
  const { L1: first, L2: second } = h.ledger().lanes;
  for (const lane of [first!, second!]) h.agents.get(lane.lead!)!.status = "idle";
  commitAll(h, first!.worktree!, { "a/a.txt": "a\n" });
  commitAll(h, second!.worktree!, { "b/b.txt": "b\n" });
  const ready = (lead: string) => h.call(lead, "lead", "report", { summary: "done", ready: true });
  assert.equal((await ready(first!.lead!)).ok, true);
  assert.equal((await ready(second!.lead!)).ok, true);
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L2" })).ok, true);
  assert.equal((await ready(first!.lead!)).ok, true);
  assert.deepEqual(ran(), [`${first!.branch} without`, `${second!.branch} with`, `${first!.branch} with`]);
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(landed.ok, true, landed.text);
  assert.deepEqual(ran(), [`${first!.branch} without`, `${second!.branch} with`, `${first!.branch} with`]);
  assert.deepEqual(
    h.events("gate.reused").map((event) => event.lane),
    ["L2", "L1"],
  );
  assert.equal(h.git(h.root, "show", "main:a/a.txt"), "a\n");
});

test("a gate whose command changed since READY runs again at landing", async () => {
  const { gate, ran } = countingGate();
  const { h, sup, land } = await laneWith({ "a.txt": "a\n" }, [], false, gate);
  await h.call(sup, "supervisor", "set_project", { gate: `${gate} # again` });
  assert.equal((await land()).ok, true);
  assert.equal(ran().length, 2);
  assert.equal(h.events("gate.reused").length, 0);
});

test("READY on a lane whose base conflicts with it is refused with what to do, and nothing is left in its copy", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  for (const title of ["a", "b"]) {
    const lane = { title, outcome: title, acceptance: ["done"], outOfScope: ["the rest"], writeSet: ["shared.txt"] };
    assert.equal((await h.call(sup, "supervisor", "open_lane", { ...lane, isolate: true })).ok, true);
  }
  const { L1: first, L2: second } = h.ledger().lanes;
  for (const lane of [first!, second!]) h.agents.get(lane.lead!)!.status = "idle";
  commitAll(h, first!.worktree!, { "shared.txt": "a\n" });
  commitAll(h, second!.worktree!, { "shared.txt": "b\n" });
  assert.equal((await h.call(sup, "supervisor", "land_lane", { lane: "L2" })).ok, true);
  const refused = await h.call(first!.lead!, "lead", "report", { summary: "done", ready: true });
  assert.equal(refused.ok, false);
  assert.match(
    refused.text,
    /BASE CONFLICT L1 \(a\)[^]*conflicts in shared\.txt[^]*Next: add_tasks a task with takeBase true/,
  );
  assert.equal(h.ledger().lanes.L1!.ready, undefined);
  assert.equal(h.git(first!.worktree!, "status", "--porcelain").trim(), "");
});
