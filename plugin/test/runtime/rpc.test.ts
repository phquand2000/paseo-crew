import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { paseoConfigPath, stateRoot } from "../../server/core/paths.ts";
import { registerRpc } from "../../server/runtime/rpc.ts";
import { Runtime } from "../../server/runtime/runtime.ts";
import { KEPT } from "../../shared/settings.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const nobodySeated = { agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null, prevCursor: null } }) } };

function served(paseo: unknown = nobodySeated) {
  // Paseo's config is always there where a plugin runs, and the plugin writes its seats' providers into it.
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), "{}\n");
  const kit = makeKit();
  const host = new PaseoHost();
  const runtime = new Runtime(kit, host, { reloadDaemon: async () => true });
  const handlers = new Map<string, (input: any) => Promise<any>>();
  type Schema = { parse(value: unknown): unknown };
  // Paseo hands every handler the live daemon handle beside the input; the panel checks each answer, as sent, against its schema.
  const server = {
    handle: (contract: { name: string; input: Schema; output: Schema }, handler: (input: unknown, context: { paseo: unknown }) => unknown) =>
      handlers.set(contract.name, async (input) => contract.output.parse(JSON.parse(JSON.stringify(await handler(contract.input.parse(input), { paseo }))))),
  };
  const names = registerRpc(host.answering(server as never), runtime.control, runtime.control.human, () => {});
  const call = async (name: string, input: unknown = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `no handler for ${name}`);
    return handler(input);
  };
  return { names, call, host };
}

test("the plugin serves the catalog, settings, projects, team and status over RPC", async () => {
  const { names, call } = served();
  assert.deepEqual(names.sort(), [
    "seatworks.catalog.read",
    "seatworks.doctor.run",
    "seatworks.flow.read",
    "seatworks.land.decide",
    "seatworks.mcp.parse",
    "seatworks.models.refresh",
    "seatworks.orders.read",
    "seatworks.paths.list",
    "seatworks.projects.add",
    "seatworks.projects.candidates",
    "seatworks.projects.list",
    "seatworks.projects.remove",
    "seatworks.question.answer",
    "seatworks.report.read",
    "seatworks.settings.read",
    "seatworks.settings.write",
    "seatworks.status.read",
    "seatworks.team.read",
    "seatworks.upkeep.clean",
    "seatworks.upkeep.decide",
    "seatworks.upkeep.migrate",
    "seatworks.upkeep.update",
  ]);
  const catalog = await call("seatworks.catalog.read");
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "lead").harnesses, ["claude", "omp"]);
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "scribe").harnesses, ["claude", "omp"]);
  assert.deepEqual(catalog.mcp.map((entry: any) => [entry.id, entry.transport]), [["ide", "stdio"], ["docs", "http"]]);
  assert.match((await call("seatworks.team.read", { project: "nowhere-000000" })).error, /No project named nowhere-000000/, "a team for no project is a refusal, not a team missing its roles");
});

test("the daemon handle a panel call arrives with is kept, not thrown away", async () => {
  // Only its identity is read, so it is a marker, not a shaped daemon.
  const paseo = { handle: "the daemon" };
  const { call, host } = served(paseo);
  assert.equal(host.connected(), false, "nothing has called in yet");

  // A settings save reloads the daemon; bound only from lifecycle hooks, the desk had no handle until the next seat.
  await call("seatworks.catalog.read");
  assert.equal(host.connected(), true, "the one handle the runtime was missing came in with the call");
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

  const state = join(stateRoot(), "projects/shop-abc123");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "meta.json"), JSON.stringify({ root: "/work/shop", slug: "shop-abc123" }));
  assert.deepEqual(await call("seatworks.projects.list"), [{ slug: "shop-abc123", root: "/work/shop" }]);
  const projectRead = await call("seatworks.settings.read", { project: "shop-abc123" });
  assert.deepEqual(projectRead.machine, { mcp: { docs: { enabled: true } } });
  const projectSaved = await call("seatworks.settings.write", { project: "shop-abc123", revision: projectRead.revision, values: { roles: { lead: { harness: "omp" } }, mcp: { ide: { enabled: false } } } });
  assert.equal(projectSaved.status, "saved");
  team = await call("seatworks.team.read", { project: "shop-abc123" });
  assert.equal(team.roles.lead.harness, "omp");
  assert.equal(team.roles.lead.provider, "sw2-lead-omp");
  assert.deepEqual(team.roles.lead.mcp, ["docs"]);
  assert.match(team.roles.lead.rules, /Look library APIs up in the docs\./);
  assert.equal((await call("seatworks.team.read")).roles.lead.harness, "claude");
  const status = await call("seatworks.status.read", { project: "shop-abc123" });
  assert.match(status.text, /No open lanes\./);
});

