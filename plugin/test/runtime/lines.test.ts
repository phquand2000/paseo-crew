import assert from "node:assert/strict";
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { deskSocket } from "../../server/core/paths.ts";
import type { TeamSocket } from "../../server/runtime/team-socket.ts";
import { harness } from "./harness.ts";

type Heard = { type: string; id?: string; text?: string; choices?: Record<string, Record<string, string[]>> };

const within = async (ms: number, check: () => boolean) => {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20))) if (Date.now() > end) return false;
  return true;
};

/** A lane whose Lead's team server holds a line to the desk: what the line heard, and a way to speak on it. */
async function leadOnTheLine(t: { after(fn: () => void): void }, gate?: string) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  if (gate) await h.call(sup, "supervisor", "set_project", { gate, gateOn: "lane" });
  await h.call(sup, "supervisor", "open_lane", { title: "Build", outcome: "a.txt changes", acceptance: ["a"], outOfScope: ["anything else in the repository"] });
  const lead = h.ledger().lanes.L1!.lead!;
  const seat = h.agents.get(lead)!;
  h.runtime.sessionOpen({ agentId: lead, reason: "create", provider: seat.provider, cwd: h.root, env: { SEATWORKS_DESK_KEY: "k-lead" } });
  const socket = (h.runtime as unknown as { socket: TeamSocket }).socket;
  socket.listen();
  t.after(() => socket.close());
  const line = connect(deskSocket());
  await new Promise((resolve) => line.on("connect", resolve));
  t.after(() => line.destroy());
  const heard: Heard[] = [];
  createInterface({ input: line }).on("line", (text) => heard.push(JSON.parse(text)));
  const say = (message: object) => line.write(`${JSON.stringify(message)}\n`);
  say({ type: "hello", key: "k-lead", role: "lead", cwd: h.root });
  assert.ok(await within(2000, () => heard.some((said) => said.type === "welcome")));
  return { h, lead, seat, heard, say };
}

test("a settings save that changes what a seat's fields take reaches its line as new choices", async (t) => {
  const { h, heard } = await leadOnTheLine(t);
  const skills = (said?: Heard) => said?.choices?.add_tasks?.skills ?? [];
  assert.ok(skills(heard[0]).includes("ide-index-mcp"), "Peers have the IDE server, so a Lead may tell one to open its skill");
  const read = await h.rpc(contracts.settingsRead, { project: h.project.slug });
  const saved = await h.rpc(contracts.settingsWrite, { project: h.project.slug, revision: read.revision, values: { mcp: { "intellij-index": { enabled: false } } } });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  assert.ok(await within(2000, () => heard.some((said) => said.type === "choices")), "the seat's server is told, and tells its harness the list changed");
  assert.equal(skills(heard.find((said) => said.type === "choices")).includes("ide-index-mcp"), false, "without the server, its skill is no choice");
});

test("a call its harness stopped before the answer came is answered by mail, saying it was stopped", async (t) => {
  const { h, lead, seat, say } = await leadOnTheLine(t, "sleep 0.4");
  say({ type: "call", id: "1", tool: "report", args: { summary: "done", ready: true } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  say({ type: "cancel", id: "1" });
  assert.ok(await within(5000, () => h.runtime.outbox.letters().some((letter) => /ANSWER to your report call/.test(letter.text))), "posted once its gate is done");
  await h.idle(lead);
  assert.match(seat.sent.join("\n"), /ANSWER to your report call, which was stopped on your side before its answer reached you\./);
});

test("an answer that reached the line but not the harness is mailed, saying the call was stopped", async (t) => {
  const { h, lead, seat, heard, say } = await leadOnTheLine(t);
  say({ type: "call", id: "1", tool: "status", args: {} });
  assert.ok(await within(2000, () => heard.some((said) => said.type === "result")));
  say({ type: "cancel", id: "1" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await h.idle(lead);
  assert.match(seat.sent.join("\n"), /ANSWER to your status call, which was stopped on your side before its answer reached you\./);
});

/** The Lead's line to a plugin loaded again, which Paseo has not reached yet; `reach` makes a panel call that hands over its API. */
async function reloadedLine(t: { after(fn: () => void): void }) {
  const { h, lead, seat } = await leadOnTheLine(t);
  const host = new PaseoHost();
  h.restart(host);
  const socket = (h.runtime as unknown as { socket: TeamSocket }).socket;
  socket.listen();
  t.after(() => socket.close());
  const line = connect(deskSocket());
  await new Promise((resolve) => line.on("connect", resolve));
  t.after(() => line.destroy());
  const heard: Heard[] = [];
  createInterface({ input: line }).on("line", (text) => heard.push(JSON.parse(text)));
  const say = (message: object) => line.write(`${JSON.stringify(message)}\n`);
  say({ type: "hello", key: "k-lead", role: "lead", cwd: h.root });
  assert.ok(await within(2000, () => heard.some((said) => said.type === "welcome")), "the seat's key outlives the restart");
  const reach = () => host.answering({ handle: (_contract: unknown, handler: (input: unknown, context: { paseo: unknown }) => unknown) => handler(undefined, { paseo: h.paseo }) } as never)({ name: "status" }, () => undefined);
  return { h, lead, seat, heard, say, reach };
}

const addTask = { type: "call", id: "1", tool: "add_tasks", args: { tasks: [{ key: "t", title: "Clean build", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest of the repository"] }] } };

test("a call that comes before Paseo has reached the plugin again waits for it rather than failing, and is carried out once it has", async (t) => {
  const { h, heard, say, reach } = await reloadedLine(t);
  say(addTask);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(heard.some((said) => said.type === "result"), false, "it waits, as the call cannot reach a seat yet");
  reach();
  assert.ok(await within(3000, () => heard.some((said) => said.type === "result")));
  const result = heard.find((said) => said.type === "result") as Heard & { ok?: boolean };
  assert.equal(result.ok, true, result.text);
  assert.ok(h.ledger().tasks["L1-T1"]!.peer, "its task started with a Peer of its own");
});

test("a call its harness stops while it waits for Paseo is carried out once Paseo comes, and answered by mail", async (t) => {
  const { h, lead, seat, say, reach } = await reloadedLine(t);
  say(addTask);
  await new Promise((resolve) => setTimeout(resolve, 100));
  say({ type: "cancel", id: "1" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  reach();
  assert.ok(await within(3000, () => h.runtime.outbox.letters().some((letter) => /ANSWER to your add_tasks call/.test(letter.text))), "the answer, which reached no harness, is mailed");
  await h.idle(lead);
  assert.match(seat.sent.join("\n"), /ANSWER to your add_tasks call, which was stopped on your side before its answer reached you\./);
});
