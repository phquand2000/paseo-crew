import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { settle } from "./fake-timeline.ts";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const planned = (key: string, title: string, extra: Record<string, unknown>) => ({
  key,
  title,
  goal: "g",
  ...scope,
  ...extra,
});

/** A lane with a write set, its Lead, and nothing started; `settings` are the project's own. */
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

/** The notes in what `seat` was sent, from the last letter that says `from` on. */
function notes(h: Harness, seat: string, from = "") {
  const mail = h.agents.get(seat)!.sent.join("\n");
  return mail
    .slice(from ? mail.lastIndexOf(from) : 0)
    .split("\n")
    .filter((line) => line.startsWith("Note:"));
}

/** Commits `files` in the task's copy and hands it back. */
async function handBack(h: Harness, id: string, files: string[]) {
  const task = h.ledger().tasks[id]!;
  for (const file of files) {
    mkdirSync(dirname(join(task.worktree!, file)), { recursive: true });
    h.commit(task.worktree!, file, `${file}\n`);
  }
  await h.call(task.peer!, "peer", "done", { outcome: "complete", summary: files.join(", ") });
  h.agents.get(task.peer!)!.status = "idle";
}

test("a task beside others holds its paths: refused when it cannot hold them, briefed on what it holds, and its neighbour told when it starts", async () => {
  const { h, lead } = await laneWriting(["src/**", "test/**"]);
  const add = (...tasks: unknown[]) => h.call(lead, "lead", "add_tasks", { tasks });
  const brief = (id: string) => h.agents.get(h.ledger().tasks[id]!.peer!)!.prompt ?? "";
  const beside = add(
    planned("a", "A", { holds: ["src/app.ts"], parallel: true }),
    planned("b", "B", { parallel: true }),
  );
  assert.match((await beside).text, /B runs beside others but holds nothing/);
  assert.match(
    (await add(planned("c", "C", { holds: ["src/app.ts"] }))).text,
    /C holds src\/app\.ts but runs in the lane's copy, which has one writer at a time: leave holds out, or give those paths as hints\./,
  );
  assert.deepEqual(h.ledger().tasks, {});

  await add(planned("t", "Totals", { hints: ["src/cart.ts"] }));
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  assert.match(
    brief("L1-T1"),
    /\n\nWhere to start reading \(a start, not a fence\):\n- src\/cart\.ts\n\nWhere the change goes, callers and tests included, is yours to find, inside the lane's write set: src\/\*\*, test\/\*\*\.\n\nOut of scope:/,
  );
  await add(planned("r", "Receipt", { holds: ["src/receipt/"], parallel: true }));
  const receipt = h.ledger().tasks["L1-T2"]!;
  assert.match(
    brief("L1-T2"),
    /\n\nYou hold \(others write beside you, so ask before writing outside it\):\n- src\/receipt\/\n\nOut of scope:/,
  );
  assert.doesNotMatch(brief("L1-T2"), /Where to start reading/);
  assert.equal(receipt.slot, "S0");
  assert.equal(h.agents.get(receipt.peer!)!.cwd, h.ledger().slots.S0!.path);
  const told =
    /BESIDE L1-T2 \(Receipt\) now runs beside you in a copy of its own and holds src\/receipt\/\.\n\nNext: Leave that to it, and ask your Lead if your goal needs it\./;
  assert.match(h.heard(peer).join("\n"), told);
  assert.doesNotMatch(h.heard(receipt.peer!).join("\n"), /BESIDE/);
  await h.idle(peer);
  assert.match(h.agents.get(peer)!.sent.join("\n"), /BESIDE L1-T2/);

  await handBack(h, "L1-T2", ["src/receipt/total.ts"]);
  await h.call(lead, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  assert.equal(h.ledger().tasks["L1-T2"]!.status, "merged");
  assert.equal(h.git(h.root, "show", `${h.ledger().lanes.L1!.branch}:src/receipt/total.ts`), "src/receipt/total.ts\n");
  assert.deepEqual(Object.keys(h.ledger().slots), ["S0"]);

  await h.call(peer, "peer", "done", { outcome: "complete", summary: "totals" });
  await add(planned("o", "Totals by day", { holds: ["src/totals/"], parallel: true }));
  await h.idle(peer);
  assert.doesNotMatch(h.agents.get(peer)!.sent.join("\n"), /BESIDE L1-T3/);
  assert.match(
    h.heard(peer).join("\n"),
    /BESIDE L1-T3 \(Totals by day\) now runs beside you in a copy of its own and holds src\/totals\/\./,
  );
});

test("a Peer writing past where it was pointed is noted, not stopped: at hand-back, at merge and by the watch", async () => {
  const { h, sup, lead } = await laneWriting(["a.txt", "c.txt", "package-lock.json", "src/**"], {
    attention: { watch: true },
  });
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      planned("t", "T", { hints: ["a.txt"] }),
      planned("s", "S", { holds: ["c.txt", "**/*.md"], parallel: true }),
    ],
  });
  await h.tick();
  const [own, side] = ["L1-T1", "L1-T2"].map((id) => h.ledger().tasks[id]!);
  const edit = (task: typeof own, file: string, call: string) => {
    const timeline = h.timelineOf(task!.peer!);
    timeline.beat("turn_started", `${call}-turn`);
    const detail = { type: "edit", filePath: join(task!.worktree!, file), oldString: "", newString: "x\n" };
    timeline.add({ type: "tool_call", callId: call, name: "Edit", status: "completed", detail }, `${call}-turn`);
  };
  edit(own, "src/caller.ts", "w1");
  edit(own, "d.txt", "w2");
  edit(side, "a.txt", "w3");
  await settle();
  const facts = h.events("watch.fact").filter((event) => event.fact === "outside-scope");
  assert.deepEqual(
    facts.map((event) => `${event.agent === own!.peer ? "own" : "side"} ${event.quote.split("/").at(-1)}`).sort(),
    ["own d.txt", "side a.txt"],
  );

  await handBack(h, "L1-T1", ["a.txt", "src/caller.ts"]);
  await h.idle(lead);
  assert.match(h.agents.get(lead)!.sent.join("\n"), /Discovered: nothing\nChanged: a\.txt, src\/caller\.ts\n/);
  assert.deepEqual(notes(h, lead), []);
  await h.call(lead, "lead", "rework", { task: "L1-T1", text: "take in the notes too" });
  await handBack(h, "L1-T1", ["d.txt", "notes.md"]);
  await h.idle(lead);
  assert.deepEqual(notes(h, lead, "d.txt, notes.md"), [
    "Note: in what L1-T2 holds (c.txt, **/*.md): notes.md.",
    "Note: outside the lane's write set (a.txt, c.txt, package-lock.json, src/**): d.txt.",
  ]);
  await h.call(lead, "lead", "accept", { task: "L1-T1" });
  await h.runtime.desk.settled(h.project);
  await h.idle(lead);
  assert.ok(notes(h, lead, "MERGED L1-T1").includes("Note: in what L1-T2 holds (c.txt, **/*.md): notes.md."));

  await handBack(h, "L1-T2", ["c.txt", "package-lock.json"]);
  await h.idle(lead);
  const lock = "Note: outside what it holds (c.txt, **/*.md): package-lock.json (one writer at a time).";
  assert.ok(notes(h, lead, "c.txt, package-lock.json").includes(lock));
  await h.call(lead, "lead", "accept", { task: "L1-T2" });
  await h.runtime.desk.settled(h.project);
  await h.idle(lead);
  assert.ok(notes(h, lead, "MERGED L1-T2").includes(lock));

  h.agents.get(lead)!.status = "idle";
  await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "done here" });
  const cart = { title: "Parts", outcome: "parts", ...scope, writeSet: ["src/**"], isolate: true };
  await h.call(sup, "supervisor", "open_lane", cart);
  const other = h.ledger().lanes.L2!.lead!;
  await h.call(other, "lead", "add_tasks", {
    tasks: [
      planned("p", "P", { holds: ["src/p/"], parallel: true }),
      planned("q", "Q", { holds: ["src/q/"], parallel: true }),
    ],
  });
  await handBack(h, "L2-T1", ["src/p/a.ts", "src/q/b.ts", "src/c.ts", "d.md"]);
  await h.idle(other);
  assert.deepEqual(notes(h, other), [
    "Note: in what L2-T2 holds (src/q/): src/q/b.ts.",
    "Note: outside the lane's write set (src/**): d.md.",
    "Note: outside what it holds (src/p/): src/c.ts.",
  ]);
});
