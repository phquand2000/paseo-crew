import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Socket, createServer } from "node:net";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { tempDir } from "../tempdir.ts";

const teamServer = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp", "team.mjs");
const data = (file: string, set: string) => JSON.parse(readFileSync(join(dirname(teamServer), file), "utf-8"))[set];

type Said = { type: string; id?: string; [key: string]: unknown };

/** A desk on a socket of its own: it hears each line, and `respond` answers what it hears. */
async function fakeDesk(respond: (line: Socket, said: Said) => void) {
  const path = join(tempDir("sw2-desk-"), "d.sock");
  const heard: Said[] = [];
  const server = createServer((socket) => {
    socket.on("error", () => {});
    createInterface({ input: socket })
      .on("line", (text) => {
        const said = JSON.parse(text) as Said;
        heard.push(said);
        respond(socket, said);
      })
      .on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const send = (line: Socket, message: object) => line.write(`${JSON.stringify(message)}\n`);
  return { path, heard, send, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** A harness with the team server of `set` for the seat holding key k1, reaching the desk at `path`. */
async function harness(path: string, set = "lead", env: Record<string, string> = {}, changed?: () => void) {
  const client = new Client({ name: "probe", version: "0" }, changed ? { listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: changed } } } : {});
  const transport = new StdioClientTransport({ command: process.execPath, args: [teamServer, set, set, path], env: { PATH: process.env.PATH ?? "", SEATWORKS_DESK_KEY: "k1", ...env }, stderr: "inherit" });
  await client.connect(transport);
  return client;
}

const welcoming = (choices: object) => (line: Socket, said: Said) => {
  if (said.type === "hello") line.write(`${JSON.stringify({ type: "welcome", choices })}\n`);
};

const within = async (ms: number, check: () => boolean) => {
  for (const end = Date.now() + ms; !check(); await new Promise((resolve) => setTimeout(resolve, 20))) if (Date.now() > end) return false;
  return true;
};

test("a seat's harness is told what the server is for, each tool's title and what it changes, and the desk's choices as enums", async () => {
  const choices = { add_tasks: { role: ["peer"], skills: ["test-first", "diagnosing-bugs"] }, note: { kind: ["plans", "council"] } };
  const desk = await fakeDesk(welcoming(choices));
  const client = await harness(desk.path);
  try {
    // The server answers its harness without waiting long for the desk, so its hello may arrive after the handshake.
    assert.ok(await within(5000, () => desk.heard.length > 0), "it says hello");
    assert.deepEqual(desk.heard[0], { type: "hello", key: "k1", role: "lead", cwd: process.cwd() });
    assert.equal(client.getInstructions(), data("instructions.json", "lead"));
    // The desk's choices come with the first list, or as a changed list soon after when the desk is slow to say them.
    let tools: Awaited<ReturnType<typeof client.listTools>>["tools"] = [];
    const offered = () => ((tools.find((tool) => tool.name === "note")?.inputSchema as any)?.properties.kind.enum ?? []).length > 0;
    for (const end = Date.now() + 5000; !offered() && Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 50))) tools = (await client.listTools()).tools;
    const shown = (list: { name: string; title?: string; annotations?: object }[]) => list.map(({ name, title, annotations }) => ({ name, title, annotations }));
    assert.deepEqual(shown(tools), shown(data("tools.json", "lead")));
    const schema = (name: string) => tools.find((tool) => tool.name === name)!.inputSchema as any;
    const task = schema("add_tasks").properties.tasks.items.properties;
    assert.deepEqual(task.role.enum, ["peer"]);
    assert.deepEqual(task.skills.items.enum, ["test-first", "diagnosing-bugs"], "a list takes the set for its items");
    assert.deepEqual(schema("note").properties.kind.enum, ["plans", "council"]);
    assert.equal(schema("start_review").properties.role.enum, undefined, "a field the desk named nothing for is left open");
  } finally {
    await client.close();
    await desk.close();
  }
});

test("a call reaches the desk from the seat holding the key, and its answer is the tool's text, a refusal marked an error", async () => {
  const desk = await fakeDesk((line, said) => {
    welcoming({})(line, said);
    if (said.type === "call") line.write(`${JSON.stringify({ type: "result", id: said.id, ok: said.tool === "status", text: `answered ${said.tool}` })}\n`);
  });
  const client = await harness(desk.path);
  try {
    const status = await client.callTool({ name: "status", arguments: {} });
    assert.deepEqual(status.content, [{ type: "text", text: "answered status" }]);
    assert.equal(status.isError, false);
    const call = desk.heard.find((said) => said.type === "call")!;
    assert.deepEqual({ tool: call.tool, args: call.args }, { tool: "status", args: {} });
    assert.ok(await within(2000, () => desk.heard.some((said) => said.type === "taken" && said.id === call.id)), "the harness took the answer, and the desk is told so");
    const refused = await client.callTool({ name: "accept", arguments: { task: "L1-T1" } });
    assert.equal(refused.isError, true);
    await assert.rejects(client.callTool({ name: "no_such_tool", arguments: {} }), "a tool the set does not have is the protocol's own error");
  } finally {
    await client.close();
    await desk.close();
  }
});