test("settings a team can't run on are refused with the reason, and stale writes conflict", async () => {
  const { call } = served();
  const read = await call("seatworks.settings.read");
  const refused = await call("seatworks.settings.write", { revision: read.revision, values: { roles: { supervisor: { harness: "omp" } } } });
  assert.equal(refused.status, "invalid");
  assert.match(refused.error, /Oh My Pi has no supervisor settings/);
  assert.equal((await call("seatworks.settings.write", { revision: read.revision, values: { rules: "one" } })).status, "saved");
  assert.equal((await call("seatworks.settings.write", { revision: read.revision, values: { rules: "two" } })).status, "conflict");
  const unknown = await call("seatworks.settings.read", { project: "nowhere" });
  assert.equal(unknown.status, "invalid");
});

test("a sensor's key is saved but never read back, and a save carrying what was shown in its place keeps it", async () => {
  const { call } = served();
  const file = join(stateRoot(), "settings.json");
  const secret = "a-key-kept-on-this-machine";
  const read = await call("seatworks.settings.read");
  const saved = await call("seatworks.settings.write", { revision: read.revision, values: { sensor: { jev: { key: secret } } } });
  assert.deepEqual([saved.status, saved.values.sensor], ["saved", { jev: { key: KEPT } }]);
  const shown = await call("seatworks.settings.read");
  assert.equal(shown.values.sensor.jev.key, KEPT);
  const state = join(stateRoot(), "projects/shop-abc123");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "meta.json"), JSON.stringify({ root: "/work/shop", slug: "shop-abc123" }));
  const project = await call("seatworks.settings.read", { project: "shop-abc123" });
  assert.equal(project.machine.sensor.jev.key, KEPT, "a project's screen shows the machine layer under it, key and all, as KEPT");
  assert.doesNotMatch(JSON.stringify([shown, project, await call("seatworks.team.read")]), /kept-on-this-machine/);

  const again = await call("seatworks.settings.write", { revision: shown.revision, values: { ...shown.values, rules: "keep it small" } });
  assert.equal(again.status, "saved");
  assert.match(readFileSync(file, "utf-8"), /kept-on-this-machine/, "KEPT saved back keeps the key");
  await call("seatworks.settings.write", { revision: again.revision, values: { rules: "keep it small" } });
  assert.doesNotMatch(readFileSync(file, "utf-8"), /kept-on-this-machine/, "a save without it removes it");
});

test("the watch is judged only by off, a sensor the kit has, or a role that can judge, and any other name is refused with the choices", async () => {
  const { call } = served();
  const read = await call("seatworks.settings.read");
  const refused = await call("seatworks.settings.write", { revision: read.revision, values: { attention: { judge: "oracle" } } });
  assert.equal(refused.status, "invalid");
  assert.match(refused.error, /judged by oracle, which is neither off, a sensor the kit knows nor a role that can judge \(none\)/);
  assert.equal((await call("seatworks.settings.write", { revision: read.revision, values: { attention: { judge: "off" } } })).status, "saved");
});

test("a project can be registered by its path before any agent has run in it", async () => {
  const { call } = served();
  const root = realpathSync(tempDir("sw2-rpc-project-"));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, "src"), { recursive: true });
  const added = await call("seatworks.projects.add", { root: join(root, "src") });
  assert.equal(added.root, root, "a path inside the project registers the project root");
  assert.ok(added.slug.length > 0);
  const listed = await call("seatworks.projects.list");
  assert.ok(listed.some((entry: { slug: string; root: string }) => entry.slug === added.slug && entry.root === root), JSON.stringify(listed));

  const read = await call("seatworks.settings.read", { project: added.slug });
  assert.equal(read.status, "ready");
  const saved = await call("seatworks.settings.write", { project: added.slug, revision: read.revision, values: { roles: { peer: { harness: "omp" } } } });
  assert.equal(saved.status, "saved");
  assert.equal((await call("seatworks.team.read", { project: added.slug })).roles.peer.harness, "omp");

  const missing = await call("seatworks.projects.add", { root: join(root, "nowhere") });
  assert.match(missing.error, /is not a directory/);
});

