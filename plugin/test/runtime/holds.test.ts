import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { settle } from "./fake-timeline.ts";
import { harness, laneWithPeer } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };

/** A lane with a write set, a Lead, and nothing started. */
async function laneWriting(writeSet: string[], settings?: Record<string, unknown>) {
  const h = harness();
  if (settings) {
    mkdirSync(h.project.state, { recursive: true });
    writeFileSync(join(h.project.state, "settings.json"), JSON.stringify(settings));
  }
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, writeSet });
  return { h, sup, lead: h.ledger().lanes.L1!.lead! };
}

const letters = (h: ReturnType<typeof harness>, id: string) => h.agents.get(id)!.sent.join("\n");

test("a task beside others that holds nothing is refused, and so is one in the lane's copy that holds paths", async () => {
  const { h, lead } = await laneWriting(["src/**"]);
  const refused = async (tasks: unknown[]) => {
    const reply = await h.call(lead, "lead", "add_tasks", { tasks });
    assert.equal(reply.ok, false, reply.text);
    return reply.text;
  };
  assert.match(await refused([{ key: "a", title: "A", goal: "g", ...scope, holds: ["src/app.ts"], parallel: true }, { key: "b", title: "B", goal: "g", ...scope, parallel: true }]), /B runs beside others but holds nothing/);
  assert.match(await refused([{ key: "c", title: "C", goal: "g", ...scope, holds: ["src/app.ts"] }]), /C holds src\/app\.ts but runs in the lane's copy, which has one writer at a time: leave holds out, or give those paths as hints\./);
  assert.deepEqual(h.ledger().tasks, {});
});

test("a brief points where to start reading, not a fence, and names what a task beside others holds", async () => {
  const { h, lead } = await laneWriting(["src/**", "test/**"]);
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      { key: "t", title: "Totals", goal: "g", ...scope, hints: ["src/cart.ts"] },
      { key: "s", title: "Receipt", goal: "g", ...scope, holds: ["src/receipt/"], parallel: true },
    ],
  });
  const brief = (id: string) => h.agents.get(h.ledger().tasks[id]!.peer!)!.prompt ?? "";
  assert.match(brief("L1-T1"), /\n\nWhere to start reading \(a start, not a fence\):\n- src\/cart\.ts\n\nWhere the change goes, callers and tests included, is yours to find, inside the lane's write set: src\/\*\*, test\/\*\*\.\n\nOut of scope:/);
  assert.match(brief("L1-T1"), /Beside you, in copies of their own, each merged into the lane branch once accepted: L1-T2 \(Receipt\) holds src\/receipt\/\. What they write reaches your copy only as your hand-back brings the lane in/);
  assert.match(brief("L1-T2"), /\n\nYou hold \(others write beside you, so ask before writing outside it\):\n- src\/receipt\/\n\nOut of scope:/);
  assert.doesNotMatch(brief("L1-T2"), /Where to start reading/, "no hints given, none shown");
});

test("a Peer in the lane's copy changes what its goal needs, a caller past where it was pointed included, and none of it is flagged", async () => {
  const { h, lane, peer } = await laneWithPeer();
  h.commit(lane.worktree!, "a.txt", "A\n");
  h.commit(lane.worktree!, "b.txt", "B\n");
  const handed = await h.call(peer, "peer", "done", { outcome: "complete", summary: "a, and its caller b" });
  assert.match(handed.text, /^Handed back\. End your turn now/);
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), /Discovered: nothing\nChanged: a\.txt, b\.txt\n/);
  assert.doesNotMatch(letters(h, lane.lead!), /Note:/);
});

test("a Peer beside others that writes outside what it holds is flagged at hand-back and merge, a path one writer at a time may write marked", async () => {
  const { h, lane } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", ...scope, holds: ["c.txt"], parallel: true }] });
  const side = h.ledger().tasks["L1-T2"]!;
  h.commit(side.worktree!, "c.txt", "C\n");
  h.commit(side.worktree!, "package-lock.json", "{ \"lockfileVersion\": 3 }\n");
  await h.call(side.peer!, "peer", "done", { outcome: "complete", summary: "c, and an install" });
  await h.idle(lane.lead!);
  const flag = /Note: outside what it holds \(c\.txt\): package-lock\.json \(one writer at a time\)\./;
  assert.match(letters(h, lane.lead!), flag);
  assert.equal((await h.call(lane.lead!, "lead", "accept", { task: "L1-T2" })).ok, true);
  await h.runtime.desk.settled(h.project);
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!).split("MERGED L1-T2")[1] ?? "", flag);
});

test("a task in the lane's copy that writes into what a task beside it holds is flagged with whose it is", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", ...scope, holds: ["c.txt"], parallel: true }] });
  h.commit(lane.worktree!, "a.txt", "A\n");
  h.commit(lane.worktree!, "c.txt", "mine\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a, and c on the way" });
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!), /Note: in what L1-T2 holds \(c\.txt\): c\.txt\./);
  await h.idle(peer);
  await h.call(lane.lead!, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  await h.idle(lane.lead!);
  assert.match(letters(h, lane.lead!).split("MERGED L1-T1")[1] ?? "", /Note: in what L1-T2 holds \(c\.txt\): c\.txt\./);
});

test("a hand-back names each file once: in what a task beside it holds before outside the lane's write set", async () => {
  const { h, lead } = await laneWriting(["a.txt", "c.txt", "src/**"]);
  // A held glob need only meet the write set, so what it holds can reach past it.
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "t", title: "T", goal: "g", ...scope, hints: ["a.txt"] }, { key: "s", title: "S", goal: "g", ...scope, holds: ["c.txt", "**/*.md"], parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  for (const file of ["a.txt", "c.txt", "d.txt", "notes.md"]) h.commit(task.worktree!, file, `${file}\n`);
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "a, c, d and notes" });
  await h.idle(lead);
  const notes = letters(h, lead).split("\n").filter((line) => line.startsWith("Note:"));
  assert.deepEqual(notes, ["Note: in what L1-T2 holds (c.txt, **/*.md): c.txt, notes.md.", "Note: outside the lane's write set (a.txt, c.txt, src/**): d.txt."]);
});

