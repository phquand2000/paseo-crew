import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { reaches, toolNames } from "../../server/core/mcp-client.ts";
import { codeIndex } from "../../server/runtime/code-index.ts";
import { entry, fakeIde, fakeSemble, gone, ideConfig, proxy, repo, within } from "./code-fakes.ts";

test("a backend's own title and hints reach the harness, and an answer it streams after a progress note is read, the note passed on", async () => {
  const ide = await fakeIde({ openEnabled: true, streamed: true });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    const [tool] = (await code.client.listTools()).tools;
    assert.deepEqual({ title: tool!.title, annotations: tool!.annotations }, { title: "Find references", annotations: { readOnlyHint: true, openWorldHint: false } });
    const heard: string[] = [];
    const reply = await code.client.callTool({ name: "ide_find_references", arguments: {} }, { onprogress: (progress) => heard.push(progress.message ?? "") });
    assert.deepEqual(reply.content, [{ type: "text", text: `references in ${cwd}` }]);
    assert.deepEqual(heard, ["indexing"]);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a backend that keeps a session is spoken to within it, by the seat's proxy and by the desk", async () => {
  const ide = await fakeIde({ openEnabled: true, session: true });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    const reply = await code.call("ide_find_references", {});
    assert.equal(reply.isError, false, reply.content[0]!.text);
    const { label, proxy: spec } = entry("intellij-index");
    assert.equal((await codeIndex({ ...spec, id: "intellij-index", label, backend: { type: "http", url: ide.url } }).sync(cwd)).ok, true);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a backend that starts after the session is shown as it is once it answers, and the harness is told the list changed", async () => {
  const cwd = repo();
  const probe = await fakeIde({ openEnabled: true });
  probe.close();
  let changed = 0;
  const code = await proxy(cwd, ideConfig(`http://127.0.0.1:${probe.port}/mcp`, ["ide_find_references"]), () => changed++);
  const ide = await fakeIde({ openEnabled: true, port: probe.port });
  ide.open.add(cwd);
  try {
    assert.match((await code.client.listTools()).tools[0]!.description ?? "", /not reachable/);
    assert.equal((await code.call("ide_find_references", {})).isError, false);
    assert.ok(await within(2000, () => changed > 0));
    const [tool] = (await code.client.listTools()).tools;
    assert.equal(tool!.title, "Find references");
    assert.equal((tool!.inputSchema.properties as Record<string, unknown>).project_path, undefined, "the pinned argument is hidden here too");
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a call its harness stops is stopped at the backend too", async () => {
  const ide = await fakeIde({ openEnabled: true, slowMs: 3000 });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    const stopping = new AbortController();
    const calling = code.client.callTool({ name: "ide_find_references", arguments: {} }, { signal: stopping.signal });
    await new Promise((resolve) => setTimeout(resolve, 500));
    stopping.abort();
    await assert.rejects(calling);
    assert.ok(await within(3000, () => ide.notified.includes("notifications/cancelled")));
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a call made while another syncs what changed waits for that sync, rather than asking a stale index", async () => {
  const ide = await fakeIde({ openEnabled: true, syncMs: 300 });
  const cwd = repo();
  ide.open.add(cwd);
  const code = await proxy(cwd, ideConfig(ide.url, ["ide_find_references"]));
  try {
    await code.call("ide_find_references", {});
    writeFileSync(join(cwd, "new.ts"), "export const x = 1;\n");
    await Promise.all([code.call("ide_find_references", {}), code.call("ide_find_references", {})]);
    assert.deepEqual(ide.order.slice(1), ["ide_sync_files", "synced", "ide_find_references", "ide_find_references"]);
  } finally {
    await code.stop();
    ide.close();
  }
});

test("a harness that asked for progress hears that a call waiting on the index still runs, and one it stops stops polling", async () => {
  const ide = await fakeIde({ openEnabled: true, dumbCalls: 1000 });
  const cwd = repo();
  ide.open.add(cwd);
  const config = { ...ideConfig(ide.url, ["ide_find_references"]), wait: { ...ideConfig(ide.url, []).wait, seconds: 30, pollSeconds: 0.02 } };
  const code = await proxy(cwd, config, undefined, { SEATWORKS_PROGRESS_MS: "50" });
  try {
    const heard: string[] = [];
    const stopping = new AbortController();
    const calling = code.client.callTool({ name: "ide_find_references", arguments: {} }, { signal: stopping.signal, onprogress: (progress) => heard.push(progress.message ?? "") });
    assert.ok(await within(3000, () => heard.length > 0));
    assert.match(heard[0]!, /is still working on ide_find_references\./);
    stopping.abort();
    await assert.rejects(calling);
    const polls = () => ide.calls.filter((call) => call.name === "ide_index_status").length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = polls();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(polls(), after, "a stopped call no longer asks whether the index is ready");
  } finally {
    await code.stop();
    ide.close();
  }
});

test("the desk reads a backend's refusal as a failed call, and its health check sees what a server offers or that none answers", async () => {
  const ide = await fakeIde({ openEnabled: false });
  try {
    const { label, proxy: spec } = entry("intellij-index");
    const opened = await codeIndex({ ...spec, id: "intellij-index", label, backend: { type: "http", url: ide.url } }).open("/slots/S1");
    assert.deepEqual([opened.ok, opened.text], [false, "Tool ide_open_project not found"]);
    assert.deepEqual(await toolNames(ide.url, 3000), { names: ["ide_find_references"] });
    assert.deepEqual(await reaches(ide.url, 3000), { ok: true });
  } finally {
    ide.close();
  }
  const dead = "http://127.0.0.1:1/mcp";
  assert.ok((await toolNames(dead, 3000)).error);
  assert.equal((await reaches(dead, 3000)).ok, false);
});

test("a backend whose handshake is quick but whose list comes after the wait gave up is shown as it is once the list comes", async () => {
  const { label, instructions, proxy: spec } = entry("code-search");
  let changed = 0;
  const config = { name: "code-search", label, instructions, tools: ["search"], ...spec, listSeconds: 1, backend: { type: "stdio", command: [process.execPath, fakeSemble(1500)] } };
  const code = await proxy(repo(), config, () => changed++);
  try {
    assert.match((await code.client.listTools()).tools[0]!.description ?? "", /not reachable/);
    assert.ok(await within(5000, () => changed > 0), "told the list changed without a call having to find the server");
    assert.deepEqual((await code.client.listTools()).tools[0]!.inputSchema.required, ["query"]);
  } finally {
    await code.stop();
  }
});

test("a proxy stops as soon as its harness closes its input, and closes the backend it started", async () => {
  const ide = await fakeIde({ openEnabled: true });
  const cwd = repo();
  ide.open.add(cwd);
  const semble = fakeSemble();
  const { label, instructions, proxy: spec } = entry("code-search");
  const configs = [ideConfig(ide.url, ["ide_find_references"]), { name: "code-search", label, instructions, tools: ["search"], ...spec, backend: { type: "stdio", command: [process.execPath, semble] } }];
  try {
    for (const config of configs) {
      const code = await proxy(cwd, config);
      let took = Infinity;
      try {
        assert.ok(!(await code.call(config.tools[0]!, { query: "a" })).isError);
      } finally {
        const started = Date.now();
        await code.stop();
        took = Date.now() - started;
      }
      // A harness gives a server two seconds to go by itself before it signals it.
      assert.ok(took < 1500, `${config.name} stayed until its harness forced it`);
    }
    assert.ok(gone(Number(readFileSync(`${semble}.pid`, "utf-8"))), "its backend went with it");
  } finally {
    ide.close();
  }
});
