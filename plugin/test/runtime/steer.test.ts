import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

test("mail a call brings about is not steered into the caller's turn until the caller has taken the call's answer", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const { lead, worktree } = h.ledger().lanes.L1!;
  await h.call(lead!, "lead", "add_tasks", { tasks: [{ key: "build", title: "Clean build", goal: "g", acceptance: ["a"], owned: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(peer)!.status = "idle";
  // As seen live: a Lead well into a long turn accepts, and the acceptance mails it MERGED at once.
  const seat = h.agents.get(lead!)!;
  seat.status = "running";
  h.runtime.outbox.turnStarted(lead!, Date.now() - 2 * 60_000);
  const spool = (h.runtime as unknown as { spool: string }).spool;
  const replyFile = join(spool, "replies", "call-1.json");
  mkdirSync(join(spool, "requests"), { recursive: true });
  writeFileSync(join(spool, "requests", "call-1.json"), JSON.stringify({ id: "call-1", agent: lead, role: "lead", tool: "accept", args: { task: "L1-T1" }, cwd: h.root, at: Date.now() }));
  (h.runtime as unknown as { serveSpool(): void }).serveSpool();
  for (let i = 0; i < 100 && !existsSync(replyFile); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(readFileSync(replyFile, "utf-8"), /L1-T1 is accepted/);
  const merged = () => [...seat.steered, ...seat.sent].filter((text) => /MERGED L1-T1/.test(text));
  assert.deepEqual(merged(), [], "a text arriving while a call waits is taken as the call being cut short");
  await h.tick();
  assert.deepEqual(merged(), [], "answered is not taken: the bridge has not read it yet");
  // The bridge takes the answer, and the next round delivers what waited.
  rmSync(replyFile);
  await h.tick();
  assert.match(seat.steered.join("\n"), /MERGED L1-T1/);
});