test("a Peer beside others is noted once for each file past what it holds: in what another holds, outside the write set, or only outside its own", async () => {
  const { h, lead } = await laneWriting(["src/**"]);
  await h.call(lead, "lead", "add_tasks", { tasks: [{ key: "p", title: "P", goal: "g", ...scope, holds: ["src/p/"], parallel: true }, { key: "q", title: "Q", goal: "g", ...scope, holds: ["src/q/"], parallel: true }] });
  const task = h.ledger().tasks["L1-T1"]!;
  for (const file of ["src/p/a.ts", "src/q/b.ts", "src/c.ts", "d.md"]) {
    mkdirSync(dirname(join(task.worktree!, file)), { recursive: true });
    h.commit(task.worktree!, file, `${file}\n`);
  }
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: "p, and more" });
  await h.idle(lead);
  const notes = letters(h, lead).split("\n").filter((line) => line.startsWith("Note:"));
  assert.deepEqual(notes, ["Note: in what L1-T2 holds (src/q/): src/q/b.ts.", "Note: outside the lane's write set (src/**): d.md.", "Note: outside what it holds (src/p/): src/c.ts."]);
});

test("the watch reads a Peer in the lane's copy against the lane's write set, and one beside others against what it holds", async () => {
  const { h, lead } = await laneWriting(["a.txt", "b.txt", "c.txt"], { attention: { watch: true } });
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      { key: "t", title: "T", goal: "g", ...scope, hints: ["a.txt"] },
      { key: "s", title: "S", goal: "g", ...scope, holds: ["c.txt"], parallel: true },
    ],
  });
  await h.tick();
  const write = (id: string, file: string, call: string) => {
    const task = h.ledger().tasks[id]!;
    const timeline = h.timelineOf(task.peer!);
    timeline.beat("turn_started", `${call}-turn`);
    timeline.add({ type: "tool_call", callId: call, name: "Edit", status: "completed", detail: { type: "edit", filePath: join(task.worktree!, file), oldString: "", newString: "x\n" } }, `${call}-turn`);
  };
  write("L1-T1", "b.txt", "w1");
  write("L1-T1", "d.txt", "w2");
  write("L1-T2", "b.txt", "w3");
  await settle();
  const facts = h.events("watch.fact").filter((event) => event.fact === "outside-scope");
  const peers = ["L1-T1", "L1-T2"].map((id) => h.ledger().tasks[id]!.peer!);
  assert.deepEqual(facts.map((event) => `${peers.indexOf(event.agent)} ${event.quote.split("/").at(-1)}`).sort(), ["0 d.txt", "1 b.txt"]);
});

test("a Lead points a task somewhere new or tells it what was found, and only a task beside others holds paths", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const amend = (args: Record<string, unknown>) => h.call(lane.lead!, "lead", "amend_task", { why: "the parser lives there", ...args });
  assert.equal((await amend({ task: "L1-T1", hints: ["a.txt", "b.txt"], context: "The header parser is in b.txt." })).ok, true);
  await h.idle(peer);
  assert.match(letters(h, peer), /context, was:\nnone\ncontext, now:\nThe header parser is in b\.txt\./);
  assert.deepEqual(h.ledger().tasks["L1-T1"]!.amended?.[0]?.was, { context: "", hints: ["a.txt"] }, "a context it never had is kept as none, not dropped from the record");
  assert.match((await amend({ task: "L1-T1", holds: ["a.txt"] })).text, /L1-T1 works in the lane's copy, one writer at a time, so it holds nothing: point it with hints instead\./);

  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Side", goal: "g", ...scope, holds: ["c.txt"], parallel: true }] });
  assert.match((await amend({ task: "L1-T2", holds: [] })).text, /keeps at least one held path/);
  assert.deepEqual(h.ledger().tasks["L1-T2"]!.holds, ["c.txt"], "a refused change leaves the record as it was");
});

test("a Peer at work in the lane's copy is told when a task starts beside it after its brief, and what that task holds", async () => {
  const { h, lane, peer } = await laneWithPeer();
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "s", title: "Receipt", goal: "g", ...scope, holds: ["src/receipt/"], parallel: true }] });
  const told = h.heard(peer).join("\n");
  assert.match(told, /BESIDE L1-T2 \(Receipt\) now runs beside you in a copy of its own and holds src\/receipt\/\.\n\nNext: Leave that to it, and ask your Lead if your goal needs it\./);
  assert.doesNotMatch(h.heard(h.ledger().tasks["L1-T2"]!.peer!).join("\n"), /BESIDE/, "its own brief already names who writes beside it");

  await h.idle(peer);
  assert.match(letters(h, peer), /BESIDE L1-T2/, "at work, it is told now");

  // Handed back, it is not at work: the word waits for the next letter that asks something of it.
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  await h.call(lane.lead!, "lead", "add_tasks", { tasks: [{ key: "t", title: "Totals", goal: "g", ...scope, holds: ["src/totals/"], parallel: true }] });
  await h.idle(peer);
  assert.doesNotMatch(letters(h, peer), /BESIDE L1-T3/);
  assert.match(h.heard(peer).join("\n"), /BESIDE L1-T3 \(Totals\) now runs beside you in a copy of its own and holds src\/totals\/\./);
});
