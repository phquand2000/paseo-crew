import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
/** A task pointed at `paths`, or holding them when it runs beside others. */
const task = (key: string, paths: string[], extra: Record<string, unknown> = {}) => ({ key, title: `Task ${key}`, goal: `do ${key}`, ...scope, ...(extra.parallel === true ? { holds: paths } : { hints: paths }), ...extra });

/** A lane with a Lead and nothing started. */
async function lane() {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, writeSet: ["a.txt", "b.txt", "c.txt", "src/**"] });
  return { h, sup, lead: h.ledger().lanes.L1!.lead! };
}

test("a Lead lays its lane out at once: tasks in the lane's copy run in turn, parallel ones beside them, each starting once what it waits for is merged", async () => {
  const { h, lane: opened, peer } = await laneWithPeer();
  const lead = opened.lead!;
  const planned = await h.call(lead, "lead", "add_tasks", {
    tasks: [task("totals", ["a.txt"], { after: ["L1-T1"] }), task("receipt", ["b.txt"], { parallel: true }), task("tax", ["c.txt"])],
  });
  assert.equal(planned.ok, true, planned.text);
  assert.match(planned.text, /- TOTALS is L1-T2 Task totals: waits for L1-T1/);
  assert.match(planned.text, /- RECEIPT is L1-T3 Task receipt: running, Peer/);
  assert.match(planned.text, /- TAX is L1-T4 Task tax: waits for L1-T2/, "the lane's copy takes one writer, so the plan's tasks there run one after another");
  await h.idle(lead);
  assert.doesNotMatch(h.agents.get(lead)!.sent.join("\n"), /WAITING L1-T3/, "the reply already said it started, so no letter says it again");

  h.commit(opened.worktree!, "a.txt", "T1\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "done" });
  h.agents.get(peer)!.status = "idle";
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.deepEqual(["L1-T2", "L1-T4"].map((id) => h.ledger().tasks[id]!.status), ["running", "waiting"], "L1-T2 starts once L1-T1 is accepted, and L1-T4 still waits for it");
});

test("tasks that cannot run as given are refused whole, and nothing of them is recorded", async () => {
  const { h, lead } = await lane();
  const refused = async (tasks: unknown[]) => (await h.call(lead, "lead", "add_tasks", { tasks })).text;
  assert.match(await refused([]), /add_tasks was not carried out: it needs tasks/);
  assert.match(await refused([task("a", ["a.txt"]), task("A", ["b.txt"])]), /The key A names two tasks/);
  assert.match(await refused([task("a", ["a.txt"], { after: ["nope"] })]), /A: There is no task in this lane NOPE to wait for[^]*Take it out of after/);
  assert.match(await refused([task("a", ["a.txt"], { after: ["b"] }), task("b", ["b.txt"], { after: ["a"] })]), /The tasks loop: A, B wait for each other/);
  assert.match(await refused([task("a", ["a.txt"], { skills: ["no-such-skill"] })]), /A: .*no skill called no-such-skill/);
  assert.match(await refused([task(" ", ["a.txt"])]), /Every task has a key/);
  assert.match(await refused([task("a", ["a.txt"], { title: "t".repeat(61) })]), /title takes at most 60 characters, and has 61 in each of tasks/);
  const { goal: _, ...aimless } = task("a", ["a.txt"]);
  assert.match(await refused([aimless, task("b", ["b.txt"], { parallel: "yes", owner: "me" })]), /it needs goal \(The outcome and what it is for, not the implementation\) in each of tasks\. It takes tasks\./, "each task is held to what a task takes");
  assert.match(await refused([task("b", ["b.txt"], { parallel: "yes", owner: "me" })]), /it parallel must be true or false in each of tasks; has no field owner in each of tasks\./);
  await h.call(lead, "lead", "start_review", { focus: "is the cart shape right?" });
  assert.match(await refused([task("L1-R1", ["a.txt"])]), /The key L1-R1 is already a task of this project/);
  assert.deepEqual(Object.keys(h.ledger().tasks), ["L1-R1"], "none of those recorded a task");
});

test("tasks that would hold one path twice, or hold one the lane does not write, are refused whole, each named; where a task starts reading is not checked", async () => {
  const { h, lead } = await lane();
  const refused = await h.call(lead, "lead", "add_tasks", {
    tasks: [task("left", ["src/x.ts"], { parallel: true }), task("right", ["src/x.ts"], { parallel: true }), task("lock", ["package-lock.json"], { parallel: true }), task("stray", ["docs/readme.md"], { parallel: true }), task("hint", ["docs/guide.md"])],
  });
  assert.equal(refused.ok, false);
  assert.match(refused.text, /^No task was added/);
  assert.match(refused.text, /LEFT and RIGHT may run at once and both hold src\/x\.ts/);
  assert.match(refused.text, /LOCK runs beside others but holds package-lock\.json/);
  assert.match(refused.text, /STRAY holds docs\/readme\.md, outside the lane's write set/);
  assert.match(refused.text, /LOCK holds package-lock\.json, outside the lane's write set/);
  assert.doesNotMatch(refused.text, /HINT/, "a hint outside the write set is where to read, not what it writes");
  assert.deepEqual(Object.keys(h.ledger().tasks), [], "none of them is recorded");
});

test("a task that holds what a running task holds, and does not wait for it, is refused; one that waits is taken", async () => {
  const { h, lane: opened } = await laneWithPeer();
  assert.equal((await h.call(opened.lead!, "lead", "add_tasks", { tasks: [task("first", ["b.txt"], { parallel: true })] })).ok, true);
  const refused = await h.call(opened.lead!, "lead", "add_tasks", { tasks: [task("beside", ["b.txt"], { parallel: true }), task("next", ["b.txt"], { parallel: true, after: ["L1-T2"] })] });
  assert.match(refused.text, /BESIDE holds b\.txt, which L1-T2 holds and is still writing, and does not wait for it/);
  assert.doesNotMatch(refused.text, /NEXT holds b\.txt, which L1-T2/, "one that waits for it is not in its way");
  assert.equal((await h.call(opened.lead!, "lead", "add_tasks", { tasks: [task("next", ["b.txt"], { parallel: true, after: ["L1-T2"] })] })).ok, true);
});

test("a Lead changes what a task beside others holds: the record and its Peer see what it holds now, and it may not take what another holds", async () => {
  const { h, lane: opened } = await laneWithPeer();
  const lead = opened.lead!;
  await h.call(lead, "lead", "add_tasks", { tasks: [task("t", ["b.txt"], { parallel: true, title: "B" })] });
  await h.call(lead, "lead", "add_tasks", { tasks: [task("t", ["c.txt"], { parallel: true, title: "C" })] });
  const amend = (id: string, holds: string[]) => h.call(lead, "lead", "amend_task", { task: id, why: "the desk named a path", holds });
  assert.match((await amend("L1-T2", ["b.txt", "c.txt"])).text, /What it holds overlaps what L1-T3 holds at c\.txt\. Leave those paths out of L1-T2/);
  assert.match((await amend("L1-T2", ["b.txt", "package-lock.json"])).text, /A parallel task can't hold package-lock\.json/);
  assert.deepEqual(h.ledger().tasks["L1-T2"]!.holds, ["b.txt"], "a refused change leaves the record as it was");

  assert.equal((await amend("L1-T2", ["b.txt", "d.txt"])).ok, true, "its own paths are no clash with itself");
  const side = h.ledger().tasks["L1-T2"]!;
  assert.deepEqual([side.holds, side.amended?.[0]?.was], [["b.txt", "d.txt"], { holds: ["b.txt"] }]);
  await h.idle(side.peer!);
  assert.match(h.agents.get(side.peer!)!.sent.join("\n"), /holds, was:\n- b\.txt\nholds, now:\n- b\.txt\n- d\.txt/);
});


test("a task's brief names what is written beside it and what each holds, and one in the lane's copy only the tasks in copies of their own", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  await h.call(lead, "lead", "add_tasks", { tasks: [task("n", ["n.txt"]), task("b", ["b.txt"], { parallel: true }), task("c", ["c.txt"], { parallel: true }), task("w", ["w.txt"], { after: ["b", "c"] })] });
  const brief = (id: string) => h.agents.get(h.ledger().tasks[id]!.peer!)!.prompt ?? "";
  assert.match(brief("L1-T3"), /\n\nBeside you, in copies of their own or the lane's, each merged into the lane branch once accepted: L1-T1 \(Clean build\); L1-T2 \(Task n\); L1-T4 \(Task c\) holds c\.txt\. What they write reaches your copy only as your hand-back brings the lane in: leave it to them, and ask if you need it first\.\n\nYou are on branch/, "L1-T5 comes after it, so it is not beside it");
  assert.match(brief("L1-T4"), /Beside you, in copies of their own or the lane's, each merged into the lane branch once accepted: L1-T1 \(Clean build\); L1-T2 \(Task n\); L1-T3 \(Task b\) holds b\.txt\./);
  // Added apart, it waits for the lane's copy with no after naming a task: it comes after whichever holds the copy, not beside it.
  await h.call(lead, "lead", "add_tasks", { tasks: [task("z", ["z.txt"])] });

  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  await h.idle(peer);
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  const next = h.ledger().tasks["L1-T2"]!.peer!;
  assert.notEqual(next, peer, "the task waiting in the lane's copy gets a Peer of its own");
  assert.match(h.agents.get(next)!.prompt ?? "", /\n\nBeside you, in copies of their own, each merged into the lane branch once accepted: L1-T3 \(Task b\) holds b\.txt; L1-T4 \(Task c\) holds c\.txt\. What they write reaches your copy only as your hand-back brings the lane in: leave it to them, and ask if you need it first\.\n\nYou work on branch/);
});
