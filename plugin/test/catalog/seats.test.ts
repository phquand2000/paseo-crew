import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { type Kit, loadKit } from "../../server/catalog/kit.ts";
import { seatPairs } from "../../server/catalog/providers.ts";
import { materialize, seatDir, sweepSnapshots } from "../../server/catalog/seats.ts";
import { serversFor } from "../../server/catalog/servers.ts";
import { resolveTeam, withHarness } from "../../server/catalog/team.ts";
import { readConfig } from "../../server/core/config-file.ts";
import { contentRoot } from "../../server/core/paths.ts";
import { reported } from "../console.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const project = { root: "/work/shop", slug: "shop-abc123", state: "/state/shop" };
const context = { node: "/bin/node", socket: "/desk.sock" };
type Server = { args?: string[]; url?: string; env?: unknown };

function put(kit: Kit, path: string, text: string): void {
  mkdirSync(dirname(join(kit.dir, path)), { recursive: true });
  writeFileSync(join(kit.dir, path), text);
}

/** The fixture kit with one more agent, laid down from `files` under its harness folder and loaded as the kit loads it. */
function withAgent(id: string, files: Record<string, string>): Kit {
  const kit = makeKit();
  for (const [path, text] of Object.entries(files)) put(kit, join("harness", id, path), text);
  kit.harnesses[id] = loadKit(kit.dir).harnesses[id]!;
  return kit;
}

test("a Claude seat per project writes shared plus role settings, links skills, clears MCP files and writes the rules to CLAUDE.md", () => {
  const kit = makeKit();
  const team = resolveTeam(kit);
  const home = tempDir("sw2-home-");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  const lead = team.roles.lead!;
  const dir = seatDir(kit, lead.role, lead.harness, home, project);
  assert.equal(basename(dir), "sw2-lead-claude-shop-abc123");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".claude.json"),
    JSON.stringify({
      userID: "u",
      mcpServers: { old: {} },
      enableAllProjectMcpServers: true,
      projects: { "/x": { mcpServers: { rogue: {} }, trust: true } },
    }),
  );
  symlinkSync(join(kit.dir, "harness/claude/settings/lead.settings.json"), join(dir, "settings.json"));

  const changes = materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context));
  assert.ok(changes.length > 0);
  assert.equal(lstatSync(join(dir, "settings.json")).isSymbolicLink(), false);
  assert.deepEqual(readConfig(join(dir, "settings.json"), {}), {
    autoMemoryEnabled: false,
    permissions: { deny: ["WebSearch", "Agent"] },
  });
  assert.equal(readlinkSync(join(dir, "projects")), join(home, ".claude", "projects"));
  const skill = readlinkSync(join(dir, "skills", "ide-guide"));
  assert.equal(dirname(skill), contentRoot(home), "a skill links to a copy under the state, not into the kit");
  assert.equal(
    readFileSync(join(skill, "SKILL.md"), "utf-8"),
    readFileSync(join(kit.dir, "catalog/mcp/ide/skills/ide-guide/SKILL.md"), "utf-8"),
  );
  const state = readConfig<{ mcpServers?: unknown; userID?: string; projects?: Record<string, unknown> }>(
    join(dir, ".claude.json"),
    {},
  );
  assert.deepEqual(state.mcpServers, {});
  assert.equal(state.userID, "u");
  assert.equal("enableAllProjectMcpServers" in state, false);
  assert.deepEqual(state.projects?.["/x"], { mcpServers: {}, trust: true });
  const rules = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
  assert.match(rules, /Prefer the IDE for navigation\./);
  assert.match(rules, /Your IDE tools: `ide_find_references`\./);
  assert.deepEqual(materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context)), []);

  const off = resolveTeam(kit, { mcp: { ide: { enabled: false } } });
  const removed = materialize(kit, off, "lead", home, project, serversFor(kit, off, "lead", context));
  assert.ok(removed.includes("CLAUDE.md removed"));
  assert.ok(removed.includes("skill ide-guide removed"));
  assert.equal(existsSync(join(dir, "CLAUDE.md")), false);
});

