import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { can, harnessProblems, loadKit, roleNamed, roleThatCan, rolesThatCan, toolsOf, watcherProblems } from "../../server/catalog/kit.ts";
import { renderPrompt } from "../../server/catalog/content.ts";
import { tempDir } from "../tempdir.ts";

const good = () => ({
  id: "acme",
  label: "Acme CLI",
  baseProvider: "acp",
  configDirEnv: "ACME_CONFIG_DIR",
  profileRoot: "HOME/.acme/seats",
  skillsDir: "skills",
  settings: { file: "config.json", source: "settings.json", roleSource: "settings/ROLE.settings.json" },
  mcp: { file: "mcp.json", delivery: "file", transports: ["stdio"], key: "mcpServers" },
  modes: [{ id: "ask", label: "Ask" }, { id: "bypass", label: "Bypass" }],
  provider: { command: ["KIT/bin/seat-room", "acp"], profileModeId: "bypass" },
});

test("a harness that fills the contract has nothing to report", () => {
  assert.deepEqual(harnessProblems("acme", good()), []);
});

test("a harness is refused for a field no contract knows, a missing one, or an id that isn't its directory", () => {
  assert.deepEqual(harnessProblems("acme", { ...good(), skillDir: "skills" }), ["names skillDir, which is no harness field"]);
  const { label, ...noLabel } = good();
  assert.deepEqual(harnessProblems("acme", noLabel), ["has no label"]);
  assert.deepEqual(harnessProblems("other", good()), ["calls itself acme but sits in harness/other"]);
});

test("the way a harness takes its prompt and its servers is checked, not assumed", () => {
  assert.deepEqual(harnessProblems("acme", { ...good(), systemPrompt: "stdin" }), ["takes its prompt as stdin, which is neither config nor file"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), systemPrompt: "file" }), ["takes its prompt as a file but names no promptFile"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), mcp: { file: "mcp.json", delivery: "file", transports: ["stdio"] } }), ["delivers MCP servers in a file but names no mcp.key"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), settings: { file: "config.json", source: "settings.json" } }), ["has no settings.roleSource"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), projectContextOption: ["additionalDirectories"] }), ["gives projectContextOption without an option path"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), projectContextOption: "" }), ["gives projectContextOption without an option path"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), projectContextOption: "additionalDirectories" }), []);
});

test("an acp harness declares the modes Paseo would otherwise launch it unconfigured to learn, and opens seats in one of them", () => {
  const { modes, ...modeless } = good();
  assert.deepEqual(harnessProblems("acme", modeless), ["extends acp but lists no modes for Paseo to read without launching it"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), modes: [] }), ["extends acp but lists no modes for Paseo to read without launching it"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), modes: [{ id: "ask" }] }), ["lists modes without an id and a label each"]);
  assert.deepEqual(harnessProblems("acme", { ...good(), modes: [{ id: "ask", label: "Ask" }] }), ["opens seats in mode bypass, which its modes do not list"]);
  assert.deepEqual(harnessProblems("acme", { ...modeless, baseProvider: "claude" }), []);
});

test("a role follows one other role that chooses for itself, and takes its defaults", () => {
  const dir = tempDir("sw2-kit-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  const peer = { role: "peer", label: "Peer", defaults: { harness: "acme", model: "m" }, prompt: "prompts/PEER.md", skills: null };
  const roles = (...more: object[]) => writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [peer, ...more] }));
  const follower = (extra: object = {}) => ({ role: "watcher", label: "Watcher", follows: "peer", prompt: "prompts/WATCHER.md", skills: null, ...extra });

  roles(follower());
  assert.deepEqual(roleNamed(loadKit(dir), "watcher")!.defaults, { harness: "acme", model: "m" });
  roles(follower({ defaults: { harness: "acme" } }));
  assert.throws(() => loadKit(dir), /role watcher follows peer and names defaults of its own/);
  roles(follower({ follows: "nobody" }));
  assert.throws(() => loadKit(dir), /role watcher follows nobody, which is no other role/);
  roles(follower({ follows: "watcher" }));
  assert.throws(() => loadKit(dir), /role watcher follows watcher, which is no other role/);
  roles(follower(), { ...follower(), role: "echo", follows: "watcher" });
  assert.throws(() => loadKit(dir), /role echo follows watcher, which follows peer in turn/);
});

