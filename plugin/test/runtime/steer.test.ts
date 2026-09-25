import assert from "node:assert/strict";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { deskSocket } from "../../server/core/paths.ts";
import type { TeamSocket } from "../../server/runtime/team-socket.ts";
import { harness } from "./harness.ts";

test("mail a call brings about is not steered into the caller's turn until the caller has taken the call's answer", async (t) => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const { lead, worktree } = h.ledger().lanes.L1!;
  await h.call(lead!, "lead", "add_tasks", { tasks: [{ key: "build", title: "Clean build", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(peer)!.status = "idle";
  // As seen live: a Lead well into a long turn accepts, and the merge mails it MERGED before that turn ends.
  const seat = h.agents.get(lead!)!;
  seat.status = "running";
  h.runtime.outbox.turnStarted(lead!, Date.now() - 2 * 60_000);
  // The Lead's key, as Paseo opens its session; then its team server's line to the desk.
  h.runtime.sessionOpen({ agentId: lead!, reason: "create", provider: seat.provider, cwd: h.root, env: { SEATWORKS_DESK_KEY: "k-lead" } });
  const socket = (h.runtime as unknown as { socket: TeamSocket }).socket;
  socket.listen();
  t.after(() => socket.close());
  const line = connect(deskSocket());
  await new Promise((resolve) => line.on("connect", resolve));
  const heard: { type: string; text?: string }[] = [];
  createInterface({ input: line }).on("line", (text) => heard.push(JSON.parse(text)));
  const say = (message: object) => line.write(`${JSON.stringify(message)}\n`);
  say({ type: "hello", key: "k-lead", role: "lead", cwd: h.root });
  say({ type: "call", id: "1", tool: "accept", args: { task: "L1-T1" } });
  for (let i = 0; i < 100 && !heard.some((said) => said.type === "result"); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(heard.find((said) => said.type === "result")?.text ?? "", /L1-T1 is in the merge queue/);
  await h.runtime.desk.settled(h.project);
  const merged = () => [...seat.steered, ...seat.sent].filter((text) => /MERGED L1-T1/.test(text));
  assert.deepEqual(merged(), [], "a text arriving while a call waits is taken as the call being cut short");
  await h.tick();
  assert.deepEqual(merged(), [], "answered is not taken: the harness has not read it yet");
  // The harness takes the answer, and the next round delivers what waited.
  say({ type: "taken", id: "1" });
  for (let i = 0; i < 100 && socket.calling(lead!); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  await h.tick();
  assert.match(seat.steered.join("\n"), /MERGED L1-T1/);
  line.destroy();
});
