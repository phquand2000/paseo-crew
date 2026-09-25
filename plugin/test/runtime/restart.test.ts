import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Desk } from "../../server/desk/desk.ts";
import { saveLedger } from "../../server/desk/ledger.ts";
import { tempDir } from "../tempdir.ts";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer, nobodySeated } from "./harness.ts";

/** A lane whose second task worked in a copy of its own and handed its commit back, ready to be merged. */
async function handedBack() {
  const lane = await laneWithPeer();
  const { h } = lane;
  await h.call(lane.lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Beside", goal: "g", acceptance: ["a"], owned: ["c.txt"], outOfScope: ["the rest"], parallel: true }] });
  const task = h.ledger().tasks["L1-T2"]!;
  h.commit(task.worktree!, "c.txt", "beside\n");
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "c" });
  const stopped = (status: "queued" | "merging") => {
    const ledger = h.ledger();
    Object.assign(ledger.tasks["L1-T2"]!, { status, acceptedAt: Date.now() });
    saveLedger(h.project.state, ledger);
  };
  return { ...lane, task, stopped };
}

const merges = (h: Awaited<ReturnType<typeof laneWithPeer>>["h"], copy: string) => h.git(copy, "rev-list", "--merges", "--count", "HEAD").trim();

test("a merge the queue held when the plugin stopped goes through once it starts again", async () => {
  const { h, lane, stopped } = await handedBack();
  // Accepted, and the plugin stopped before its merge ran.
  stopped("queued");
  h.restart();
  await h.tick();
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(readFileSync(join(lane.worktree!, "c.txt"), "utf-8"), "beside\n");
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /MERGED L1-T2/);
});

test("a merge the queue held when the plugin stopped goes through on its first round, even with nobody seated", async () => {
  const { h, stopped } = await handedBack();
  stopped("queued");
  nobodySeated(h);
  h.restart();
  await h.tick();
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
});

test("a merge the plugin stopped in the middle of is run again from the start, and one that had landed is only finished", async () => {
  const { h, lane, task, stopped } = await handedBack();
  const copy = lane.worktree!;
  // Stopped with git's merge begun in the lane's copy and not committed.
  h.git(copy, "merge", "-q", "--no-ff", "--no-commit", task.branch!);
  stopped("merging");
  h.restart();
  await h.tick();
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(existsSync(join(copy, ".git", "MERGE_HEAD")), false);
  assert.equal(merges(h, copy), "1", "merged once");

  // Stopped after git merged it, before the record said so.
  const again = await handedBack();
  const second = again.lane.worktree!;
  again.h.git(second, "merge", "-q", "--no-ff", "-m", "Merge L1-T2", again.task.branch!);
  again.stopped("merging");
  again.h.restart();
  await again.h.tick();
  await again.h.runtime.desk.settled(again.h.project);
  assert.equal(again.h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(merges(again.h, second), "1", "not merged a second time");
  await again.h.idle(again.lane.lead!);
  assert.match(again.h.agents.get(again.lane.lead!)!.sent.join("\n"), /MERGED L1-T2/);
});

test("the merges a stop left wait behind one accepted since the start, rather than undoing it halfway", async () => {
  const { h, lane } = await handedBack();
  h.restart();
  // Accepted before the first round, so its merge is under way when the queue is taken up.
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.resumeMerges(h.project);
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(merges(h, lane.worktree!), "1");
});

test("a seat waiting for its turn to end to be archived when the plugin stopped is archived once that turn is over", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  // The Lead and its Peer are mid-turn, so closing the lane leaves the Peer, and the copy they write in, until their turns end.
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "no longer wanted" })).ok, true);
  assert.ok(!h.agents.get(peer)!.archivedAt, "not while it is mid-turn");
  h.restart();
  // Their turns ended while the plugin was down, so no hook will say so.
  h.agents.get(lane.lead!)!.status = "idle";
  h.agents.get(peer)!.status = "idle";
  await h.tick();
  assert.ok(h.agents.get(peer)!.archivedAt, "the Peer");
  assert.equal(h.agents.get(lane.lead!)!.archivedAt, null, "the Lead stays until it is released");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "main", "and the copy they wrote in is put back");
});

