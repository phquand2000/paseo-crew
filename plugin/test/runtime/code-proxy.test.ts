import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { entry, fakeIde, fakeSemble, ideConfig, proxy, repo, searchConfig, within, work } from "./code-fakes.ts";

type Listed = { name: string; title?: string; description?: string; annotations?: object; inputSchema: Schema };
type Schema = { properties?: Record<string, unknown>; required?: string[] };

/** The reply the catalog gives when the backend says `said`, for `tool`. */
const catalogReply = (said: string, tool: string) =>
  (entry("intellij-index").proxy.errors as { when: string; reply: string }[])
    .find((error) => new RegExp(error.when, "i").test(said))!
    .reply.replaceAll("{tool}", tool);

test("a seat's IDE call: listed as its role's, pinned to its copy, opened on first use, synced before each call", async (t) => {
  const ide = await fakeIde(t, { tools: ["ide_find_references", "ide_refactor_rename"] });
  const cwd = repo();
  const code = await proxy(t, cwd, ideConfig(ide.url, ["ide_find_references", "ide_find_symbol", "ide_diagnostics"]));
  assert.equal(code.client.getServerVersion()?.name, "intellij-index");
  assert.equal(
    code.client.getInstructions(),
    entry("intellij-index").instructions,
    "the catalog's rule, as it words it",
  );
  const listed = (await code.tools()) as Listed[];
  assert.deepEqual(
    listed.map((tool) => tool.name),
    ["ide_find_references", "ide_find_symbol", "ide_diagnostics"],
    "only the role's tools, whatever else the IDE offers",
  );
  assert.equal(listed[0]!.inputSchema.properties!.project_path, undefined, "the pinned argument is hidden");
  assert.equal(listed[0]!.inputSchema.required, undefined);
  await assert.rejects(code.call("ide_refactor_rename"), "a tool the role was not given is the protocol's own error");

  const reply = await code.call("ide_find_references", { file: "a.ts", project_path: "/somewhere/else" });
  assert.deepEqual(
    [reply.isError, reply.content[0]!.text],
    [false, `references in ${cwd}`],
    "pinned to the working copy",
  );
  assert.deepEqual(work(ide.calls), ["ide_find_references", "ide_open_project", "ide_find_references"]);
  assert.equal(ide.calls.find((call) => call.name === "ide_open_project")!.args.path, cwd, "opened once, at its copy");
  assert.match(readFileSync(join(cwd, ".git", "info", "exclude"), "utf-8"), /^\.idea\/$/m);
  const off = await code.call("ide_find_symbol", { query: "x" });
  assert.deepEqual(
    [off.isError, off.content[0]!.text],
    [true, catalogReply("Tool ide_find_symbol not found", "ide_find_symbol")],
  );
  const broken = await code.call("ide_diagnostics", { file: "a.ts" });
  assert.equal(broken.content[0]!.text, catalogReply("CannotStartProcessException", "ide_diagnostics"));

  const syncs = () => ide.calls.filter((call) => call.name === "ide_sync_files").map((call) => call.args.paths);
  await code.call("ide_find_references");
  assert.deepEqual(syncs(), [], "nothing is synced when nothing changed");
  writeFileSync(join(cwd, "new.ts"), "export const x = 1;\n");
  await code.call("ide_find_references");
  await code.call("ide_find_references");
  assert.deepEqual(syncs(), [["new.ts"]], "files changed outside the IDE are synced before the next call, once");

  const slow = await fakeIde(t, { syncMs: 300 });
  const later = repo();
  slow.open.add(later);
  const waiting = await proxy(t, later, ideConfig(slow.url, ["ide_find_references"]));
  await waiting.call("ide_find_references");
  writeFileSync(join(later, "new.ts"), "export const x = 1;\n");
  await Promise.all([waiting.call("ide_find_references"), waiting.call("ide_find_references")]);
  assert.deepEqual(
    slow.order.slice(1),
    ["ide_sync_files", "synced", "ide_find_references", "ide_find_references"],
    "a call made while another syncs waits for that sync, rather than asking a stale index",
  );

  const streamed = await fakeIde(t, { streamed: true });
  const flowing = repo();
  streamed.open.add(flowing);
  const stream = await proxy(t, flowing, ideConfig(streamed.url, ["ide_find_references"]));
  const [tool] = (await stream.tools()) as Listed[];
  assert.deepEqual(
    { title: tool!.title, annotations: tool!.annotations },
    { title: "Find references", annotations: { readOnlyHint: true, openWorldHint: false } },
    "a backend's own title and hints reach the harness",
  );
  const heard: string[] = [];
  const answered = await stream.client.callTool(
    { name: "ide_find_references", arguments: {} },
    { onprogress: (note) => heard.push(note.message ?? "") },
  );
  assert.deepEqual(
    answered.content,
    [{ type: "text", text: `references in ${flowing}` }],
    "an answer streamed after a note",
  );
  assert.deepEqual(heard, ["indexing"], "and the note passed on");

  const kept = await fakeIde(t, { session: true });
  const sessioned = repo();
  kept.open.add(sessioned);
  const session = await proxy(t, sessioned, ideConfig(kept.url, ["ide_find_references"]));
  assert.equal(
    (await session.call("ide_find_references")).isError,
    false,
    "a backend that keeps a session is spoken to in it",
  );
});

