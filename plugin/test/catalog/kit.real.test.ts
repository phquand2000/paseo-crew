import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPrompt } from "../../server/catalog/content.ts";
import { PASEO_TOOLS, loadKit } from "../../server/catalog/kit.ts";
import { desiredProvider, seatPairs } from "../../server/catalog/providers.ts";
import { materialize, seatDir, seedRecords } from "../../server/catalog/seats.ts";
import { resolveTeam, serversFor } from "../../server/catalog/team.ts";
import { tempDir } from "../../server/core/testing.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the shipped kit resolves to a complete team, and every role's seat builds with no hidden word in it", () => {
  const kit = loadKit(pluginRoot);
  const off = resolveTeam(kit);
  assert.deepEqual(off.errors, []);
  assert.deepEqual(Object.values(off.mcp).filter((state) => state.enabled), [], "the kit ships no server switched on");
  const team = resolveTeam(kit, { mcp: Object.fromEntries(Object.keys(kit.mcp).map((id) => [id, { enabled: true }])) });
  assert.deepEqual(team.errors, []);
  assert.deepEqual(kit.roles.map((role) => role.role).sort(), ["lead", "peer", "reviewer", "supervisor", "watcher"]);
  assert.deepEqual(Object.keys(kit.mcp).sort(), ["code-search", "context7", "intellij-index"]);
  assert.deepEqual(seatPairs(kit).map((pair) => `${pair.role.role}-${pair.harness.id}`).sort(), ["lead-claude", "peer-claude", "peer-devin", "reviewer-claude", "reviewer-devin", "supervisor-claude", "watcher-devin"]);
  const home = tempDir("sw2-real-home-");
  const project = { slug: "demo-000000", state: "/state/demo" };
  for (const [name, seat] of Object.entries(team.roles)) {
    const { role, harness } = seat;
    const where = project;
    materialize(kit, team, name, home, where, serversFor(kit, team, name, { node: "/bin/node", spool: "/spool" }));
    const dir = seatDir(kit, role, harness, home, where);
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${name} skills dir`);
    let context: string;
    if (harness.systemPrompt === "file" && harness.promptFile) {
      const file = join(dir, harness.promptFile);
      assert.equal(lstatSync(file).isSymbolicLink(), false, `${name} prompt is a real file`);
      context = readFileSync(file, "utf-8");
    } else {
      assert.doesNotMatch(renderPrompt(kit, role, { guides: "/guides", state: "/state" }), /\{\{/, `${name} prompt has no placeholder left`);
      context = readFileSync(join(dir, harness.contextFile!), "utf-8");
    }
    assert.doesNotMatch(context, /\{\{/, `${name} seat has no placeholder left`);
    if (seat.mcp.length === 0) {
      assert.doesNotMatch(context, /intellij-index MCP tools/, `${name} takes no server, so it carries no server rule`);
      assert.equal(existsSync(join(dir, harness.skillsDir, "ide-index-mcp", "SKILL.md")), false, `${name} takes no server, so it has no IDE skill`);
      continue;
    }
    assert.match(context, /intellij-index MCP tools/, `${name} seat carries the IntelliJ rule`);
    assert.match(context, /context7/, `${name} seat carries the docs rule`);
    assert.ok(existsSync(join(dir, harness.skillsDir, "ide-index-mcp", "SKILL.md")), `${name} has the IDE skill`);
  }
});

test("project records are seeded once and never overwritten", () => {
  const kit = loadKit(pluginRoot);
  const state = tempDir("sw2-state-");
  const first = seedRecords(kit, state);
  assert.ok(first.includes("notebook.md"));
  assert.deepEqual(seedRecords(kit, state), []);
});

test("no shipped role is left with Paseo's own tools at their default", () => {
  const kit = loadKit(pluginRoot);
  const team = resolveTeam(kit);
  for (const { role, harness } of seatPairs(kit)) {
    const entry = desiredProvider(kit, team, role, harness);
    assert.ok(entry.paseoTools, `${role.role} on ${harness.id} carries no Paseo tool policy, so every Paseo tool stays on`);
  }
  const watcher = kit.roles.find((role) => role.role === "watcher")!;
  const policy = desiredProvider(kit, team, watcher, kit.harnesses.devin!).paseoTools as { disabledTools: string[] };
  assert.deepEqual(
    PASEO_TOOLS.filter((tool) => !policy.disabledTools.includes(tool)).sort(),
    ["get_agent_activity", "list_agents"],
    "the Watcher reads what the other seats did, and that is the whole of its reach",
  );
  for (const acting of ["create_agent", "kill_agent", "archive_agent", "send_agent_prompt", "cancel_agent", "update_agent", "respond_to_permission"]) {
    assert.ok(policy.disabledTools.includes(acting), `the Watcher watches the work and must not be able to ${acting}`);
  }
});

test("the Supervisor can set its own cadence for reading the work, rather than the desk fixing one", () => {
  const kit = loadKit(pluginRoot);
  const team = resolveTeam(kit);
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  const policy = desiredProvider(kit, team, supervisor, kit.harnesses.claude!).paseoTools as { disabledTools: string[] };
  for (const own of ["create_heartbeat", "delete_heartbeat", "list_schedules"]) {
    assert.ok(!policy.disabledTools.includes(own), `a heartbeat is how a Supervisor decides when to look, so it must reach ${own}`);
  }
  for (const acting of ["create_agent", "kill_agent", "send_agent_prompt", "archive_agent"]) {
    assert.ok(policy.disabledTools.includes(acting), `the Supervisor advises and must not ${acting} behind the desk`);
  }
});

test("every page the kit puts on the shelf says what it owns, when to take it, and when it is ceremony", () => {
  const kit = loadKit(pluginRoot);
  const names = Object.keys(kit.templates).sort();
  assert.ok(names.length >= 10, `the shelf is worth having only if there is a choice on it: ${names.join(", ")}`);
  for (const name of names) {
    const spec = kit.templates[name]!;
    for (const field of ["owns", "prevents", "activate", "ceremony"] as const) {
      assert.ok(spec[field].length > 0, `${name} does not say its ${field}, so nobody can judge whether to keep it`);
    }
    assert.match(spec.body, /^# /m, `${name} has no heading to start from`);
    assert.doesNotMatch(spec.body, /\{\{/, `${name} holds a placeholder nothing fills in`);
  }
  // The measured finding this shelf is built on: a page that restates the repository costs context and buys nothing.
  for (const name of names) {
    assert.doesNotMatch(kit.templates[name]!.body, /directory tree|architecture overview|dependency list/i, `${name} asks for something measured not to help`);
  }
});

test("the arguments the desk reads back are the ones each seat's own tool set offers it", () => {
  const kit = loadKit(pluginRoot);
  const tools = JSON.parse(readFileSync(join(pluginRoot, "mcp", "tools.json"), "utf-8")) as Record<string, { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]>;
  const propsOf = (set: string, tool: string) => Object.keys(tools[set]?.find((entry) => entry.name === tool)?.inputSchema?.properties ?? {});

  // A hand-back is read differently for a review than for code — worker.ts takes verdict and
  // findings from one and outcome and summary from the other — so each seat has to be OFFERED the
  // words its own hand-back is read with. Two roles may share a tool set; these two must not,
  // because a reviewer hands back a judgement and a peer hands back work.
  const setFor = (roleName: string) => kit.roles.find((role) => role.role === roleName)!.tools!;
  for (const field of ["verdict", "findings"]) {
    assert.ok(propsOf(setFor("reviewer"), "done").includes(field), `a reviewer is never asked for its ${field}, so the desk would read an empty one`);
  }
  for (const field of ["outcome", "summary"]) {
    assert.ok(propsOf(setFor("peer"), "done").includes(field), `a peer is never asked for its ${field}`);
  }
  assert.notDeepEqual(propsOf(setFor("reviewer"), "done"), propsOf(setFor("peer"), "done"));
});

test("a prompt never tells a seat to use something that seat cannot reach", () => {
  const kit = loadKit(pluginRoot);
  const tools = JSON.parse(readFileSync(join(pluginRoot, "mcp", "tools.json"), "utf-8")) as Record<string, { name: string }[]>;
  const everySkill = new Set(
    readdirSync(join(pluginRoot, "content", "skills"))
      .flatMap((set) => readdirSync(join(pluginRoot, "content", "skills", set)).map((name) => name)),
  );

  for (const role of kit.roles) {
    const text = readFileSync(join(pluginRoot, "content", role.prompt), "utf-8");
    const ticked = new Set([...text.matchAll(/`([a-z][a-z_-]{2,})`/g)].map((hit) => hit[1]!));
    const ownTools = new Set((tools[role.tools ?? ""] ?? []).map((entry) => entry.name));
    const allowed = role.paseoTools?.allow;

    for (const name of ticked) {
      // A Paseo tool it names has to be one its own policy leaves on.
      if (PASEO_TOOLS.includes(name)) {
        const reachable = allowed ? allowed.includes(name) : role.paseoTools?.enabled !== false;
        assert.ok(reachable, `${role.role}'s prompt says to use the Paseo tool ${name}, which its policy denies it`);
      }
      // A skill it names has to be one it is given.
      if (everySkill.has(name)) {
        const given = new Set([
          ...(role.skills ? readdirSync(join(pluginRoot, "content", "skills", role.skills)) : []),
          ...(role.extraSkills ?? []).map((entry) => entry.split(":")[1]!),
        ]);
        assert.ok(given.has(name), `${role.role}'s prompt says to open the skill ${name}, which it is not given`);
      }
      // A desk tool it names has to be in its own set. Names that are neither are ordinary prose.
      const deskTool = Object.values(tools).some((set) => set.some((entry) => entry.name === name));
      if (deskTool && !PASEO_TOOLS.includes(name)) {
        assert.ok(ownTools.has(name), `${role.role}'s prompt says to call ${name}, which belongs to another seat's set`);
      }
    }
  }
});
