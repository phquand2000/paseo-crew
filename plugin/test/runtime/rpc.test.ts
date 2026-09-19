import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const HOME = mkdtempSync(join(tmpdir(), "sw2-rpc-home-"));
process.env.HOME = HOME;

const { Runtime } = await import("../../server/runtime/runtime.ts");
const { registerRpc } = await import("../../server/runtime/rpc.ts");
const { makeKit } = await import("../../server/catalog/testkit.ts");

/** One open seat, which is all a panel call needs to be able to see the difference from none. */
function onePaseo(id: string) {
  return {
    agents: {
      async list() {
        return { entries: [{ agent: { id, provider: "seatworks-v2:lead:claude", status: "running", pendingPermissions: [] } }], pageInfo: { hasMore: false, nextCursor: null, prevCursor: null } };
      },
    },
  };
}

function served(paseo?: unknown) {
  const kit = makeKit();
  const runtime = new Runtime(kit, { outboxFile: join(HOME, "outbox.json"), reloadDaemon: async () => true });
  const handlers = new Map<string, (input: any) => any>();
  const bound: unknown[] = [];
  // The host hands every handler the live daemon handle beside the input, and the desk is registered
  // with the one callback that keeps it.
  const names = registerRpc(
    {
      handle: (contract: { name: string; input: { parse(value: unknown): unknown } }, handler: (input: unknown, context: { paseo: unknown }) => unknown) =>
        handlers.set(contract.name, (input) => handler(contract.input.parse(input), { paseo })),
    },
    runtime.control,
    (api) => bound.push(api),
  );
  const call = async (name: string, input: unknown = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `no handler for ${name}`);
    return JSON.parse(JSON.stringify(await handler(input)));
  };
  return { kit, runtime, names, call, bound };
}

test("the plugin serves the catalog, settings, projects, team and status over RPC", async () => {
  const { names, call } = served();
  assert.deepEqual(names.sort(), [
    "seatworks.catalog.read",
    "seatworks.doctor.run",
    "seatworks.flow.read",
    "seatworks.mcp.parse",
    "seatworks.paths.list",
    "seatworks.projects.add",
    "seatworks.projects.candidates",
    "seatworks.projects.list",
    "seatworks.projects.remove",
    "seatworks.settings.read",
    "seatworks.settings.reset",
    "seatworks.settings.write",
    "seatworks.status.read",
    "seatworks.team.read",
  ]);
  const catalog = await call("seatworks.catalog.read");
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "lead").harnesses, ["claude", "devin"]);
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "scribe").harnesses, ["devin"]);
  assert.deepEqual(catalog.mcp.map((entry: any) => [entry.id, entry.transport]), [["ide", "stdio"], ["docs", "http"]]);
});

test("the daemon handle a panel call arrives with is kept, not thrown away", async () => {
  const paseo = onePaseo("a-lead");
  const { call, bound } = served(paseo);
  assert.deepEqual(bound, [], "nothing has called in yet");

  // Bound only from the agent lifecycle hooks, the desk had none between a daemon reload and the next
  // seat being created: the patrol skipped every tick, and the roster read back empty — which both
  // screens render as every Lead and Peer gone, because an id absent from the roster is a seat that
  // has left. A settings save reloads the daemon itself, so the owner's own click put the desk there,
  // and opening a panel to look was the one thing that could not get it out.
  await call("seatworks.catalog.read");
  assert.deepEqual(bound, [paseo], "the one handle the runtime was missing came in with the call");
});