test("attaching a project is undone by detaching it, unless work is still running in it", async () => {
  const { call } = served();
  const root = realpathSync(tempDir("sw2-rpc-attach-"));
  execFileSync("git", ["init", "-q", root]);
  const added = await call("seatworks.projects.add", { root });
  const read = await call("seatworks.settings.read", { project: added.slug });
  await call("seatworks.settings.write", { project: added.slug, revision: read.revision, values: { roles: { peer: { harness: "omp" } } } });

  const state = join(stateRoot(), "projects", added.slug);
  writeFileSync(join(state, "ledger.json"), JSON.stringify({ lanes: { L1: { id: "L1", status: "open" } }, tasks: {} }));
  const refused = await call("seatworks.projects.remove", { project: added.slug });
  assert.match(refused.error, /1 open or waiting lane\(s\)/);
  writeFileSync(join(state, "ledger.json"), JSON.stringify({ lanes: { L1: { id: "L1", status: "waiting", after: ["L0"] } }, tasks: {} }));
  assert.match((await call("seatworks.projects.remove", { project: added.slug })).error, /1 open or waiting lane\(s\)/, "a lane waiting to open is work still to come");

  // Closed lanes and their cut tasks are provenance that nothing deletes, so they must not count as work.
  writeFileSync(
    join(state, "ledger.json"),
    JSON.stringify({ lanes: { L1: { id: "L1", status: "closed" } }, tasks: { "L1-T1": { id: "L1-T1", lane: "L1", status: "cut" } } }),
  );
  assert.deepEqual(await call("seatworks.projects.remove", { project: added.slug }), { removed: added.slug });
  const listed = await call("seatworks.projects.list");
  assert.equal(listed.some((entry: { slug: string }) => entry.slug === added.slug), false);
  assert.match((await call("seatworks.projects.remove", { project: added.slug })).error, /has been seen/);
});

test("the projects a setup screen may offer leave out worktrees, gone directories and the ones already set up", async () => {
  const { call } = served();
  const repo = realpathSync(tempDir("sw2-rpc-live-"));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
  const linked = join(realpathSync(tempDir("sw2-rpc-linked-")), "wt");
  execFileSync("git", ["worktree", "add", "-q", "-b", "side", linked], { cwd: repo });
  const plain = realpathSync(tempDir("sw2-rpc-plain-"));
  const ours = join(stateRoot(), "worktrees/shop-ef484b/S0");
  mkdirSync(ours, { recursive: true });
  const taken = realpathSync(tempDir("sw2-rpc-taken-"));
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

  // A README writes a port as a number; dropping its table also lost the token beside it.
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
  const root = tempDir("sw2-noread-");
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
  const { call } = served();
  const root = realpathSync(tempDir("sw2-again-"));
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

  // The folding is the screen's (test/client/data.test.ts); this asserts only that a second add leaves the layer alone.
  const again = await call("seatworks.projects.add", { root });
  assert.equal(again.slug, added.slug, "the same repository is the same project");
  const still = await call("seatworks.settings.read", { project: added.slug });
  assert.equal(still.values.rules, "Never touch the release branch.");
  assert.equal(still.values.mcp.docs.connect.headers.Authorization, "Bearer SECRET");

  // The record was once kept in memory, so a second add after Detach wrote nothing.
  assert.deepEqual(await call("seatworks.projects.remove", { project: added.slug }), { removed: added.slug });
  const back = await call("seatworks.projects.add", { root });
  assert.equal(back.slug, added.slug);
  assert.ok(
    (await call("seatworks.projects.list", {})).some((entry: { slug: string }) => entry.slug === added.slug),
    "an attach that reports a slug has to be an attach the rest of the plugin can find",
  );
  assert.equal((await call("seatworks.settings.read", { project: added.slug })).status, "ready");
});

test("the setup screen can walk this machine's folders to find a repository", async () => {
  const { call } = served();
  const root = realpathSync(tempDir("sw2-rpc-browse-"));
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

test("a settings file that will not parse is reported without quoting what it holds", async () => {
  const { call } = served();
  const file = join(stateRoot(), "settings.json");
  const read = await call("seatworks.settings.read");
  mkdirSync(stateRoot(), { recursive: true });
  // A pasted server's token in a common hand typo, whose parse error quotes the line: short enough to fall inside V8's quoted window.
  writeFileSync(file, '{ "rules": "keep it small", "headers": { "Authorization": \'SEKRIT\' } }');

  const shown = [
    await call("seatworks.settings.read"),
    await call("seatworks.settings.write", { revision: read.revision, values: { rules: "x" } }),
    await call("seatworks.team.read"),
    await call("seatworks.doctor.run"),
  ];
  for (const answer of shown) {
    assert.match(JSON.stringify(answer), /is not JSON|could not be read|not being used/, "each screen says the file cannot be read");
    assert.doesNotMatch(JSON.stringify(answer), /SEKRIT/, "and none of them quotes the file back");
  }
  writeFileSync(file, "{}");
});

