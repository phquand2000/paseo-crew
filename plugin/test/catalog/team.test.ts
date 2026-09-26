import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serversFor } from "../../server/catalog/servers.ts";
import { resolveTeam, rulesFor, servingProject, skillDirsFor, withHarness } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const kit = makeKit();
const context = { node: "/bin/node", spool: "/spool" };

test("with no settings every role gets its catalog defaults and the MCP servers enabled by default", () => {
  const team = resolveTeam(kit);
  assert.deepEqual(team.errors, []);
  assert.equal(team.roles.supervisor!.harness.id, "claude");
  assert.equal(team.roles.supervisor!.model!.id, "opus");
  assert.equal(team.roles.supervisor!.thinking, "high");
  assert.equal(team.roles.peer!.harness.id, "omp");
  assert.equal(team.roles.peer!.thinking, undefined);
  assert.deepEqual(team.roles.lead!.mcp, ["ide"]);
  assert.deepEqual(team.roles.supervisor!.mcp, []);
  assert.deepEqual(team.roles.scribe!.mcp, []);
  assert.equal(team.mcp.docs!.enabled, false);
  assert.equal(team.attention.leadIdleMinutes, 15);
});

test("the project layer overrides the machine layer, and switching harness drops the other harness's model", () => {
  const machine = { mcp: { docs: { enabled: true }, ide: { settings: { port: 1234 } } }, rules: "Write tests first." };
  const project = { roles: { lead: { harness: "omp" } }, mcp: { ide: { roles: ["peer"] } }, rules: "Use pnpm." };
  const team = resolveTeam(kit, machine, project);
  assert.deepEqual(team.errors, []);
  const lead = team.roles.lead!;
  assert.equal(lead.harness.id, "omp");
  assert.equal(lead.model!.id, "glm");
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
    { roles: { supervisor: { harness: "omp" }, peer: { thinking: "high" } }, mcp: { docs: { roles: ["scribe"] } } },
  );
  const text = team.errors.join("\n");
  assert.match(text, /unknown role scout/);
  assert.match(text, /The MCP server nope has nothing to connect to/);
  assert.match(text, /IDE setting port must be a number/);
  assert.match(text, /IDE has no setting named host/);
  assert.match(text, /Oh My Pi has no supervisor settings/);
  assert.match(text, /Docs can't be given to the scribe role/);
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

test("a project tunes what is worth its owner's attention, over the machine's default", () => {
  const team = resolveTeam(kit, { attention: { longTurnMinutes: 45, incidentsPerLane: 8 } }, { attention: { incidentsPerLane: 2, watch: true } });
  assert.deepEqual(team.errors, []);
  assert.equal(team.attention.longTurnMinutes, 45, "what the project says nothing about it takes from the machine");
  assert.equal(team.attention.incidentsPerLane, 2, "and what it does say wins");
  assert.equal(team.attention.watch, true, "a project can decide incidents are worth sending");
  assert.equal(resolveTeam(kit).attention.watch, false, "left alone, the kit records incidents and sends none until its thresholds are tuned");
});

test("a seat may run a model the harness catalog does not list", () => {
  const team = resolveTeam(kit, { roles: { lead: { model: "gpt-5.6-sol" } } });
  assert.deepEqual(team.errors, [], "the catalog is what the screen offers, not what the owner is allowed");
  assert.equal(team.roles.lead!.model?.id, "gpt-5.6-sol");
});

test("rules gather each enabled server's rule, the role's tools and notes, and the Human's rules", () => {
  const team = resolveTeam(kit, { rules: "Keep diffs small." });
  const peer = rulesFor(team, "peer");
  assert.match(peer, /^# Working rules/);
  assert.match(peer, /Prefer the IDE for navigation\./);
  assert.match(peer, /Your IDE tools: `ide_find_references`, `ide_refactor_rename`\./);
  assert.match(peer, /Check diagnostics before handing back\./);
  assert.match(peer, /## Rules from the Human\n\nKeep diffs small\./);
  const scribe = rulesFor(team, "scribe");
  assert.match(scribe, /## Rules from the Human\n\nKeep diffs small\./);
  assert.doesNotMatch(scribe, /IDE|ide_find_references/);
  assert.equal(rulesFor(resolveTeam(kit), "supervisor"), "");
});

test("a server's skills follow it: on when it is enabled for the role, gone when it is off", () => {
  assert.deepEqual([...skillDirsFor(resolveTeam(kit), "lead").keys()], ["ide-guide"]);
  assert.deepEqual([...skillDirsFor(resolveTeam(kit, { mcp: { ide: { enabled: false } } }), "lead").keys()], []);
});

test("a seat opened on another harness than the settings choose gets that harness's default model", () => {
  const team = withHarness(resolveTeam(kit), "lead", kit.harnesses.omp!);
  assert.equal(team.roles.lead!.harness.id, "omp");
  assert.equal(team.roles.lead!.model!.id, "glm");
  assert.equal(team.roles.lead!.thinking, undefined);
});

test("a role that follows another takes that role's agent, model and thinking in force until it is given its own", () => {
  assert.deepEqual(kit.roles.find((role) => role.role === "scribe")!.defaults, { harness: "omp", model: "glm" }, "and reads as that role's kit defaults to anything asking the kit");
  const seatOf = (team: ReturnType<typeof resolveTeam>) => [team.roles.scribe!.harness.id, team.roles.scribe!.model?.id, team.roles.scribe!.thinking];
  assert.deepEqual(seatOf(resolveTeam(kit)), ["omp", "glm", undefined]);
  const machine = { roles: { peer: { harness: "claude", model: "opus", thinking: "medium" } } };
  assert.deepEqual(seatOf(resolveTeam(kit, machine)), ["claude", "opus", "medium"], "the Peer's own settings, not only the kit's");
  assert.deepEqual(seatOf(resolveTeam(kit, machine, { roles: { scribe: { model: "haiku" } } })), ["claude", "haiku", undefined], "a model of its own on the agent it followed to");
  assert.deepEqual(seatOf(resolveTeam(kit, machine, { roles: { scribe: { harness: "omp" } } })), ["omp", "glm", undefined], "an agent of its own drops what it followed");
  const away = { roles: { ...machine.roles, scribe: { harness: "omp" } } };
  assert.deepEqual(seatOf(resolveTeam(kit, away, { roles: { scribe: { harness: "claude" } } })), ["claude", "opus", "medium"], "and coming back to the followed role's agent brings back what it chose there");
  assert.deepEqual(resolveTeam(kit, machine).errors.filter((error) => /scribe/i.test(error)), [], "and it can run wherever it follows to");
});

test("a Paseo tool the kit does not know is reported, because allowing one denies all the others", () => {
  const typo = resolveTeam({ ...kit, roles: kit.roles.map((role) => (role.role === "lead" ? { ...role, paseoTools: { allow: ["get_agent_activty"] } } : role)) });
  assert.match(typo.errors.join("\n"), /allowed Paseo tools this kit does not know: get_agent_activty/);
  assert.match(typo.errors.join("\n"), /denies the Lead every Paseo tool rather than granting it one/);

  const fine = resolveTeam({ ...kit, roles: kit.roles.map((role) => (role.role === "lead" ? { ...role, paseoTools: { allow: ["get_agent_activity"] } } : role)) });
  assert.deepEqual(fine.errors, []);
});

test("a seat pointed at a tool set the kit does not have is reported, not seated mute", () => {
  // A preset outside the package names tool sets that still come from the package.
  const wrong = resolveTeam({ ...kit, roles: kit.roles.map((role) => (role.role === "peer" ? { ...role, tools: "worker" } : role)) });
  assert.match(wrong.errors.join("\n"), /Peer is given the tool set worker, which this kit does not have/);
  assert.deepEqual(resolveTeam(kit).errors, []);
});

test("putting a role back on its own harness brings back what the kit chose for it there", () => {
  const team = resolveTeam(kit, { roles: { supervisor: { harness: "omp" } } }, { roles: { supervisor: { harness: "claude" } } });
  assert.deepEqual(team.errors, []);
  assert.deepEqual([team.roles.supervisor!.model!.id, team.roles.supervisor!.thinking], ["opus", "high"]);
  assert.equal(withHarness(resolveTeam(kit, { roles: { supervisor: { harness: "omp" } } }), "supervisor", kit.harnesses.claude!).roles.supervisor!.thinking, "high");
});

test("a model outside the catalog keeps the thinking the owner chose for it", () => {
  const team = resolveTeam(kit, { roles: { supervisor: { model: "opus-next", thinking: "max" } } });
  assert.deepEqual(team.errors, []);
  assert.equal(team.roles.supervisor!.model!.id, "opus-next", "the catalog is not a fence");
  assert.equal(team.roles.supervisor!.thinking, "max", "and a model it does not list is not one with no thinking");
});

test("a harness with no models and none chosen is refused where the owner can see it", () => {
  const bare = {
    ...kit,
    harnesses: { ...kit.harnesses, omp: { ...kit.harnesses.omp!, models: undefined } },
    roles: kit.roles.map((role) => (role.role === "peer" ? { ...role, defaults: { harness: "omp" } } : role)),
  };
  // Paseo starts an agent only as provider/model, so a bare provider failed later at every open_lane.
  const team = resolveTeam(bare as typeof kit);
  assert.ok(team.errors.some((error) => /listed no models for .* yet and none is chosen for the Peer/.test(error)), team.errors.join("\n"));
  assert.deepEqual(resolveTeam(bare as typeof kit, { roles: { peer: { model: "glm-6" } } }).errors, [], "and choosing one is enough");
});

test("a server that needs something the project lacks is left off its seats, with everything that tells them to use it", () => {
  // The IDE index was once given to seats of a project the IDE had never opened, and every call failed.
  const kit = makeKit();
  const team = resolveTeam(kit, { mcp: { docs: { enabled: true } } });
  const bare = tempDir("sw2-bare-");
  const served = servingProject(team, bare);
  assert.deepEqual(served.roles.peer!.mcp, ["docs"]);
  assert.equal(served.mcp.ide!.enabled, false, "and the desk does not open the project in it either");
  assert.doesNotMatch(rulesFor(served, "peer"), /IDE|diagnostics/);
  assert.equal(skillDirsFor(served, "peer").has("ide-guide"), false);
  assert.equal(serversFor(kit, served, "peer", { node: "node", spool: "/s" }).ide, undefined);

  const opened = tempDir("sw2-idea-");
  mkdirSync(join(opened, ".idea"));
  assert.deepEqual(servingProject(team, opened).roles.peer!.mcp, ["ide", "docs"]);
});

test("a pasted MCP server under the name of the team's own server or Paseo's is left out and reported, since it would replace that server for every seat", () => {
  const connect = { type: "http", url: "http://example.invalid/mcp" } as const;
  const team = resolveTeam(kit, {}, { mcp: { team: { connect }, paseo: { connect }, team_x: { connect } } });
  const text = team.errors.join("\n");
  assert.match(text, /The MCP server team has the name of a server every seat already has/);
  assert.match(text, /The MCP server paseo has the name of a server every seat already has/);
  assert.deepEqual(Object.keys(team.mcp).filter((id) => id.startsWith("team") || id === "paseo"), ["team_x"]);
  const servers = serversFor(kit, team, "peer", context) as Record<string, any>;
  assert.notEqual(servers.team.url, connect.url, "the Peer keeps the team's own server");
});