test("a seat whose harness reads its servers from a file gets that file, its whole layered settings and its rules in a real file, in JSON or TOML", () => {
  const kit = withAgent("toml", {
    "harness.json": JSON.stringify({
      id: "toml",
      label: "Toml CLI",
      baseProvider: "codex",
      configDirEnv: "TOML_HOME",
      profileRoot: "HOME/.toml",
      contextFile: "AGENTS.md",
      skillsDir: "skills",
      settings: { file: "config.toml", source: "settings.toml", roleSource: "settings/ROLE.settings.toml" },
      mcp: { file: "mcp.toml", delivery: "file", key: "mcp_servers", transports: ["stdio", "http"] },
      provider: {},
    }),
    "settings.toml": 'sandbox = "workspace-write"\n',
    "settings/peer.settings.toml": 'approval = "never"\n',
    "settings/scribe.settings.toml": "",
  });
  const home = tempDir("sw2-home-");
  const rows: [string, string, object][] = [
    [
      "omp",
      JSON.stringify({ written: "by the agent", ask: { enabled: true } }),
      { ask: { enabled: false }, bash: { patterns: [{ match: "git push*", approval: "deny" }] } },
    ],
    ["toml", 'written = "by the agent"\n', { sandbox: "workspace-write", approval: "never" }],
  ];
  for (const [id, own, settings] of rows) {
    const team = resolveTeam(kit, { roles: { peer: { harness: id, model: "glm" } }, mcp: { docs: { enabled: true } } });
    assert.deepEqual(team.errors, [], id);
    const { role, harness } = team.roles.peer!;
    const dir = seatDir(kit, role, harness, home, project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, harness.settings.file), own);
    const outside = join(tempDir("sw2-outside-"), "AGENTS.md");
    writeFileSync(outside, "project rules that must not change");
    symlinkSync(outside, join(dir, "AGENTS.md"));

    const servers = serversFor(kit, team, "peer", context);
    assert.ok(materialize(kit, team, "peer", home, project, servers).length > 0, id);
    assert.deepEqual(
      readConfig(join(dir, harness.settings.file), {}),
      settings,
      `${id}: the kit's settings are the whole file`,
    );
    assert.equal(lstatSync(join(dir, "AGENTS.md")).isSymbolicLink(), false, id);
    assert.match(
      readFileSync(join(dir, "AGENTS.md"), "utf-8"),
      /^# Working rules[^]*Look library APIs up in the docs\./,
    );
    assert.equal(readFileSync(outside, "utf-8"), "project rules that must not change", id);
    const listed = readConfig<Record<string, Record<string, Server>>>(join(dir, harness.mcp.file), {})[
      harness.mcp.key!
    ];
    assert.deepEqual(Object.keys(listed ?? {}).sort(), ["docs", "ide", "team"], id);
    assert.deepEqual(
      listed?.team?.args,
      [join(kit.dir, "mcp", "team.mjs"), "peer", "peer", "/desk.sock"],
      `${id}: the seat is told which role it is and which tool set it holds, so two roles can share one set`,
    );
    assert.equal(listed?.team?.env, undefined, `${id}: a file every seat of its kind reads holds no seat's key`);
    assert.equal(listed?.docs?.url, "https://docs.example/mcp", id);
    for (const name of ["test-first", "plan-check", "ide-guide"])
      assert.ok(existsSync(join(dir, "skills", name, "SKILL.md")), `${id}: ${name}`);
    assert.equal(existsSync(join(dir, "git")), false, `${id}: an optional link to nothing is not made`);
    assert.deepEqual(
      materialize(kit, team, "peer", home, project, servers),
      [],
      `${id}: a second build changes nothing`,
    );
  }
});

