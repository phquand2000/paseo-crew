import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { deskSocket } from "../../server/core/paths.ts";
import type { TeamSocket } from "../../server/runtime/team-socket.ts";
import { contracts } from "../../shared/rpc.ts";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

type Harness = ReturnType<typeof harness>;
type Heard = {
  type: string;
  id?: string;
  ok?: boolean;
  text?: string;
  choices?: Record<string, Record<string, string[]>>;
};

/** Whether `check` comes true within `ms`, looked at every 20 ms. */
async function within(ms: number, check: () => boolean): Promise<boolean> {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20)))
    if (Date.now() > end) return false;
  return true;
}

/** The Lead's team server's line to the desk of the plugin running now: what it heard, and a way to speak on it. */
async function lineOf(h: Harness, t: { after(fn: () => void): void }) {
  const socket = (h.runtime as unknown as { socket: TeamSocket }).socket;
  socket.listen();
  t.after(() => socket.close());
  const line = connect(deskSocket());
  await new Promise((resolve) => line.on("connect", resolve));
  t.after(() => line.destroy());
  const heard: Heard[] = [];
  createInterface({ input: line }).on("line", (text) => heard.push(JSON.parse(text) as Heard));
  const say = (message: object) => line.write(`${JSON.stringify(message)}\n`);
  say({ type: "hello", key: "k-lead", role: "lead", cwd: h.root });
  assert.ok(await within(2000, () => heard.some((said) => said.type === "welcome")), "the seat's key is known");
  const result = async (id: string) => {
    const answered = () => heard.find((said) => said.type === "result" && said.id === id);
    assert.ok(await within(5000, () => answered() !== undefined), `a result for ${id}`);
    return answered()!;
  };
  return { socket, heard, say, result };
}

const addTask = (id: string, title: string, holds: string) => ({
  type: "call",
  id,
  tool: "add_tasks",
  args: {
    tasks: [{ key: "t", title, goal: "g", acceptance: ["a"], holds: [holds], outOfScope: ["z"], parallel: true }],
  },
});

test("a seat's line to the desk carries its choices and its calls, and a call stopped on either side, or made before a reload is reached, is carried out and mailed", async (t) => {
  const go = join(tempDir("sw2-line-"), "go");
  t.after(() => writeFileSync(go, ""));
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  // The lane's gate waits for the test, so a report is still being worked on when its caller stops it.
  await h.call(sup, "supervisor", "set_project", { gate: `until [ -f ${go} ]; do sleep 0.05; done`, gateOn: "lane" });
  await h.call(sup, "supervisor", "open_lane", {
    title: "Build",
    outcome: "a.txt changes",
    acceptance: ["a"],
    outOfScope: ["anything else in the repository"],
  });
  const lane = h.ledger().lanes.L1!;
  const lead = lane.lead!;
  const seat = h.agents.get(lead)!;
  // The Lead's key, as Paseo opens its session; then its team server's line to the desk.
  h.runtime.sessionOpen({
    agentId: lead,
    reason: "create",
    provider: seat.provider,
    cwd: h.root,
    env: { SEATWORKS_DESK_KEY: "k-lead" },
  });
  const { socket, heard, say, result } = await lineOf(h, t);
  const skills = (said?: Heard) => said?.choices?.add_tasks?.skills ?? [];
  assert.ok(skills(heard[0]).includes("ide-index-mcp"), "Peers have the IDE server, so a Lead may name its skill");
  const read = await h.rpc(contracts.settingsRead, { project: h.project.slug });
  const saved = await h.rpc(contracts.settingsWrite, {
    project: h.project.slug,
    revision: read.revision,
    values: { mcp: { "intellij-index": { enabled: false } } },
  });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  assert.ok(await within(2000, () => heard.some((said) => said.type === "choices")), "the seat's server is told");
  const choices = heard.find((said) => said.type === "choices");
  assert.equal(skills(choices).includes("ide-index-mcp"), false, "without the server, its skill is no choice");

  // As seen live: a Lead well into a long turn accepts, and the merge mails it MERGED before that turn ends.
  await h.call(lead, "lead", "add_tasks", {
    tasks: [{ key: "t", title: "Clean build", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["z"] }],
  });
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  h.commit(lane.worktree!, "a.txt", "A\n");
  await h.call(peer, "peer", "done", { outcome: "complete", summary: "a" });
  h.agents.get(peer)!.status = "idle";
  seat.status = "running";
  h.runtime.outbox.turnStarted(lead, Date.now() - 2 * 60_000);
  say({ type: "call", id: "accept", tool: "accept", args: { task: "L1-T1" } });
  assert.match((await result("accept")).text ?? "", /L1-T1 is in the merge queue/);
  await h.runtime.desk.settled(h.project);
  const merged = () => [...seat.steered, ...seat.sent].filter((text) => /MERGED L1-T1/.test(text));
  assert.deepEqual(merged(), [], "a text arriving while a call waits is taken as the call being cut short");
  await h.tick();
  assert.deepEqual(merged(), [], "answered is not taken: the harness has not read it yet");
  say({ type: "taken", id: "accept" });
  assert.ok(await within(2000, () => !socket.calling(lead)));
  await h.tick();
  assert.match(seat.steered.join("\n"), /MERGED L1-T1/, "the next round delivers what waited");

  const mailed = (tool: string) =>
    within(5000, () =>
      new RegExp(`ANSWER to your ${tool} call, which was stopped on your side before its answer reached you\\.`).test(
        h.heard(lead).join("\n"),
      ),
    );
  say({ type: "call", id: "status", tool: "status", args: {} });
  await result("status");
  say({ type: "cancel", id: "status" });
  assert.ok(await mailed("status"), "an answer that reached the line but not the harness");
  say({ type: "call", id: "report", tool: "report", args: { summary: "done", ready: true } });
  say({ type: "cancel", id: "report" });
  writeFileSync(go, "");
  assert.ok(await mailed("report"), "stopped before its answer came, it is mailed once its gate is done");

  // Loaded again, the plugin has Paseo's API only once a hook or a panel call brings it.
  const host = new PaseoHost();
  h.restart(host);
  const reloaded = await lineOf(h, t);
  reloaded.say(addTask("a", "Waits", "x.txt"));
  reloaded.say(addTask("b", "Stopped", "y.txt"));
  reloaded.say({ type: "cancel", id: "b" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    reloaded.heard.some((said) => said.type === "result"),
    false,
    "it waits, as the call cannot reach a seat yet",
  );
  host.answering({
    handle: (_contract: unknown, handler: (input: unknown, context: { paseo: unknown }) => unknown) =>
      handler(undefined, { paseo: h.paseo }),
  } as never)({ name: "status" }, () => undefined);
  const waited = await reloaded.result("a");
  assert.equal(waited.ok, true, waited.text);
  const started = Object.values(h.ledger().tasks).find((entry) => entry.title === "Waits")!;
  assert.ok(started.peer, "carried out once Paseo came, its task started with a Peer of its own");
  assert.ok(await mailed("add_tasks"), "one its harness stopped meanwhile is carried out too, and mailed");
});