test("a web app turns a server on for the machine and switches a role's harness for one project", async () => {
  const { call } = served();
  const read = await call("seatworks.settings.read");
  assert.equal(read.status, "ready");
  const saved = await call("seatworks.settings.write", { revision: read.revision, values: { mcp: { docs: { enabled: true } } } });
  assert.equal(saved.status, "saved");
  let team = await call("seatworks.team.read");
  assert.deepEqual(team.roles.lead.mcp, ["ide", "docs"]);
  assert.match(team.roles.lead.rules, /Look library APIs up in the docs\./);
  assert.equal(team.roles.lead.provider, "sw2-lead-claude");

  const state = join(HOME, ".local/share/seatworks-v2/projects/shop-abc123");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "meta.json"), JSON.stringify({ root: "/work/shop", slug: "shop-abc123" }));
  assert.deepEqual(await call("seatworks.projects.list"), [{ slug: "shop-abc123", root: "/work/shop" }]);
  const projectRead = await call("seatworks.settings.read", { project: "shop-abc123" });
  assert.deepEqual(projectRead.machine, { mcp: { docs: { enabled: true } } });
  const projectSaved = await call("seatworks.settings.write", { project: "shop-abc123", revision: projectRead.revision, values: { roles: { lead: { harness: "devin" } }, mcp: { ide: { enabled: false } } } });
  assert.equal(projectSaved.status, "saved");
  team = await call("seatworks.team.read", { project: "shop-abc123" });
  assert.equal(team.roles.lead.harness, "devin");
  assert.equal(team.roles.lead.provider, "sw2-lead-devin");
  assert.deepEqual(team.roles.lead.mcp, ["docs"]);
  assert.match(team.roles.lead.rules, /List a server's tools once/);
  assert.equal((await call("seatworks.team.read")).roles.lead.harness, "claude");
  const status = await call("seatworks.status.read", { project: "shop-abc123" });
  assert.match(status.text, /No open lanes\./);
});

test("settings a team can't run on are refused with the reason, and stale writes conflict", async () => {
  const { call } = served();
  const read = await call("seatworks.settings.read");
  const refused = await call("seatworks.settings.write", { revision: read.revision, values: { roles: { supervisor: { harness: "devin" } } } });
  assert.equal(refused.status, "invalid");
  assert.match(refused.error, /Devin CLI has no supervisor settings/);
  assert.equal((await call("seatworks.settings.write", { revision: read.revision, values: { rules: "one" } })).status, "saved");
  assert.equal((await call("seatworks.settings.write", { revision: read.revision, values: { rules: "two" } })).status, "conflict");
  const unknown = await call("seatworks.settings.read", { project: "nowhere" });
  assert.equal(unknown.status, "invalid");
});

test("a project can be registered by its path before any agent has run in it", async () => {
  const { call } = served();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-project-")));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "src"), { recursive: true });
  const added = await call("seatworks.projects.add", { root: join(root, "src") });
  assert.equal(added.root, root, "a path inside the project registers the project root");
  assert.ok(added.slug.length > 0);
  const listed = await call("seatworks.projects.list");
  assert.ok(listed.some((entry: { slug: string; root: string }) => entry.slug === added.slug && entry.root === root), JSON.stringify(listed));

  const read = await call("seatworks.settings.read", { project: added.slug });
  assert.equal(read.status, "ready");
  const saved = await call("seatworks.settings.write", { project: added.slug, revision: read.revision, values: { roles: { peer: { harness: "devin" } } } });
  assert.equal(saved.status, "saved");
  assert.equal((await call("seatworks.team.read", { project: added.slug })).roles.peer.harness, "devin");

  const missing = await call("seatworks.projects.add", { root: join(root, "nowhere") });
  assert.match(missing.error, /is not a directory/);
});

test("attaching a project is undone by detaching it, unless work is still running in it", async () => {
  const { call } = served();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-attach-")));
  execFileSync("git", ["init", "-q", root]);
  const added = await call("seatworks.projects.add", { root });
  const read = await call("seatworks.settings.read", { project: added.slug });
  await call("seatworks.settings.write", { project: added.slug, revision: read.revision, values: { roles: { peer: { harness: "devin" } } } });

  const state = join(HOME, ".local/share/seatworks-v2/projects", added.slug);
  writeFileSync(join(state, "ledger.json"), JSON.stringify({ version: 1, lanes: { L1: { id: "L1", status: "open" } }, tasks: {} }));
  const refused = await call("seatworks.projects.remove", { project: added.slug });
  assert.match(refused.error, /open lane\(s\)/);

  // A lane that is closed and the tasks it cut are the project's provenance, and nothing ever deletes
  // them. Counted as work, they made Detach refuse for ever, and told the owner to close lanes that
  // were already closed. The records stay on disk; the attachment is what Detach undoes.
  writeFileSync(
    join(state, "ledger.json"),
    JSON.stringify({ version: 1, lanes: { L1: { id: "L1", status: "closed" } }, tasks: { "L1-T1": { id: "L1-T1", lane: "L1", status: "cut" } } }),
  );
  assert.deepEqual(await call("seatworks.projects.remove", { project: added.slug }), { removed: added.slug });
  const listed = await call("seatworks.projects.list");
  assert.equal(listed.some((entry: { slug: string }) => entry.slug === added.slug), false);
  assert.match((await call("seatworks.projects.remove", { project: added.slug })).error, /has been seen/);
});