test("an unreadable MCP file is written again when the plugin owns it, and left alone when the harness does", (t) => {
  const said = reported(t);
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const team = resolveTeam(kit);
  const peer = team.roles.peer!;
  assert.equal(peer.harness.mcp.delivery, "file", "the Peer's harness takes its servers from this file alone");
  const servers = { team: { type: "stdio", command: ["node", "team.mjs"] } };
  materialize(kit, team, "peer", home, project, servers);
  const owned = join(seatDir(kit, peer.role, peer.harness, home, project), peer.harness.mcp.file);
  writeFileSync(owned, '{ "mcpServers": {');
  materialize(kit, team, "peer", home, project, servers);
  assert.ok(
    readConfig<{ mcpServers?: { team?: unknown } }>(owned, {}).mcpServers?.team,
    "written again, or the Peer would boot with no done or ask",
  );
  assert.match(
    said(),
    /mcp\.json is there but could not be read: .*, and the plugin owns that file, so it was written again/,
  );

  const lead = team.roles.lead!;
  materialize(kit, team, "lead", home, project);
  const kept = join(seatDir(kit, lead.role, lead.harness, home, project), lead.harness.mcp.file);
  const held = `{ "userID": "u-1", "oauthAccount": { "emailAddress": "owner@example.test" }, "projects": { "/work": {} },`;
  writeFileSync(kept, held);
  const changes = materialize(kit, team, "lead", home, project);
  assert.equal(
    readFileSync(kept, "utf-8"),
    held,
    "left exactly as it was: the seed would wipe the account and history",
  );
  assert.equal(
    changes.some((change) => change.includes(lead.harness.mcp.file)),
    false,
    "and not reported as a routine update",
  );
  assert.match(
    said(),
    /\.claude\.json is there but could not be read: .*, so its MCP servers were left alone/,
    "but as trouble",
  );
});

test("a real directory where a skill link should go is left alone, not turned into a seat that cannot start", (t) => {
  const said = reported(t);
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const team = resolveTeam(kit);
  const dir = seatDir(kit, team.roles.peer!.role, team.roles.peer!.harness, home, project);
  mkdirSync(join(dir, "skills", "test-first"), { recursive: true });
  writeFileSync(join(dir, "skills", "test-first", "NOTES.md"), "something the harness made for itself\n");

  const changes = materialize(kit, team, "peer", home, project);
  assert.ok(changes.length > 0, "the rest of the seat is still built, where a throw refused its launch for ever");
  assert.equal(
    readFileSync(join(dir, "skills", "test-first", "NOTES.md"), "utf-8").trim(),
    "something the harness made for itself",
  );
  assert.match(
    said(),
    /skill test-first for the peer: .* exists and is not a link, so it was left alone/,
    "and the owner is told why",
  );
});

const cx = (catalog: string[]) =>
  JSON.stringify({
    id: "cx",
    label: "Cx",
    baseProvider: "codex",
    configDirEnv: "CODEX_HOME",
    profileRoot: "HOME/.cx",
    contextFile: "AGENTS.md",
    skillsDir: "skills",
    settings: { file: "config.toml", source: "settings.toml", roleSource: "settings/ROLE.settings.toml" },
    stateWrites: { path: "sandbox_workspace_write.writable_roots", delivery: "file" },
    files: { "rules/seat.rules": ["rules/all.rules", "rules/ROLE.rules"] },
    modelCatalog: {
      command: catalog,
      list: "models",
      clear: ["multi_agent_version"],
      file: "catalog.json",
      setting: "model_catalog_json",
    },
    mcp: { file: "config.toml", delivery: "launch", transports: ["stdio", "http"] },
    provider: {},
  });

