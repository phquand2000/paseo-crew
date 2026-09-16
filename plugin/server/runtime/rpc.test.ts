import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const HOME = mkdtempSync(join(tmpdir(), "sw2-rpc-home-"));
process.env.HOME = HOME;

const { Runtime } = await import("./runtime.ts");
const { registerRpc } = await import("./rpc.ts");
const { makeKit } = await import("../catalog/testkit.ts");

function served() {
  const kit = makeKit();
  const runtime = new Runtime(kit, { outboxFile: join(HOME, "outbox.json"), reloadDaemon: async () => true });
  const handlers = new Map<string, (input: any) => any>();
  const names = registerRpc({ handle: (contract: { name: string; input: { parse(value: unknown): unknown } }, handler: (input: unknown) => unknown) => handlers.set(contract.name, (input) => handler(contract.input.parse(input))) }, runtime.control);
  const call = async (name: string, input: unknown = {}) => {
    const handler = handlers.get(name);
    assert.ok(handler, `no handler for ${name}`);
    return JSON.parse(JSON.stringify(await handler(input)));
  };
  return { kit, runtime, names, call };
}

test("the plugin serves the catalog, settings, projects, team and status over RPC", async () => {
  const { names, call } = served();
  assert.deepEqual(names.sort(), [
    "seatworks.catalog.read",
    "seatworks.doctor.run",
    "seatworks.projects.add",
    "seatworks.projects.list",
    "seatworks.settings.read",
    "seatworks.settings.reset",
    "seatworks.settings.write",
    "seatworks.status.read",
    "seatworks.team.read",
  ]);
  const catalog = await call("seatworks.catalog.read");
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "lead").harnesses, ["claude", "devin"]);
  assert.deepEqual(catalog.roles.find((role: any) => role.id === "watcher").harnesses, ["devin"]);
  assert.deepEqual(catalog.mcp.map((entry: any) => [entry.id, entry.transport]), [["ide", "stdio"], ["docs", "http"]]);
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