test("a landing waiting on a turn when the plugin stopped can go once that turn is over", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Numbers", outcome: "a.txt gains words", acceptance: ["four"], outOfScope: ["anything else"] });
  const lead = h.ledger().lanes.L1!.lead!;
  h.commit(h.root, "a.txt", "one\ntwo\nthree\nfour\n");
  // main moves on, so landing starts with merging it into the lane's copy, where the Lead is mid-turn.
  const side = join(tempDir("sw2-moved-"), "wt");
  h.git(h.root, "worktree", "add", "-q", "-b", "side", side, "main");
  h.git(side, "commit", "-qm", "moved", "--allow-empty");
  h.git(h.root, "branch", "-f", "main", "side");
  h.git(h.root, "worktree", "remove", "--force", side);
  assert.match((await h.call(sup, "supervisor", "land_lane", { lane: "L1" })).text, /a seat is mid-turn there/);
  h.restart();
  // The Lead's turn ended while the plugin was down, so no hook will say so.
  h.agents.get(lead)!.status = "idle";
  await h.tick();
  await h.idle(sup);
  assert.match(h.agents.get(sup)!.sent.join("\n"), /CAN LAND L1/);
});

/** Every slow call a desk is still working on, finished. */
const finished = (desk: Desk) => Promise.all([...(desk as unknown as { running: Map<string, { reply: Promise<unknown> }> }).running.values()].map((entry) => entry.reply));

test("an answer promised as mail that a stop lost is owned up to once the plugin starts again, and one that came is not", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "sleep 1" });
  await h.call(sup, "supervisor", "open_lane", { title: "Slow", outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lead = h.ledger().lanes.L1!.lead!;
  const report = (id: string) => h.runtime.desk.answer({ id, agent: lead, role: "lead", tool: "report", args: { summary: "ready to land", ready: true }, cwd: h.root, at: Date.now() }, 100);
  const told = () => h.agents.get(lead)!.sent.join("\n").split("NO ANSWER to your report call").length - 1;

  // Told to end its turn and wait for the answer as mail, and the plugin stopped before its gate did.
  assert.match((await report("r1")).text, /answer arrives as mail/);
  const stopped = h.runtime.desk;
  h.restart();
  await h.tick();
  await h.idle(lead);
  assert.equal(told(), 1);
  await finished(stopped);

  assert.match((await report("r2")).text, /answer arrives as mail/);
  await finished(h.runtime.desk);
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /ANSWER to your report call, which ran longer/);
  h.restart();
  await h.tick();
  await h.idle(lead);
  assert.equal(told(), 1, "an answer that came is not owned up to again");
});

/** Opens a lane whose Lead Paseo seats, then stops the plugin before the desk hears back, as a crash there would. */
async function stoppedOpening(where: Record<string, unknown>) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  const paseo = h.paseo as unknown as { workspaces: { ref(id: string): { agents: { create(options: unknown): Promise<unknown> } } } };
  const ref = paseo.workspaces.ref;
  paseo.workspaces.ref = (id) => {
    const workspace = ref(id);
    const create = workspace.agents.create;
    workspace.agents.create = async (options) => (await create(options), new Promise(() => {}));
    return workspace;
  };
  const head = h.git(h.root, "rev-parse", "HEAD").trim();
  void h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["the rest"], ...where });
  const seated = () => [...h.agents.values()].find((agent) => agent.title.startsWith("L1 · Lead"));
  for (let i = 0; i < 200 && !seated(); i++) await settle();
  paseo.workspaces.ref = ref;
  h.restart();
  await h.tick(Date.now());
  return { h, lead: seated()!.id, head };
}

test("a Lead seated in the Human's copy before a stop is taken on where it works, so its lane's tasks start", async () => {
  const { h, lead } = await stoppedOpening({});
  assert.equal(h.ledger().lanes.L1!.lead, lead);
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "Total", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest"] }] });
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", String(h.ledger().tasks["L1-T1"]!.held?.why));
});

test("a lane carrying on the Human's branch keeps the commit it started from when its Lead is taken on after a stop", async () => {
  const { h, lead, head } = await stoppedOpening({ onBranch: true });
  assert.equal(h.ledger().lanes.L1!.lead, lead);
  assert.equal(h.ledger().lanes.L1!.startSha, head, "what the lane changed is read from here when it lands");
});
