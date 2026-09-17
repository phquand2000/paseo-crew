import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTeam, rulesFor, serversFor, skillDirsFor, withHarness } from "../../server/catalog/team.ts";
import { makeKit } from "../../server/catalog/testkit.ts";

const kit = makeKit();
const context = { node: "/bin/node", spool: "/spool" };

test("with no settings every role gets its catalog defaults and the MCP servers enabled by default", () => {
  const team = resolveTeam(kit);
  assert.deepEqual(team.errors, []);
  assert.equal(team.roles.supervisor!.harness.id, "claude");
  assert.equal(team.roles.supervisor!.model!.id, "opus");
  assert.equal(team.roles.supervisor!.thinking, "high");
  assert.equal(team.roles.peer!.harness.id, "devin");
  assert.equal(team.roles.peer!.thinking, undefined);
  assert.deepEqual(team.roles.lead!.mcp, ["ide"]);
  assert.deepEqual(team.roles.supervisor!.mcp, []);
  assert.deepEqual(team.roles.watcher!.mcp, []);
  assert.equal(team.mcp.docs!.enabled, false);
  assert.equal(team.attention.leadIdleMinutes, 15);
});

test("the project layer overrides the machine layer, and switching harness drops the other harness's model", () => {
  const machine = { mcp: { docs: { enabled: true }, ide: { settings: { port: 1234 } } }, rules: "Write tests first." };
  const project = { roles: { lead: { harness: "devin" } }, mcp: { ide: { roles: ["peer"] } }, rules: "Use pnpm." };
  const team = resolveTeam(kit, machine, project);
  assert.deepEqual(team.errors, []);
  const lead = team.roles.lead!;
  assert.equal(lead.harness.id, "devin");
  assert.equal(lead.model!.id, "swe");
  assert.equal(lead.thinking, undefined);
  assert.deepEqual(lead.mcp, ["docs"]);
  assert.deepEqual(team.roles.peer!.mcp, ["ide", "docs"]);
  assert.equal(team.rules, "Write tests first.\n\nUse pnpm.");
  const leadServers = serversFor(kit, team, "lead", context) as Record<string, any>;
  assert.deepEqual(Object.keys(leadServers).sort(), ["docs", "team"]);
  assert.deepEqual(leadServers.docs, { type: "http", url: "https://docs.example/mcp" });
  const peerServers = serversFor(kit, team, "peer", context) as Record<string, any>;
  const proxy = JSON.parse(peerServers.ide.args[1]);
  assert.equal(proxy.backend.url, "http://127.0.0.1:1234/mcp");
  assert.equal(proxy.open.args.path, "{root}");
  assert.deepEqual(proxy.tools, ["ide_find_references", "ide_refactor_rename"]);
  assert.equal(proxy.instructions, "Prefer the IDE tools.");
});

test("settings that can't describe a working team are reported, not guessed around", () => {
  const team = resolveTeam(
    kit,
    { roles: { scout: {}, lead: { model: "gpt" } }, mcp: { nope: {}, ide: { settings: { port: "x", host: "h" } } } },
    { roles: { supervisor: { harness: "devin" }, peer: { thinking: "high" } }, mcp: { docs: { roles: ["watcher"] } } },
  );
  const text = team.errors.join("\n");
  assert.match(text, /unknown role scout/);
  assert.match(text, /The MCP server nope has nothing to connect to/);
  assert.match(text, /IDE setting port must be a number/);
  assert.match(text, /IDE has no setting named host/);
  assert.match(text, /Devin CLI has no supervisor settings/);
  assert.match(text, /Docs can't be given to the watcher role/);
});

test("one seat can be told something the others are not", () => {
  const team = resolveTeam(kit, { rules: "Keep diffs small." }, { roles: { peer: { rules: "Never touch the generated client." } } });
  assert.deepEqual(team.errors, []);
  const peer = rulesFor(team, "peer");
  assert.match(peer, /Keep diffs small\./, "what every seat is told still reaches this one");
  assert.match(peer, /Rules from the Human, for the Peer/);
  assert.match(peer, /Never touch the generated client\./);
  assert.doesNotMatch(rulesFor(team, "lead"), /generated client/, "and no other seat is told it");
});

test("a seat may run a model the harness catalog does not list", () => {
  const team = resolveTeam(kit, { roles: { lead: { model: "gpt-5.6-sol" } } });
  assert.deepEqual(team.errors, [], "the catalog is what the screen offers, not what the owner is allowed");
  assert.equal(team.roles.lead!.model?.id, "gpt-5.6-sol");
});

test("rules gather each enabled server's rule, the role's tools and notes, harness hints and the Human's rules", () => {
  const team = resolveTeam(kit, { rules: "Keep diffs small." });
  const peer = rulesFor(team, "peer");
  assert.match(peer, /^# Working rules/);
  assert.match(peer, /Prefer the IDE for navigation\./);
  assert.match(peer, /Your IDE tools: `ide_find_references`, `ide_refactor_rename`\./);
  assert.match(peer, /Check diagnostics before handing back\./);
  assert.match(peer, /List a server's tools once/);
  assert.match(peer, /## Rules from the Human\n\nKeep diffs small\./);
  assert.doesNotMatch(rulesFor(team, "lead"), /List a server's tools/);
  const watcher = rulesFor(team, "watcher");
  assert.match(watcher, /## Rules from the Human\n\nKeep diffs small\./);
  assert.doesNotMatch(watcher, /IDE|ide_find_references|List a server's tools/);
  assert.equal(rulesFor(resolveTeam(kit), "supervisor"), "");
});

test("a server's skills follow it: on when it is enabled for the role, gone when it is off", () => {
  assert.deepEqual([...skillDirsFor(resolveTeam(kit), "lead").keys()], ["ide-guide"]);
  assert.deepEqual([...skillDirsFor(resolveTeam(kit, { mcp: { ide: { enabled: false } } }), "lead").keys()], []);
});

test("a seat opened on another harness than the settings choose gets that harness's default model", () => {
  const team = withHarness(resolveTeam(kit), "lead", kit.harnesses.devin!);
  assert.equal(team.roles.lead!.harness.id, "devin");
  assert.equal(team.roles.lead!.model!.id, "swe");
  assert.equal(team.roles.lead!.thinking, undefined);
});
