import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { type Socket, connect } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { ToolReply, ToolRequest } from "../../server/desk/context.ts";
import { TeamSocket } from "../../server/runtime/team-socket.ts";
import { tempDir } from "../tempdir.ts";

type Asked = { request: ToolRequest; cancelled: AbortSignal; answer: (reply: ToolReply) => void };

/** A desk that knows key k1 as agent-1 and answers each call when the test says. */
function desk() {
  const asked: Asked[] = [];
  const lost: [ToolRequest, ToolReply][] = [];
  const choices = { value: { note: { kind: ["plans"] } } as Record<string, Record<string, string[]>> };
  const path = join(tempDir("sw2-sock-"), "d.sock");
  const socket = new TeamSocket(path, {
    agentOf: (key) => (key === "k1" ? "agent-1" : undefined),
    choices: () => choices.value,
    answer: (request, cancelled) => new Promise((answer) => asked.push({ request, cancelled, answer })),
    mailLost: async (request, reply) => void lost.push([request, reply]),
  });
  return { socket, path, asked, lost, choices };
}

/** A seat's server on the line: what it heard, and a way to say something. */
async function line(path: string) {
  const heard: Record<string, unknown>[] = [];
  const socket = connect(path);
  await new Promise((resolve) => socket.on("connect", resolve));
  createInterface({ input: socket }).on("line", (text) => heard.push(JSON.parse(text)));
  return { socket, heard, say: (message: object) => socket.write(`${JSON.stringify(message)}\n`) };
}

const within = async (ms: number, check: () => boolean) => {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 10)))
    if (Date.now() > end) return false;
  return true;
};

async function opened(t: { after(fn: () => void): void }) {
  const found = desk();
  found.socket.listen();
  t.after(() => found.socket.close());
  await within(2000, () => {
    try {
      return statSync(found.path).isSocket();
    } catch {
      return false;
    }
  });
  return found;
}

test("a line showing a key the desk does not hold is refused, and a call on it carries nothing out", async (t) => {
  const { path, asked } = await opened(t);
  const seat = await line(path);
  seat.say({ type: "hello", key: "nope", role: "lead", cwd: "/w" });
  seat.say({ type: "call", id: "1", tool: "status", args: {} });
  assert.ok(await within(2000, () => seat.heard.length === 2));
  assert.match(String(seat.heard[0]!.why), /^The desk does not know this agent's key/);
  assert.deepEqual({ ...seat.heard[1], text: undefined }, { type: "result", id: "1", ok: false, text: undefined });
  assert.equal(asked.length, 0);
  seat.socket.destroy();
});

test("a line is known by its key: its calls are that agent's, answered on the line, and waited on until the harness took the answer", async (t) => {
  const { path, asked, socket } = await opened(t);
  const seat = await line(path);
  seat.say({ type: "hello", key: "k1", role: "lead", cwd: "/work" });
  assert.ok(await within(2000, () => seat.heard.length === 1));
  assert.deepEqual(seat.heard[0], { type: "welcome", choices: { note: { kind: ["plans"] } } });
  seat.say({ type: "call", id: "7", tool: "accept", args: { task: "L1-T1" } });
  assert.ok(await within(2000, () => asked.length === 1));
  const { request } = asked[0]!;
  assert.deepEqual(
    { agent: request.agent, role: request.role, tool: request.tool, args: request.args, cwd: request.cwd },
    { agent: "agent-1", role: "lead", tool: "accept", args: { task: "L1-T1" }, cwd: "/work" },
  );
  assert.equal(socket.calling("agent-1"), true, "waited on while it runs");
  asked[0]!.answer({ ok: true, text: "queued" });
  assert.ok(await within(2000, () => seat.heard.length === 2));
  assert.deepEqual(seat.heard[1], { type: "result", id: "7", ok: true, text: "queued" });
  assert.equal(socket.calling("agent-1"), true, "answered is not taken");
  seat.say({ type: "taken", id: "7" });
  assert.ok(await within(2000, () => !socket.calling("agent-1")));
  seat.socket.destroy();
});

test("a call its harness stopped before the answer is mailed by the desk when it comes; one stopped after, at once", async (t) => {
  const { path, asked, lost } = await opened(t);
  const seat = await line(path);
  seat.say({ type: "hello", key: "k1", role: "lead", cwd: "/work" });
  seat.say({ type: "call", id: "1", tool: "report", args: {} });
  assert.ok(await within(2000, () => asked.length === 1));
  seat.say({ type: "cancel", id: "1" });
  assert.ok(await within(2000, () => asked[0]!.cancelled.aborted), "the desk answers it by mail");
  asked[0]!.answer({ ok: true, text: "reported" });
  seat.say({ type: "call", id: "2", tool: "status", args: {} });
  assert.ok(await within(2000, () => asked.length === 2));
  asked[1]!.answer({ ok: true, text: "all well" });
  assert.ok(await within(2000, () => seat.heard.some((said) => said.id === "2")));
  assert.equal(
    seat.heard.some((said) => said.id === "1"),
    false,
    "nothing is answered on the line for a stopped call",
  );
  seat.say({ type: "cancel", id: "2" });
  assert.ok(await within(2000, () => lost.length === 1));
  assert.deepEqual([lost[0]![0].tool, lost[0]![1]], ["status", { ok: true, text: "all well" }]);
  seat.socket.destroy();
});

test("a line that drops leaves its calls to the mail: one still running when its answer comes, one answered and not taken at once", async (t) => {
  const { path, asked, lost, socket } = await opened(t);
  const seat = await line(path);
  seat.say({ type: "hello", key: "k1", role: "lead", cwd: "/work" });
  seat.say({ type: "call", id: "1", tool: "status", args: {} });
  seat.say({ type: "call", id: "2", tool: "land_lane", args: {} });
  assert.ok(await within(2000, () => asked.length === 2));
  asked[0]!.answer({ ok: true, text: "all well" });
  assert.ok(await within(2000, () => seat.heard.some((said) => said.id === "1")));
  seat.socket.destroy();
  assert.ok(await within(2000, () => lost.length === 1 && asked[1]!.cancelled.aborted));
  assert.equal(lost[0]![0].tool, "status");
  assert.equal(socket.calling("agent-1"), false);
});

test("new choices go to each line whose set changed, and to no other", async (t) => {
  const { path, socket, choices } = await opened(t);
  const seat = await line(path);
  seat.say({ type: "hello", key: "k1", role: "lead", cwd: "/work" });
  assert.ok(await within(2000, () => seat.heard.length === 1));
  socket.refresh();
  choices.value = { note: { kind: ["plans", "council"] } };
  socket.refresh();
  assert.ok(await within(2000, () => seat.heard.length === 2));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(seat.heard.slice(1), [{ type: "choices", choices: { note: { kind: ["plans", "council"] } } }]);
  seat.socket.destroy();
});

test("the socket is its user's alone, and one a stopped plugin left behind is taken over", async (t) => {
  const found = desk();
  writeFileSync(found.path, "left behind");
  found.socket.listen();
  t.after(() => found.socket.close());
  assert.ok(await within(2000, () => statSync(found.path).isSocket() && (statSync(found.path).mode & 0o777) === 0o600));
});

test("a line that fails is dropped, and the desk goes on", async () => {
  const { socket } = desk();
  const failing = Object.assign(new PassThrough(), { destroyed: false, destroy() {} }) as unknown as Socket;
  (socket as unknown as { serve(socket: Socket): void }).serve(failing);
  failing.emit("error", new Error("reset by the seat's end"));
  failing.emit("close");
  assert.equal(socket.calling("agent-1"), false);
});