test("what a Watcher may raise and judge is refused when it is not something the desk can act on", () => {
  const kind = { level: "attend", label: "Worked on something it was not asked for", means: "Its steps left the goal." };
  assert.deepEqual(watcherProblems({ judges: ["stuck"], kinds: { goal_drift: kind } }), []);
  assert.deepEqual(watcherProblems({ judges: ["destructive"], kinds: { goal_drift: kind } }), ["judges something that is not an attention-level fact the code raises"], "an irreversible act never waits for anyone");
  assert.deepEqual(watcherProblems({ judges: ["vibes"], kinds: { goal_drift: kind } }), ["judges something that is not an attention-level fact the code raises"]);
  assert.deepEqual(watcherProblems({ judges: [], kinds: {} }), ["may raise no kind"]);
  assert.deepEqual(watcherProblems({ judges: [], kinds: { "Goal-Drift": kind } }), ["names a kind Goal-Drift, which is not lowercase words joined by _"]);
  assert.deepEqual(watcherProblems({ judges: [], kinds: { stuck: kind } }), ["names a kind stuck, which is a fact the code raises"], "it would be the code's own incident, waiting on its own judgement");
  assert.deepEqual(watcherProblems({ judges: [], kinds: { goal_drift: { ...kind, level: "loud" } } }), ["raises goal_drift at a level that is neither page nor attend"]);
  assert.deepEqual(watcherProblems({ judges: [], kinds: { goal_drift: { level: "attend", label: "x" } } }), ["raises goal_drift with no means"]);
  assert.deepEqual(watcherProblems({ judges: [], kinds: { goal_drift: { ...kind, threshold: 0.5 } }, extra: 1 }), ["has extra, which the Watcher does not take", "raises goal_drift with threshold, which a kind does not take"]);
});

test("loading a kit refuses a harness that breaks the contract, naming the field", () => {
  const dir = tempDir("sw2-kit-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [{ role: "peer", label: "Peer", defaults: { harness: "acme" }, prompt: "prompts/PEER.md", skills: null }] }));
  const write = (harness: Record<string, unknown>) => writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(harness));

  write({ ...good(), skillDir: "skills" });
  assert.throws(() => loadKit(dir), /harness acme names skillDir, which is no harness field/);

  write(good());
  assert.deepEqual(Object.keys(loadKit(dir).harnesses), ["acme"]);
});

test("the shipped harnesses satisfy their own contract", async () => {
  const { loadKit } = await import("../../server/catalog/kit.ts");
  const kit = loadKit(new URL("../..", import.meta.url).pathname);
  for (const [id, harness] of Object.entries(kit.harnesses)) assert.deepEqual(harnessProblems(id, harness as unknown as Record<string, unknown>), [], `harness ${id}`);
});

