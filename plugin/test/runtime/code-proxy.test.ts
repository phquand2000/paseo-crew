import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { codeIndex } from "../../server/runtime/code-index.ts";
import { tempDir } from "../tempdir.ts";
import { entry, fakeIde, fakeSemble, gone, ideConfig, opening, proxy, repo, within, work } from "./code-fakes.ts";

test("the IDE server carries the navigation rule, lists only the role's tools and hides the project argument", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const code = await proxy(repo(), ideConfig(ide.url, ["ide_find_references"]));
  try {
    assert.equal(code.client.getServerVersion()?.name, "intellij-index");
    assert.equal(code.client.getInstructions(), entry("intellij-index").instructions, "the catalog's rule, as the catalog words it");
    const listed = await code.client.listTools();
    assert.deepEqual(listed.tools.map((tool: { name: string }) => tool.name), ["ide_find_references"]);
    assert.equal((listed.tools[0]!.inputSchema.properties as Record<string, unknown>).project_path, undefined);
    assert.equal(listed.tools[0]!.inputSchema.required, undefined);
    await assert.rejects(code.call("ide_refactor_rename", {}), "a tool the role was not given is the protocol's own error");
  } finally {
    await code.stop();
    ide.close();
  }
});

test("an IDE call is pinned to the working copy, a preset that opens it does so on first use, and a switched-off tool is reported", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = await proxy(cwd, opening(ideConfig(ide.url, ["ide_find_references", "ide_find_symbol", "ide_diagnostics"])));
  try {
    const reply = await code.call("ide_find_references", { file: "a.ts", project_path: "/somewhere/else" });
    assert.equal(reply.isError, false);
    assert.equal(reply.content[0]!.text, `references in ${cwd}`);
    assert.deepEqual(work(ide.calls), ["ide_find_references", "ide_open_project", "ide_find_references"]);
    assert.equal(ide.calls.find((call) => call.name === "ide_open_project")!.args.path, cwd);
    assert.match(readFileSync(join(cwd, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
    // Each backend error is answered with the reply the catalog gives for it.
    const catalogReply = (backendSaid: string, tool: string) => (entry("intellij-index").proxy.errors as { when: string; reply: string }[]).find((error) => new RegExp(error.when, "i").test(backendSaid))!.reply.replaceAll("{tool}", tool);
    const off = await code.call("ide_find_symbol", { query: "x" });
    assert.deepEqual([off.isError, off.content[0]!.text], [true, catalogReply("Tool ide_find_symbol not found", "ide_find_symbol")]);
    const broken = await code.call("ide_diagnostics", { file: "a.ts" });
    assert.equal(broken.content[0]!.text, catalogReply("CannotStartProcessException", "ide_diagnostics"));
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a call made while the IDE indexes waits for the index and is retried", async () => {
  const ide = await fakeIde({ openEnabled: true, dumbCalls: 1 });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    const reply = await code.call("ide_find_references", {});
    assert.equal(reply.isError, false, reply.content[0]!.text);
    assert.ok(ide.calls.some((call) => call.name === "ide_index_status"));
  } finally {
    await code.stop();
    ide.close();
  }
});

test("files changed outside the IDE are synced before the next call, and nothing is synced when nothing changed", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  const syncs = () => ide.calls.filter((call) => call.name === "ide_sync_files");
  try {
    await code.call("ide_find_references", {});
    assert.equal(syncs().length, 0);
    writeFileSync(join(cwd, "new.ts"), "export const x = 1;\n");
    await code.call("ide_find_references", {});
    assert.deepEqual(syncs().map((call) => call.args.paths), [["new.ts"]]);
    await code.call("ide_find_references", {});
    assert.equal(syncs().length, 1);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("the shipped IntelliJ entry opens the seat's own working copy when the IDE does not have it", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    await code.call("ide_find_references", {});
    const opens = ide.calls.filter((call) => call.name === "ide_open_project");
    assert.equal(opens.length, 1, "the copy is opened once, on the call that found it missing");
    assert.equal(opens[0]!.args.path, cwd);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("when the IDE can't open the working copy the agent is told the open tool is switched off", async () => {
  const ide = await fakeIde({ openEnabled: false });
  const code = await proxy(repo(), opening(ideConfig(ide.url, ["ide_find_references"])));
  try {
    const reply = await code.call("ide_find_references", {});
    assert.equal(reply.isError, true);
    assert.match(reply.content[0]!.text, /ide_open_project switched off/);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("an unreachable IDE fails the call with a way forward", async () => {
  const code = await proxy(repo(), ideConfig("http://127.0.0.1:9/mcp", ["ide_find_references"]));
  try {
    const listed = await code.client.listTools();
    assert.equal(listed.tools.length, 1);
    const reply = await code.call("ide_find_references", {});
    assert.equal(reply.isError, true);
    assert.match(reply.content[0]!.text, /not reachable/);
  } finally {
    await code.stop();
  }
});

test("code search lists the backend's tool with the catalog's description, hides the pinned argument and runs against the working copy", async () => {
  const cwd = repo();
  const { label, instructions, proxy: spec } = entry("code-search");
  const code = await proxy(cwd, { name: "code-search", label, instructions, tools: ["search"], ...spec, backend: { type: "stdio", command: [process.execPath, fakeSemble()] } });
  try {
    const listed = await code.client.listTools();
    assert.deepEqual(listed.tools.map((tool: { name: string }) => tool.name), ["search"]);
    assert.equal(listed.tools[0]!.description, spec.descriptions.search);
    assert.deepEqual(listed.tools[0]!.inputSchema.required, ["query"]);
    assert.equal((listed.tools[0]!.inputSchema.properties as Record<string, unknown>).repo, undefined);
    const reply = await code.call("search", { query: "retry a failed payment", repo: "/elsewhere" });
    assert.deepEqual(JSON.parse(reply.content[0]!.text), { query: "retry a failed payment", repo: cwd });
  } finally {
    await code.stop();
  }
});

test("opening a working copy while other projects are open is routed through one of them", async () => {
  const ide = await fakeIde({ openEnabled: true, routeRequired: true });
  const cwd = repo();
  const code = await proxy(cwd, opening(ideConfig(ide.url, ["ide_find_references"])));
  try {
    const reply = await code.call("ide_find_references", {});
    assert.equal(reply.isError, false, reply.content[0]!.text);
    const opens = ide.calls.filter((call) => call.name === "ide_open_project");
    assert.deepEqual(opens.map((call) => call.args.project_path), [undefined, "/already/open"]);
    assert.equal(opens[1]!.args.path, cwd);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("the desk opens a copy it takes with the shipped entry, routed through an open project, and closes that copy alone", async () => {
  const ide = await fakeIde({ openEnabled: true, routeRequired: true });
  try {
    const { label, proxy: spec } = entry("intellij-index");
    const index = codeIndex({ ...spec, id: "intellij-index", label, backend: { type: "http", url: ide.url } });
    const opened = await index.open("/slots/S1");
    assert.equal(opened.ok, true, opened.text);
    assert.deepEqual(ide.calls.map((call) => [call.args.path, call.args.project_path]), [["/slots/S1", undefined], ["/slots/S1", "/already/open"]]);
    assert.ok(ide.open.has("/slots/S1"));

    const closed = await index.close("/slots/S1");
    assert.equal(closed.ok, true, closed.text);
    assert.deepEqual(ide.calls.at(-1), { name: "ide_close_project", args: { project_path: "/slots/S1" } }, "the close names the copy, never whichever project the IDE has in front");
    assert.equal(ide.open.has("/slots/S1"), false);
  } finally {
    ide.close();
  }
});

test("a server that is slow to start does not hold the tool list for the whole call budget, and is not left running", async () => {
  // Never answers, like a cold start still fetching its package; the list once waited out init's budget, then its own.
  const pidFile = join(tempDir("sw2-slow-"), "pid");
  const code = await proxy(repo(), {
    name: "code-search",
    label: "Code search",
    tools: ["search"],
    descriptions: { search: "Search the code." },
    listSeconds: 0.3,
    backend: { type: "stdio", command: [process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", pidFile] },
  });
  try {
    const started = Date.now();
    const listed = await code.client.listTools();
    assert.ok(Date.now() - started < 10_000, "the list waited on the whole call budget");
    assert.deepEqual(listed.tools.map((tool: { name: string }) => tool.name), ["search"]);
    const only = listed.tools[0] as unknown as { description: string; inputSchema: { additionalProperties?: boolean } };
    assert.match(only.description, /Search the code\./, "the preset's own description is kept");
    assert.match(only.description, /not reachable/, "and the seat is told the server is not there, which a configured description used to hide");
    assert.equal(only.inputSchema.additionalProperties, true, "with a schema that does not refuse the arguments it would be called with");
  } finally {
    // As a harness that signals its servers rather than closing their input: the proxy may not go before its backend.
    process.kill(code.pid, "SIGTERM");
  }
  const backend = Number(readFileSync(pidFile, "utf-8"));
  try {
    assert.ok(await within(5000, () => gone(backend)), "a backend that ignores its input closing is stopped with its proxy, not left running for good");
  } finally {
    if (!gone(backend)) process.kill(backend);
    await code.stop();
  }
});