test("a key the desk refuses carries nothing out, and each call says why", async () => {
  const desk = await fakeDesk((line, said) => {
    if (said.type === "hello") line.write(`${JSON.stringify({ type: "refused", why: "The desk does not know this agent's key." })}\n`);
  });
  const client = await harness(desk.path);
  try {
    const called = await client.callTool({ name: "status", arguments: {} });
    assert.deepEqual([called.isError, called.content], [true, [{ type: "text", text: "The desk does not know this agent's key." }]]);
    assert.equal(desk.heard.filter((said) => said.type === "call").length, 0);
  } finally {
    await client.close();
    await desk.close();
  }
});

test("with no desk running a call is not carried out, and says what to do", async () => {
  const client = await harness(join(tempDir("sw2-desk-"), "none.sock"));
  try {
    const called = await client.callTool({ name: "status", arguments: {} });
    assert.equal(called.isError, true);
    assert.match((called.content as { text: string }[])[0]!.text, /^The team desk is not running, so status was not carried out\. Do not call it again/);
  } finally {
    await client.close();
  }
});

test("a call its harness stops tells the desk, which answers it by mail", async () => {
  const desk = await fakeDesk(welcoming({}));
  const client = await harness(desk.path);
  try {
    const stopping = new AbortController();
    const calling = client.callTool({ name: "status", arguments: {} }, { signal: stopping.signal });
    assert.ok(await within(2000, () => desk.heard.some((said) => said.type === "call")));
    stopping.abort();
    await assert.rejects(calling);
    const call = desk.heard.find((said) => said.type === "call")!;
    assert.ok(await within(2000, () => desk.heard.some((said) => said.type === "cancel" && said.id === call.id)));
  } finally {
    await client.close();
    await desk.close();
  }
});

test("a harness that asked for progress hears that a long call still runs", async () => {
  const desk = await fakeDesk((line, said) => {
    welcoming({})(line, said);
    if (said.type === "call") setTimeout(() => line.write(`${JSON.stringify({ type: "result", id: said.id, ok: true, text: "done" })}\n`), 300);
  });
  const client = await harness(desk.path, "lead", { SEATWORKS_PROGRESS_MS: "50" });
  try {
    const heard: string[] = [];
    const called = await client.callTool({ name: "status", arguments: {} }, { onprogress: (progress) => heard.push(progress.message ?? "") });
    assert.deepEqual(called.content, [{ type: "text", text: "done" }]);
    assert.ok(heard.length > 0 && heard.every((message) => message === "The desk is still working on status."), `${heard.length} progress notes`);
  } finally {
    await client.close();
    await desk.close();
  }
});

test("new choices from the desk reach the harness as a changed list of tools", async () => {
  let line: Socket | undefined;
  const desk = await fakeDesk((socket, said) => {
    line = socket;
    welcoming({ note: { kind: ["plans"] } })(socket, said);
  });
  let changed = 0;
  const client = await harness(desk.path, "lead", {}, () => changed++);
  try {
    const kind = async () => ((await client.listTools()).tools.find((tool) => tool.name === "note")!.inputSchema as any).properties.kind.enum;
    assert.deepEqual(await kind(), ["plans"]);
    desk.send(line!, { type: "choices", choices: { note: { kind: ["plans", "council"] } } });
    assert.ok(await within(2000, () => changed > 0), "told the list changed");
    assert.deepEqual(await kind(), ["plans", "council"]);
  } finally {
    await client.close();
    await desk.close();
  }
});

test("a desk that drops the line mid-call leaves that call with what happened, and the next call finds the desk again", async () => {
  let calls = 0;
  const desk = await fakeDesk((line, said) => {
    welcoming({})(line, said);
    if (said.type !== "call") return;
    if (++calls === 1) line.destroy();
    else line.write(`${JSON.stringify({ type: "result", id: said.id, ok: true, text: "answered" })}\n`);
  });
  const client = await harness(desk.path);
  try {
    const lost = await client.callTool({ name: "accept", arguments: { task: "L1-T1" } });
    assert.equal(lost.isError, true);
    assert.match((lost.content as { text: string }[])[0]!.text, /^The team desk stopped while accept ran, and its answer is lost here\. If accept changes something, look before calling it again/);
    const again = await client.callTool({ name: "status", arguments: {} });
    assert.deepEqual(again.content, [{ type: "text", text: "answered" }]);
    assert.equal(desk.heard.filter((said) => said.type === "hello").length, 2, "said who it is again on the new line");
  } finally {
    await client.close();
    await desk.close();
  }
});

test("a server whose harness closes its pipe exits, though its line to the desk is still open", async () => {
  const desk = await fakeDesk(welcoming({}));
  const server = spawn(process.execPath, [teamServer, "peer", "peer", desk.path], { env: { PATH: process.env.PATH ?? "", SEATWORKS_DESK_KEY: "k1" }, stdio: ["pipe", "ignore", "inherit"] });
  try {
    assert.ok(await within(5000, () => desk.heard.some((said) => said.type === "hello")), "its line to the desk is open");
    const exited = new Promise<boolean>((resolve) => server.on("exit", () => resolve(true)));
    server.stdin.end();
    assert.ok(await Promise.race([exited, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]), "left running, it would hold its line for good");
  } finally {
    server.kill();
    await desk.close();
  }
});
