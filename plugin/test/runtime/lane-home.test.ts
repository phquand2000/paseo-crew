import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

const lane = (title: string, extra: Record<string, unknown> = {}) => ({ title, outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"], ...extra });

test("a lane that would take the Human's copy off their branch waits for their word, which open_lane or laneHome carries", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main", gate: "true" });
  h.git(h.root, "switch", "-qc", "fix/login");
  const branch = () => h.git(h.root, "branch", "--show-current").trim();

  const unasked = await h.call(sup, "supervisor", "open_lane", lane("First"));
  assert.match(unasked.text, /^The Human decides where this lane works, and has not said: carry on fix\/login here \(onBranch\), a new branch off main here \(isolate false\), or a copy of its own \(isolate\)\. Ask them/);
  assert.deepEqual([branch(), Object.keys(h.ledger().lanes)], ["fix/login", []], "nothing is opened or switched");

  assert.equal((await h.call(sup, "supervisor", "set_project", { laneHome: "isolate" })).ok, true);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Lanes open in a copy of their own, as the Human chose for every lane \(laneHome\)\./);
  const standing = await h.call(sup, "supervisor", "open_lane", lane("First"));
  assert.equal(standing.ok, true, standing.text);
  assert.ok(h.ledger().lanes.L1!.slot, "the standing choice gave it a copy of its own");
  assert.equal(branch(), "fix/login", "and the Human's checkout stays where it is");
  const waiting = await h.call(sup, "supervisor", "open_lane", lane("Then", { after: ["L1"] }));
  assert.equal(waiting.ok, true, waiting.text);
  assert.equal(h.ledger().lanes.L2!.opening?.isolate, true, "a lane that waits keeps the standing choice for when it opens");

  await h.call(sup, "supervisor", "set_project", { laneHome: "newBranch" });
  writeFileSync(join(h.root, "a.txt"), "the Human's own edit\n");
  const over = await h.call(sup, "supervisor", "open_lane", lane("Here", { writeSet: ["b.txt"] }));
  assert.match(over.text, /has not said: carry on fix\/login here \(onBranch\), a new branch that takes the uncommitted work along/, "a new branch here cannot be switched to over their work");
});

test("a lane told to work in the Human's copy, or to carry on their branch, does so without asking again", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main", gate: "true" });
  h.git(h.root, "switch", "-qc", "fix/login");
  const here = await h.call(sup, "supervisor", "open_lane", lane("Here", { isolate: false }));
  assert.equal(here.ok, true, here.text);
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), h.ledger().lanes.L1!.branch, "a lane branch off main, in their copy");
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "done" });
  h.agents.get(h.ledger().lanes.L1!.lead!)!.status = "idle";
  await h.endTurn(h.ledger().lanes.L1!.lead!, "done");

  h.git(h.root, "switch", "-q", "fix/login");
  await h.call(sup, "supervisor", "set_project", { laneHome: "onBranch" });
  const carried = await h.call(sup, "supervisor", "open_lane", lane("Carry on"));
  assert.equal(carried.ok, true, carried.text);
  assert.deepEqual([h.ledger().lanes.L2!.onBranch, h.ledger().lanes.L2!.branch], [true, "fix/login"]);
});
