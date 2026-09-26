import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
/** A task pointed at `paths`, or holding them when it runs beside others. */
const task = (key: string, paths: string[], extra: Record<string, unknown> = {}) => ({
  key,
  title: `Task ${key}`,
  goal: `do ${key}`,
  ...scope,
  ...(extra.parallel === true ? { holds: paths } : { hints: paths }),
  ...extra,
});

/** A lane with a Lead and nothing started. */
async function lane() {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", {
    title: "Cart",
    outcome: "a cart",
    ...scope,
    writeSet: ["a.txt", "b.txt", "c.txt", "src/**"],
  });
  return { h, sup, lead: h.ledger().lanes.L1!.lead! };
}

const briefOf = (h: ReturnType<typeof harness>, id: string) => h.agents.get(h.ledger().tasks[id]!.peer!)!.prompt ?? "";

const besideLine = (where: string, who: string) =>
  new RegExp(
    `\\n\\nBeside you, ${where}, each merged into the lane branch once accepted: ${who}\\. What they write reaches your copy only as your hand-back brings the lane in: leave it to them, and ask if you need it first\\.\\n\\nYou`,
  );

test("a Lead lays its lane out: tasks in the lane's copy run in turn, tasks beside them hold their paths, and each brief says where it works and who writes beside it", async () => {
  const { h, lane: opened, peer } = await laneWithPeer();
  const lead = opened.lead!;
  assert.match(briefOf(h, "L1-T1"), /Your task started from [0-9a-f]{40}/, "BASE for its checks");

  const planned = await h.call(lead, "lead", "add_tasks", {
    tasks: [
      task("totals", ["a.txt"], { after: ["L1-T1"] }),
      task("receipt", ["b.txt"], { parallel: true }),
      task("tax", ["c.txt"]),
      task("cee", ["c.txt"], { parallel: true }),
      task("w", ["w.txt"], { after: ["receipt", "cee"] }),
    ],
  });
  assert.equal(planned.ok, true, planned.text);
  assert.match(planned.text, /- TOTALS is L1-T2 Task totals: waits for L1-T1/);
  assert.match(planned.text, /- RECEIPT is L1-T3 Task receipt: running, Peer/);
  assert.match(planned.text, /- TAX is L1-T4 Task tax: waits for L1-T2/, "the lane's copy takes one writer at a time");
  await h.idle(lead);
  assert.doesNotMatch(h.agents.get(lead)!.sent.join("\n"), /WAITING L1-T3/, "the reply already said it started");
  assert.match(h.agents.get(h.ledger().tasks["L1-T3"]!.peer!)!.provider, /peer/, "no role given is the preset's own");
  assert.match(
    briefOf(h, "L1-T3"),
    besideLine(
      "in copies of their own or the lane's",
      "L1-T1 \\(Clean build\\); L1-T2 \\(Task totals\\); L1-T4 \\(Task tax\\); L1-T5 \\(Task cee\\) holds c\\.txt",
    ),
    "L1-T6 waits for it, so it is not beside it",
  );
  assert.match(
    briefOf(h, "L1-T5"),
    besideLine(
      "in copies of their own or the lane's",
      "L1-T1 \\(Clean build\\); L1-T2 \\(Task totals\\); L1-T3 \\(Task receipt\\) holds b\\.txt; L1-T4 \\(Task tax\\)",
    ),
  );
  // Added apart, it waits for the lane's copy with no after naming a task: it comes after whichever holds the copy, not beside it.
  assert.equal((await h.call(lead, "lead", "add_tasks", { tasks: [task("z", ["z.txt"])] })).ok, true);

  h.commit(opened.worktree!, "a.txt", "T1\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "done" });
  await h.idle(peer);
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  assert.deepEqual(
    ["L1-T2", "L1-T4"].map((id) => h.ledger().tasks[id]!.status),
    ["running", "waiting"],
    "L1-T2 starts once L1-T1 is merged, and L1-T4 still waits for it",
  );
  assert.notEqual(h.ledger().tasks["L1-T2"]!.peer, peer, "a task in the lane's copy gets a Peer of its own");
  assert.match(
    briefOf(h, "L1-T2"),
    besideLine("in copies of their own", "L1-T3 \\(Task receipt\\) holds b\\.txt; L1-T5 \\(Task cee\\) holds c\\.txt"),
  );

  const clashing = await h.call(lead, "lead", "add_tasks", {
    tasks: [
      task("beside", ["b.txt"], { parallel: true }),
      task("next", ["b.txt"], { parallel: true, after: ["L1-T3"] }),
    ],
  });
  assert.match(clashing.text, /BESIDE holds b\.txt, which L1-T3 holds and is still writing, and does not wait for it/);
  assert.doesNotMatch(clashing.text, /NEXT holds b\.txt, which L1-T3/, "one that waits for it is not in its way");
  const next = await h.call(lead, "lead", "add_tasks", {
    tasks: [task("next", ["b.txt"], { parallel: true, after: ["L1-T3"] })],
  });
  assert.equal(next.ok, true, next.text);

  const amend = (holds: string[]) =>
    h.call(lead, "lead", "amend_task", { task: "L1-T3", why: "the desk named a path", holds });
  assert.match(
    (await amend(["b.txt", "c.txt"])).text,
    /What it holds overlaps what L1-T5 holds at c\.txt\. Leave those paths out of L1-T3/,
  );
  assert.match((await amend(["b.txt", "package-lock.json"])).text, /A parallel task can't hold package-lock\.json/);
  assert.deepEqual(h.ledger().tasks["L1-T3"]!.holds, ["b.txt"], "a refused change leaves the record as it was");
  assert.equal((await amend(["b.txt", "d.txt"])).ok, true, "its own paths are no clash with itself");
  const receipt = h.ledger().tasks["L1-T3"]!;
  assert.deepEqual([receipt.holds, receipt.amended?.[0]?.was], [["b.txt", "d.txt"], { holds: ["b.txt"] }]);
  await h.idle(receipt.peer!);
  assert.match(h.agents.get(receipt.peer!)!.sent.join("\n"), /holds, was:\n- b\.txt\nholds, now:\n- b\.txt\n- d\.txt/);
});

test("a layout that cannot run as given is refused whole, each problem named, and nothing of it recorded", async () => {
  const { h, lead } = await lane();
  const refused = async (tasks: unknown[], ...reasons: RegExp[]) => {
    const reply = await h.call(lead, "lead", "add_tasks", { tasks });
    assert.equal(reply.ok, false, reply.text);
    for (const reason of reasons) assert.match(reply.text, reason);
    return reply.text;
  };
  const { goal: _, ...aimless } = task("a", ["a.txt"]);
  const rows: [unknown[], ...RegExp[]][] = [
    [[], /add_tasks was not carried out: it needs tasks/],
    [[task("a", ["a.txt"]), task("A", ["b.txt"])], /The key A names two tasks/],
    [
      [task("a", ["a.txt"], { after: ["nope"] })],
      /A: There is no task in this lane NOPE to wait for[^]*Take it out of after/,
    ],
    [
      [task("a", ["a.txt"], { after: ["b"] }), task("b", ["b.txt"], { after: ["a"] })],
      /The tasks loop: A, B wait for each other/,
    ],
    [[task("a", ["a.txt"], { skills: ["no-such-skill"] })], /A: .*no skill called no-such-skill/],
    [[task(" ", ["a.txt"])], /Every task has a key/],
    [
      [task("a", ["a.txt"], { title: "t".repeat(61) })],
      /title takes at most 60 characters, and has 61 in each of tasks/,
    ],
    [
      [aimless, task("b", ["b.txt"], { parallel: "yes", owner: "me" })],
      /it needs goal \(The outcome and what it is for, not the implementation\) in each of tasks\. It takes tasks\./,
    ],
    [
      [task("b", ["b.txt"], { parallel: "yes", owner: "me" })],
      /it parallel must be true or false in each of tasks; has no field owner in each of tasks\./,
    ],
    [[task("t", ["a.txt"], { role: "reviewer" })], /no reviewer that can take a task/i, /peer/],
  ];
  for (const [tasks, ...reasons] of rows) await refused(tasks, ...reasons);
  // Nothing in a Lead's context lists the Peer's skills, so the refusal is where the Lead finds out what there is.
  const guessed = await refused([task("t", ["a.txt"], { skills: ["tdd"] })], /no skill called tdd/, /They have: /);
  const real = guessed.split("They have: ")[1]!.replace(/\.$/, "").split(", ")[0]!;

  const layout = await refused(
    [
      task("left", ["src/x.ts"], { parallel: true }),
      task("right", ["src/x.ts"], { parallel: true }),
      task("lock", ["package-lock.json"], { parallel: true }),
      task("stray", ["docs/readme.md"], { parallel: true }),
      task("hint", ["docs/guide.md"]),
    ],
    /^No task was added/,
    /LEFT and RIGHT may run at once and both hold src\/x\.ts/,
    /LOCK runs beside others but holds package-lock\.json/,
    /STRAY holds docs\/readme\.md, outside the lane's write set/,
    /LOCK holds package-lock\.json, outside the lane's write set/,
  );
  assert.doesNotMatch(layout, /HINT/, "a hint outside the write set is where to read, not what it writes");
  assert.deepEqual(h.ledger().tasks, {}, "none of those recorded a task");

  await h.call(lead, "lead", "start_review", { focus: "is the cart shape right?" });
  await refused([task("L1-R1", ["a.txt"])], /The key L1-R1 is already a task of this project/);
  assert.deepEqual(Object.keys(h.ledger().tasks), ["L1-R1"]);

  const named = await h.call(lead, "lead", "add_tasks", { tasks: [task("t", ["a.txt"], { skills: [real] })] });
  assert.equal(named.ok, true, named.text);
  assert.match(named.text, /- T is L1-T1 /, "a refused task took no id");
  assert.match(briefOf(h, "L1-T1"), new RegExp(`Skills to open: ${real}`));
});

test("a call is carried out only for the role that holds its tool, in the shape that role was shown", async () => {
  // An unchecking harness sent prose, misnamed fields and lists, and the desk wrote "No summary given." into hand-backs.
  const { h, lane, peer } = await laneWithPeer();
  const lead = lane.lead!;
  const rows: [string, string, string, Record<string, unknown>, ...RegExp[]][] = [
    [
      peer,
      "peer",
      "open_lane",
      { title: "Mine", outcome: "x", acceptance: ["y"], outOfScope: ["z"] },
      /Unknown tool open_lane/,
    ],
    [peer, "lead", "add_tasks", { tasks: [task("t", ["b.txt"])] }, /lead tools are not available to it/],
    [
      peer,
      "peer",
      "done",
      { outcome: "I finished the module and tests pass", summary: "built it" },
      /outcome must be one of complete, partial, blocked/,
    ],
    [
      peer,
      "peer",
      "done",
      { outcome: "complete", summary: "built it", commits: "abc", checks: ["npm test"] },
      /no field commits/,
      /checks must be text/,
      /It takes outcome, summary, and optionally checks, leftUndone, discovered/,
    ],
    [lead, "lead", "report", { summary: "done", carries: "a note" }, /needs ready/],
    [peer, "peer", "done", { outcome: "complete", summary: "  " }, /needs summary/],
    [lead, "lead", "ask", { kind: "question", text: "Which one?" }, /needs default \(What you do meanwhile/],
    [peer, "peer", "ask", { question: "Which one?" }, /needs bestGuess \(Your best answer to it/],
  ];
  for (const [seat, role, tool, args, ...reasons] of rows) {
    const reply = await h.call(seat, role, tool, args);
    assert.equal(reply.ok, false, `${tool}: ${reply.text}`);
    for (const reason of reasons) assert.match(reply.text, reason);
  }
  assert.equal(Object.keys(h.ledger().lanes).length, 1, "nothing was opened");
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running", "nothing was handed back");
});