test("an IDE that is indexing, cannot open the copy, has other projects open, is not there, or starts late", async (t) => {
  const indexing = await fakeIde(t, { dumbCalls: 1 });
  const dumb = repo();
  indexing.open.add(dumb);
  const waited = await proxy(t, dumb, ideConfig(indexing.url, ["ide_find_references"]));
  const reply = await waited.call("ide_find_references");
  assert.equal(reply.isError, false, reply.content[0]!.text);
  assert.ok(
    indexing.calls.some((call) => call.name === "ide_index_status"),
    "a call waits for the index and is retried",
  );

  const closed = await fakeIde(t, { openEnabled: false });
  const refused = await (
    await proxy(t, repo(), ideConfig(closed.url, ["ide_find_references"]))
  ).call("ide_find_references");
  assert.equal(refused.isError, true);
  assert.match(
    refused.content[0]!.text,
    /ide_open_project switched off/,
    "the IDE cannot open the copy: its tool is off",
  );

  const busy = await fakeIde(t, { routeRequired: true });
  const cwd = repo();
  const routed = await (await proxy(t, cwd, ideConfig(busy.url, ["ide_find_references"]))).call("ide_find_references");
  assert.equal(routed.isError, false, routed.content[0]!.text);
  const opens = busy.calls.filter((call) => call.name === "ide_open_project");
  assert.deepEqual(
    opens.map((call) => call.args.project_path),
    [undefined, "/already/open"],
    "routed through one open",
  );
  assert.equal(opens[1]!.args.path, cwd);

  const away = await proxy(t, repo(), ideConfig("http://127.0.0.1:9/mcp", ["ide_find_references"]));
  assert.equal((await away.tools()).length, 1, "an unreachable IDE still lists the role's tools");
  assert.match((await away.call("ide_find_references")).content[0]!.text, /not reachable/, "and a call says so");

  const probe = await fakeIde(t);
  probe.close();
  let changed = 0;
  const late = repo();
  const early = await proxy(
    t,
    late,
    ideConfig(`http://127.0.0.1:${probe.port}/mcp`, ["ide_find_references"]),
    () => changed++,
  );
  const started = await fakeIde(t, { port: probe.port });
  started.open.add(late);
  assert.match((await early.tools())[0]!.description ?? "", /not reachable/);
  assert.equal((await early.call("ide_find_references")).isError, false);
  assert.ok(await within(2000, () => changed > 0), "a backend that starts after the session is shown once it answers");
  const [shown] = (await early.tools()) as Listed[];
  assert.equal(shown!.title, "Find references");
  assert.equal(shown!.inputSchema.properties!.project_path, undefined, "the pinned argument hidden here too");
});

test("code search over stdio is shown as the catalog words it, pinned to its copy, and once its list comes", async (t) => {
  const cwd = repo();
  const search = await proxy(t, cwd, searchConfig([process.execPath, fakeSemble()]));
  const listed = (await search.tools()) as Listed[];
  assert.deepEqual(
    listed.map((tool) => tool.name),
    ["search"],
  );
  assert.equal(listed[0]!.description, entry("code-search").proxy.descriptions.search);
  assert.deepEqual(listed[0]!.inputSchema.required, ["query"]);
  assert.equal(listed[0]!.inputSchema.properties!.repo, undefined);
  const reply = await search.call("search", { query: "retry a failed payment", repo: "/elsewhere" });
  assert.deepEqual(
    JSON.parse(reply.content[0]!.text),
    { query: "retry a failed payment", repo: cwd },
    "run against its copy",
  );

  let changed = 0;
  const config = searchConfig([process.execPath, fakeSemble(1000)], { listSeconds: 0.5 });
  const late = await proxy(t, repo(), config, () => changed++);
  assert.match((await late.tools())[0]!.description ?? "", /not reachable/, "a list that comes after the wait gave up");
  assert.ok(await within(5000, () => changed > 0), "is shown once it comes, without a call having to find the server");
  assert.deepEqual(((await late.tools()) as Listed[])[0]!.inputSchema.required, ["query"]);
});