test("the projects a setup screen may offer leave out worktrees, gone directories and the ones already set up", async () => {
  const { call } = served();
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-live-")));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
  const linked = join(realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-linked-"))), "wt");
  execFileSync("git", ["worktree", "add", "-q", "-b", "side", linked], { cwd: repo });
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-plain-")));
  const ours = join(HOME, ".local/share/seatworks-v2/worktrees/shop-ef484b/S0");
  mkdirSync(ours, { recursive: true });
  const taken = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-taken-")));
  execFileSync("git", ["init", "-q", taken]);
  await call("seatworks.projects.add", { root: taken });

  const roots = [repo, linked, plain, ours, join(repo, "nowhere"), taken];
  assert.deepEqual(await call("seatworks.projects.candidates", { roots }), [repo]);
});

test("a pasted server is understood whatever dialect it is written in", async () => {
  const { call } = served();
  const nested = await call("seatworks.mcp.parse", {
    text: JSON.stringify({ mcp: { context7: { type: "local", command: ["npx", "-y", "@upstash/context7-mcp", "--api-key", "KEY"], enabled: true } } }),
  });
  assert.equal(nested.id, "context7");
  assert.deepEqual(nested.connect, { type: "stdio", command: ["npx", "-y", "@upstash/context7-mcp", "--api-key", "KEY"] });

  const claudeStyle = await call("seatworks.mcp.parse", {
    text: JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["docs-mcp"], env: { TOKEN: "x" } } } }),
  });
  assert.equal(claudeStyle.id, "docs");
  assert.deepEqual(claudeStyle.connect, { type: "stdio", command: ["npx", "docs-mcp"], env: { TOKEN: "x" } });

  const remote = await call("seatworks.mcp.parse", { text: JSON.stringify({ type: "remote", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer x" } }) });
  assert.deepEqual(remote.connect, { type: "http", url: "https://mcp.example/mcp", headers: { Authorization: "Bearer x" } });

  // A README writes a port as a number, and the snippet is pasted as it was found. Dropping the
  // table it appears in loses the token beside it, and the server then fails for no visible reason.
  const fromReadme = await call("seatworks.mcp.parse", {
    text: JSON.stringify({ mcpServers: { db: { command: "npx", args: ["db-mcp", 8080], env: { PORT: 5432, DEBUG: false, TOKEN: "keep me" } } } }),
  });
  assert.deepEqual(fromReadme.connect, { type: "stdio", command: ["npx", "db-mcp", "8080"], env: { PORT: "5432", DEBUG: "false", TOKEN: "keep me" } });

  assert.match((await call("seatworks.mcp.parse", { text: "not json" })).error, /not JSON/);
  assert.match((await call("seatworks.mcp.parse", { text: JSON.stringify({ type: "local" }) })).error, /needs a command/);
  assert.match((await call("seatworks.mcp.parse", { text: JSON.stringify({ command: "npx", env: { KEY: { from: "keychain" } } }) })).error, /env gives KEY/, "what has no text form is named, not dropped");
});

test("a server pasted into the settings reaches the seats, and a shipped one can be removed", async () => {
  const { call } = served();
  const read = await call("seatworks.settings.read");
  const saved = await call("seatworks.settings.write", {
    revision: read.revision,
    values: {
      mcp: {
        notes: { enabled: true, label: "Notes", connect: { type: "stdio", command: ["npx", "notes-mcp"] }, roles: ["lead"], rule: "Look things up in the notes." },
        ide: { removed: true },
      },
    },
  });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const team = await call("seatworks.team.read");
  assert.equal(team.mcp.ide, undefined, "a removed server is gone from the team");
  assert.equal(team.mcp.notes.template, false);
  assert.deepEqual(team.mcp.notes.connect, { type: "stdio", command: ["npx", "notes-mcp"] });
  assert.deepEqual(team.roles.lead.mcp, ["notes"]);
  assert.match(team.roles.lead.rules, /Look things up in the notes\./);
});

test("a folder that is there and cannot be read is a refusal, not a rejected call", async () => {
  const { call } = served();
  const root = mkdtempSync(join(tmpdir(), "sw2-noread-"));
  mkdirSync(join(root, "locked"));
  chmodSync(join(root, "locked"), 0o000);
  try {
    const answer = await call("seatworks.paths.list", { path: join(root, "locked") });
    assert.match(answer.error ?? "", /could not be read/, "the screen handles a refusal and cannot handle a rejection");
  } finally {
    chmodSync(join(root, "locked"), 0o700);
  }
});

test("a project detached in this session can be attached again, and the desk's half of a second setup keeps the layer", async () => {
  const { call, runtime } = served();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sw2-again-")));
  const added = await call("seatworks.projects.add", { root });
  assert.equal(typeof added.slug, "string");

  // What the owner set up: a rule every seat is told, and a pasted server with its token.
  const read = await call("seatworks.settings.read", { project: added.slug });
  const saved = await call("seatworks.settings.write", {
    project: added.slug,
    revision: read.revision,
    values: { rules: "Never touch the release branch.", mcp: { docs: { enabled: true, connect: { type: "http", url: "https://x", headers: { Authorization: "Bearer SECRET" } } } } },
  });
  assert.equal(saved.status, "saved", saved.error);

  // Setting the same repository up again writes the whole layer. The folding is the screen's, and is
  // covered where it lives (test/client/data.test.ts); this asserts only the desk's half — that a
  // second add does not itself touch the layer.
  const again = await call("seatworks.projects.add", { root });
  assert.equal(again.slug, added.slug, "the same repository is the same project");
  const still = await call("seatworks.settings.read", { project: added.slug });
  assert.equal(still.values.rules, "Never touch the release branch.");
  assert.equal(still.values.mcp.docs.connect.headers.Authorization, "Bearer SECRET");

  // Detach, then add it again in the same daemon: the record was kept in memory and the second add
  // wrote nothing, reported success, and left every slug-addressed screen answering "never seen".
  assert.deepEqual(await call("seatworks.projects.remove", { project: added.slug }), { removed: added.slug });
  const back = await call("seatworks.projects.add", { root });
  assert.equal(back.slug, added.slug);
  assert.ok(
    (await call("seatworks.projects.list", {})).some((entry: { slug: string }) => entry.slug === added.slug),
    "an attach that reports a slug has to be an attach the rest of the plugin can find",
  );
  assert.equal((await call("seatworks.settings.read", { project: added.slug })).status, "ready");
  runtime.dispose();
});

test("the setup screen can walk this machine's folders to find a repository", async () => {
  const { call } = served();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sw2-rpc-browse-")));
  mkdirSync(join(root, "plain"), { recursive: true });
  execFileSync("git", ["init", "-q", join(root, "repo")]);

  const listed = await call("seatworks.paths.list", { path: root });
  assert.equal(listed.path, root);
  assert.equal(typeof listed.parent, "string", "a folder that is not the root offers the way up");
  assert.deepEqual(
    listed.folders.map((folder: { name: string; repository: boolean }) => [folder.name, folder.repository]).sort(),
    [["plain", false], ["repo", true]],
    "a repository is marked as one",
  );

  const inside = await call("seatworks.paths.list", { path: join(root, "repo") });
  assert.equal(inside.repository, true);
  assert.match((await call("seatworks.paths.list", { path: join(root, "nowhere") })).error, /is not a directory/);
});