test("several seats can supervise one project, each for its own concern, declared as data", () => {
  const dir = tempDir("sw2-concerns-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ supervisor: [{ name: "open_lane" }, { name: "answer" }], lead: [{ name: "report" }] }));

  const role = (name: string, can: string[], tools: string, concern?: string) => {
    writeFileSync(join(dir, "harness", "acme", "settings", `${name}.settings.json`), "{}");
    return { role: name, label: name, can, tools, ...(concern ? { concern } : {}), defaults: { harness: "acme" }, prompt: `prompts/${name}.md`, skills: null };
  };
  writeFileSync(
    join(dir, "roles.json"),
    JSON.stringify({
      providerPrefix: "sw2-",
      roles: [
        role("architecture", ["supervise"], "supervisor", "architecture"),
        role("safety", ["supervise"], "supervisor", "safety"),
        role("lead", ["lead"], "lead"),
      ],
    }),
  );

  const kit = loadKit(dir);
  const supervising = rolesThatCan(kit, "supervise");
  assert.deepEqual(
    supervising.map((entry) => [entry.role, entry.concern]),
    [
      ["architecture", "architecture"],
      ["safety", "safety"],
    ],
    "a project is not limited to one supervising seat, and each carries what it specialises in",
  );
  // Two roles share one tool set, so a specialisation costs no second copy of the tools.
  assert.deepEqual(toolsOf(kit, supervising[0]), ["open_lane", "answer"]);
  assert.deepEqual(toolsOf(kit, supervising[1]), ["open_lane", "answer"]);
  assert.deepEqual(toolsOf(kit, roleThatCan(kit, "lead")), ["report"]);
  assert.equal(can(supervising[0], "lead"), false);
  assert.equal(toolsOf(kit, rolesThatCan(kit, "watch")[0]).length, 0, "a kit that declares no watching seat simply has none");
});

test("a roles file of one's own replaces the kit's preset, and may name its files anywhere", () => {
  const dir = tempDir("sw2-preset-kit-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings", "lead.settings.json"), "{}");
  writeFileSync(join(dir, "harness", "acme", "settings", "driver.settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ lead: [{ name: "report" }] }));
  const shipped = { role: "lead", label: "Lead", can: ["lead"], tools: "lead", defaults: { harness: "acme" }, prompt: "prompts/LEAD.md", skills: null };
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ providerPrefix: "sw2-", roles: [shipped] }));
  assert.deepEqual(loadKit(dir).roles.map((role) => role.role), ["lead"], "with nothing of the owner's, the kit runs what it ships");

  // Somebody who wants a different arrangement writes one beside their own prompts, without forking the package.
  const mine = tempDir("sw2-preset-mine-");
  const ownPrompt = join(mine, "DRIVER.md");
  writeFileSync(ownPrompt, "# Driver\n\nYou drive.\n");
  writeFileSync(
    join(mine, "roles.json"),
    JSON.stringify({ providerPrefix: "sw2-", roles: [{ role: "driver", label: "Driver", can: ["lead"], tools: "lead", defaults: { harness: "acme" }, prompt: ownPrompt, skills: null }] }),
  );

  const kit = loadKit(dir, mine);
  assert.deepEqual(kit.roles.map((role) => role.role), ["driver"], "and that arrangement is the one that runs");
  assert.match(renderPrompt(kit, kit.roles[0]!, { guides: "/g", state: "/s" }), /You drive\./, "its prompt is read from where it says, not from inside the package");
});

test("a capability several roles hold can name which of them, and a stored name is asked what it can do", () => {
  const dir = tempDir("sw2-several-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ lead: [{ name: "report" }], reviewer: [{ name: "done" }] }));
  const role = (name: string, can: string[], tools: string) => {
    writeFileSync(join(dir, "harness", "acme", "settings", `${name}.settings.json`), "{}");
    return { role: name, label: name, can, tools, defaults: { harness: "acme" }, prompt: `prompts/${name}.md`, skills: null };
  };
  writeFileSync(
    join(dir, "roles.json"),
    JSON.stringify({
      providerPrefix: "sw2-",
      roles: [role("careful", ["review"], "reviewer"), role("adversary", ["review"], "reviewer"), role("lead", ["lead"], "lead"), role("arch-lead", ["lead"], "lead")],
    }),
  );
  const kit = loadKit(dir);

  // Two lenses are only evidence if they are not one reader twice, so the caller may say which.
  assert.equal(roleThatCan(kit, "review")?.role, "careful", "unnamed, the preset's first");
  assert.equal(roleThatCan(kit, "review", "adversary")?.role, "adversary", "named, the one asked for");
  assert.equal(roleThatCan(kit, "review", "lead"), undefined, "a role that cannot do it is not a stand-in for one that can");
  assert.equal(roleThatCan(kit, "review", "nobody"), undefined);

  // What the patrol asks of an ask's stored role. A name comparison called only the role literally
  // called "lead" a lead, so a second lead-capable role had its asks escalated over its own head.
  assert.equal(can(roleNamed(kit, "arch-lead"), "lead"), true);
  assert.equal(can(roleNamed(kit, "careful"), "lead"), false, "and a reviewer still has someone above it");
  assert.equal(can(roleNamed(kit, "a role this kit lost"), "lead"), false, "a name the kit no longer has can do nothing, so its ask still escalates");
});