test("an agent configured in its own file format gets its catalog trimmed, its state grant and its role's files, and one whose catalog cannot be read seats no one", () => {
  const offering =
    "process.stdout.write(JSON.stringify({models:[{slug:'a',multi_agent_version:'v2'},{slug:'b',multi_agent_version:'v1'}]}))";
  const kit = withAgent("cx", {
    "harness.json": cx(["node", "-e", offering]),
    "settings.toml": 'approval_policy = "never"\n[sandbox_workspace_write]\nnetwork_access = true\n',
    "settings/lead.settings.toml": 'sandbox_mode = "workspace-write"\n',
    "settings/peer.settings.toml": "",
    "rules/all.rules": 'prefix_rule(pattern = ["git", "push"], decision = "forbidden")\n',
    "rules/lead.rules": 'prefix_rule(pattern = ["git", "commit"], decision = "forbidden")\n',
  });
  put(kit, "content/prompts/LEAD.md", "# Lead\n\nWrite a plan in {{state}}/plans/ first.\n");
  const team = withHarness(resolveTeam(kit), "lead", kit.harnesses.cx!);
  const home = tempDir("sw2-cx-home-");
  materialize(kit, team, "lead", home, project, serversFor(kit, team, "lead", context));
  const dir = seatDir(kit, team.roles.lead!.role, kit.harnesses.cx!, home, project);
  type Seat = {
    approval_policy?: string;
    sandbox_mode?: string;
    sandbox_workspace_write?: { network_access?: boolean; writable_roots?: string[] };
    model_catalog_json?: string;
  };
  const config = readConfig<Seat>(join(dir, "config.toml"), {});
  assert.equal(config.approval_policy, "never");
  assert.equal(config.sandbox_mode, "workspace-write");
  assert.equal(
    config.sandbox_workspace_write?.network_access,
    true,
    "the grant is added to the table, not put in its place",
  );
  assert.deepEqual(
    config.sandbox_workspace_write?.writable_roots,
    [join(project.state, "plans")],
    "named, not computed: comparing against stateWrites itself passed for any answer, even none",
  );
  assert.equal(config.model_catalog_json, join(dir, "catalog.json"));
  assert.deepEqual(readConfig(config.model_catalog_json, {}), {
    models: [
      { slug: "a", multi_agent_version: null },
      { slug: "b", multi_agent_version: null },
    ],
  });
  assert.equal(
    readFileSync(join(dir, "rules", "seat.rules"), "utf-8"),
    'prefix_rule(pattern = ["git", "push"], decision = "forbidden")\n\nprefix_rule(pattern = ["git", "commit"], decision = "forbidden")\n',
  );
  const pairs = seatPairs(kit).map((pair) => `${pair.role.role}-${pair.harness.id}`);
  assert.ok(pairs.includes("lead-cx"));
  assert.ok(
    !pairs.includes("peer-cx"),
    "a role missing its rules file cannot sit there, rather than sitting without its rules",
  );

  const blind = withAgent("cx", {
    "harness.json": cx(["node", "-e", "process.exit(3)"]),
    "settings.toml": "",
    "settings/lead.settings.toml": "",
    "rules/all.rules": "",
    "rules/lead.rules": "",
  });
  const refused = withHarness(resolveTeam(blind), "lead", blind.harnesses.cx!);
  const elsewhere = tempDir("sw2-cx-home-");
  assert.throws(() => materialize(blind, refused, "lead", elsewhere, project, {}), {
    message: /^Cx's model list could not be read from `node -e process\.exit\(3\)`/,
  });
  const nothing = seatDir(blind, refused.roles.lead!.role, blind.harnesses.cx!, elsewhere, project);
  assert.equal(existsSync(join(nothing, "config.toml")), false, "and nothing of the seat is written");
});

test("a changed skill reaches the seat as a new copy, the one read before stays as it was, and a copy nobody touches for two weeks goes", () => {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const team = resolveTeam(kit);
  const link = join(
    seatDir(kit, team.roles.peer!.role, team.roles.peer!.harness, home, project),
    "skills",
    "test-first",
  );
  materialize(kit, team, "peer", home, project);
  const before = readlinkSync(link);
  put(kit, "content/skills/peer/test-first/SKILL.md", "---\nname: test-first\ndescription: tests, now stricter\n---\n");
  materialize(kit, team, "peer", home, project);
  const after = readlinkSync(link);
  assert.notEqual(after, before);
  assert.match(
    readFileSync(join(before, "SKILL.md"), "utf-8"),
    /description: tests\n/,
    "a seat mid-turn on the old copy still reads it whole",
  );
  const old = new Date(Date.now() - 15 * 86_400_000);
  utimesSync(before, old, old);
  sweepSnapshots(home);
  assert.equal(existsSync(before), false);
  assert.equal(existsSync(after), true, "the copy a seat started on lately stays");
});
