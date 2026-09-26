// First, so this file has a HOME of its own even run alone: what it writes under HOME would otherwise land in the owner's.
import "../setup.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderPrompt, skillProblems, skillSources } from "../../server/catalog/kit/content.ts";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { providerId, toolsOf } from "../../server/catalog/kit/roles.ts";
import { applyRole } from "../../server/catalog/seat/launch.ts";
import { applyReconcile, seatPairs } from "../../server/catalog/paseo/providers.ts";
import { seedRecords } from "../../server/catalog/seat/seat-files.ts";
import { materialize, seatDir } from "../../server/catalog/seat/seats.ts";
import { placeGuides } from "../../server/catalog/seat/snapshots.ts";
import { choicesFor, serversFor } from "../../server/catalog/seat/servers.ts";
import { resolveTeam, withHarness } from "../../server/catalog/team/team.ts";
import { readConfig } from "../../server/core/config-file.ts";
import { git } from "../../server/core/git.ts";
import { guidesDir, paseoConfigPath } from "../../server/core/paths.ts";
import type { AgentConfig } from "../../server/core/ports.ts";
import { realProbes } from "../../server/runtime/panel/doctor.ts";
import { tempDir } from "../tempdir.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const project = { root: "/work/demo", slug: "demo-000000", state: "/state/demo" };
const context = { node: "/bin/node", socket: "/desk.sock" };
const allOn = (kit: ReturnType<typeof loadKit>) => ({
  mcp: Object.fromEntries(Object.keys(kit.mcp).map((id) => [id, { enabled: true }])),
});
const installed = (harness: ReturnType<typeof loadKit>["harnesses"][string]) =>
  !harness.modelCatalog || realProbes.has(harness.modelCatalog.command[0]!);

test("the shipped kit resolves to a complete team, and every role's seat builds with no hidden word or placeholder in it", () => {
  const kit = loadKit(PLUGIN);
  const off = resolveTeam(kit);
  assert.deepEqual(off.errors, []);
  assert.deepEqual(
    Object.values(off.mcp).filter((state) => state.enabled),
    [],
    "the kit ships no server switched on",
  );
  const team = resolveTeam(kit, allOn(kit));
  assert.deepEqual(team.errors, []);
  const names = (pairs: { role: { role: string }; harness: { id: string } }[]) =>
    pairs.map((pair) => `${pair.role.role}-${pair.harness.id}`).sort();
  assert.deepEqual(
    names(seatPairs(kit)),
    names(kit.roles.flatMap((role) => Object.values(kit.harnesses).map((harness) => ({ role, harness })))),
    "every role can sit on every agent the kit ships",
  );
  const deltas = Object.keys(kit.harnesses).flatMap((id) => {
    const dir = join(PLUGIN, "harness", id, "delta");
    return existsSync(dir) ? readdirSync(dir).map((file) => `${id}/${file}`) : [];
  });
  assert.deepEqual(
    deltas.filter((entry) => !kit.roles.some((role) => entry.endsWith(`/${role.role}.md`))),
    [],
    "every harness delta speaks to a role the kit has",
  );
  const home = tempDir("sw2-real-home-");
  for (const [name, seat] of Object.entries(team.roles)) {
    const { role, harness } = seat;
    materialize(kit, team, name, home, project, serversFor(kit, team, name, context));
    const dir = seatDir(kit, role, harness, home, project);
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${name} skills dir`);
    for (const on of Object.keys(kit.harnesses))
      assert.doesNotMatch(
        renderPrompt(kit, role, on, { guides: "/guides", state: "/state" }),
        /\{\{/,
        `${name} on ${on}`,
      );
    const contextFile = join(dir, harness.contextFile!);
    const told = existsSync(contextFile) ? readFileSync(contextFile, "utf-8") : "";
    assert.doesNotMatch(told, /\{\{/, `${name} seat has no placeholder left`);
    for (const [id, entry] of Object.entries(kit.mcp)) {
      const served = seat.mcp.includes(id);
      if (entry.rule)
        assert.equal(
          told.includes(readFileSync(join(entry.dir, entry.rule), "utf-8").trim()),
          served,
          `${name}: ${id}'s rule`,
        );
      for (const skill of entry.skills ?? [])
        assert.equal(
          existsSync(join(dir, harness.skillsDir, skill, "SKILL.md")),
          served,
          `${name}: ${id}'s skill ${skill}`,
        );
    }
  }
});

test("nothing a seat or its guides lead it to read resolves into a git repository", async () => {
  const kit = loadKit(PLUGIN);
  const home = tempDir("sw2-outside-home-");
  const roots = [guidesDir(home)];
  placeGuides(kit, home);
  for (const { role, harness } of seatPairs(kit)) {
    if (!installed(harness)) continue;
    const team = withHarness(resolveTeam(kit), role.role, harness);
    materialize(kit, team, role.role, home, project);
    roots.push(join(seatDir(kit, role, harness, home, project), harness.skillsDir));
  }
  const inside: string[] = [];
  for (const root of roots) {
    for (const name of readdirSync(root, { recursive: true }).map(String)) {
      const real = realpathSync(join(root, name));
      const dir = statSync(real).isDirectory() ? real : dirname(real);
      if ((await git(dir, ["rev-parse", "--show-toplevel"])).code === 0) inside.push(`${join(root, name)} -> ${real}`);
    }
  }
  assert.deepEqual(
    inside.slice(0, 5),
    [],
    `${inside.length} paths resolve into a repository: an agent loads the AGENTS.md above what it reads, so seats took the plugin's own rules`,
  );
});

test("a Codex seat runs on the model provider the owner's own Codex names, and on Codex's own when it names none", (t) => {
  const kit = loadKit(PLUGIN);
  const pair = seatPairs(kit).find((entry) => entry.harness.id === "codex" && entry.role.role === "lead")!;
  if (!installed(pair.harness)) return t.skip("codex is not installed here");
  const team = withHarness(resolveTeam(kit), "lead", pair.harness);
  const home = tempDir("sw2-codex-home-");
  materialize(kit, team, "lead", home, project);
  const file = join(seatDir(kit, pair.role, pair.harness, home, project), "config.toml");
  type Seat = {
    model_provider?: string;
    model_providers?: Record<string, { base_url?: string }>;
    model?: string;
    approval_policy?: string;
  };
  assert.equal(readConfig<Seat>(file, {}).model_provider, undefined);
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".codex", "config.toml"),
    'model_provider = "ZAI"\nmodel = "glm-5.3"\n\n[model_providers.ZAI]\nname = "Z"\nbase_url = "https://example.invalid"\nexperimental_bearer_token = "fake"\n',
  );
  materialize(kit, team, "lead", home, project);
  const seat = readConfig<Seat>(file, {});
  assert.equal(seat.model_provider, "ZAI");
  assert.equal(seat.model_providers?.ZAI?.base_url, "https://example.invalid");
  assert.equal(seat.model, undefined, "the model is the role's, set at launch, not the owner's default");
  assert.equal(seat.approval_policy, "never", "and the kit's own settings still hold");
});

test("a Codex seat has every desk and proxy tool it is given approved ahead, and other agents get no such list", () => {
  const kit = loadKit(PLUGIN);
  const all = resolveTeam(kit, allOn(kit));
  const codex = withHarness(all, "lead", kit.harnesses.codex!);
  const servers = serversFor(kit, codex, "lead", context) as Record<string, { args?: string[] } | undefined>;
  const config: AgentConfig = { provider: providerId(kit, "lead", "codex"), cwd: "/work/repo" };
  const next = applyRole(kit, codex, config, () => "PROMPT", "/state/demo", servers);
  const approved = new Set(next.toolPolicy?.preapproved.map((ref) => `${ref.server}.${ref.tool}`));
  const lead = kit.roles.find((role) => role.role === "lead")!;
  for (const tool of toolsOf(kit, lead))
    assert.ok(approved.has(`team.${tool}`), `team.${tool}: Codex refuses an MCP call not approved ahead`);
  const proxies = Object.keys(servers).filter(
    (id) => id !== "team" && String(servers[id]?.args?.[0]).endsWith("code.mjs"),
  );
  assert.ok(proxies.length > 0, "the shipped kit gives the Lead at least one proxied server");
  for (const id of proxies)
    assert.ok(
      [...approved].some((name) => name.startsWith(`${id}.`)),
      id,
    );
  assert.deepEqual(
    [...approved].filter((name) => name.startsWith("paseo.")),
    [],
    "the Lead is allowed none of Paseo's tools",
  );
  const own = {
    ...kit,
    roles: kit.roles.map((role) =>
      role.role === "supervisor" ? { ...role, paseoTools: { allow: ["list_schedules"] } } : role,
    ),
  };
  const supervisor = withHarness(resolveTeam(own), "supervisor", kit.harnesses.codex!);
  const asked: AgentConfig = { provider: providerId(own, "supervisor", "codex"), cwd: "/work/repo" };
  const supervising = applyRole(
    own,
    supervisor,
    asked,
    () => "PROMPT",
    "/state/demo",
    serversFor(own, supervisor, "supervisor", context),
  );
  assert.deepEqual(
    supervising.toolPolicy?.preapproved.filter((ref) => ref.server === "paseo").map((ref) => ref.tool),
    ["list_schedules"],
    "a roles file of one's own may give a seat some of Paseo's tools, which Paseo adds at launch",
  );
  const claude = applyRole(
    kit,
    all,
    { provider: providerId(kit, "lead", "claude"), cwd: "/work/repo" },
    () => "PROMPT",
    "/state/demo",
    serversFor(kit, all, "lead", context),
  );
  assert.equal(claude.toolPolicy, undefined);
});

test("each shipped role writes under the project's state only what its prompt, deltas or skills name, or its note pages", () => {
  const kit = loadKit(PLUGIN);
  const paths = { guides: "/guides", state: "/state/demo" };
  for (const role of kit.roles) {
    const pages = toolsOf(kit, role).includes("note");
    for (const entry of (role.writes ?? []).filter((path) => !(pages && path.endsWith("/")))) {
      const without = { ...role, writes: role.writes!.filter((path) => path !== entry) };
      const prompts = Object.keys(kit.harnesses).some((harness) => {
        try {
          renderPrompt(kit, without, harness, paths);
          return false;
        } catch {
          return true;
        }
      });
      const skills = [...skillSources(kit, without)].some(
        ([name, dir]) => skillProblems(without, name, dir).length > 0,
      );
      assert.ok(prompts || skills, `${role.role} writes ${entry}, which nothing it reads names`);
    }
  }
});

test("a Claude seat reads the project's own CLAUDE.md, or its AGENTS.md where it has none, though its settings come from its seat alone", () => {
  const kit = loadKit(PLUGIN);
  const team = resolveTeam(kit);
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), "{}\n");
  applyReconcile(kit, team);
  type Written = { agents?: { providers?: Record<string, { env?: Record<string, string> }> } };
  const providers = readConfig<Written>(paseoConfigPath(), {}).agents?.providers ?? {};
  const pairs = seatPairs(kit).filter((pair) => pair.harness.id === "claude");
  assert.equal(pairs.length, kit.roles.length);
  for (const { role } of pairs) {
    const id = providerId(kit, role.role, "claude");
    assert.equal(
      providers[id]?.env?.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD,
      "1",
      `${role.role}: Claude reads CLAUDE.md from an added directory only with this set`,
    );
    assert.equal(
      providers[id]?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR,
      "",
      `${role.role}: the seat reads the login the owner made`,
    );
    const next = applyRole(kit, team, { provider: id, cwd: "/work/repo" }, () => "PROMPT", "/state/demo");
    assert.deepEqual(
      next.providerOptions?.additionalDirectories,
      ["/work/repo"],
      `${role.role}: the seat's own directory is the one added`,
    );
  }
  const root = tempDir("sw2-agents-only-");
  writeFileSync(join(root, "AGENTS.md"), "Use pnpm.\n");
  const home = tempDir("sw2-agents-home-");
  const own = { root, slug: "demo-000000", state: join(root, ".state") };
  const peer = pairs.find((pair) => pair.role.role === "peer")!;
  materialize(kit, team, "peer", home, own);
  assert.match(
    readFileSync(join(seatDir(kit, peer.role, peer.harness, home, own), "CLAUDE.md"), "utf-8"),
    new RegExp(`^@${join(root, "AGENTS.md")}$`, "m"),
    "Claude never reads AGENTS.md from an added directory, so the seat's own rules take it in",
  );
});

test("project records are seeded once and never overwritten", () => {
  const kit = loadKit(PLUGIN);
  const state = tempDir("sw2-state-");
  assert.ok(seedRecords(kit, state).includes("notebook.md"));
  writeFileSync(join(state, "notebook.md"), "The owner's own notes.\n");
  assert.deepEqual(seedRecords(kit, state), []);
  assert.equal(
    readFileSync(join(state, "notebook.md"), "utf-8"),
    "The owner's own notes.\n",
    "what the owner wrote there stays",
  );
});

test("a pasted server that names no roles is given to every role that works with tools but a judge, which has one only where it is named", () => {
  const kit = loadKit(PLUGIN);
  const pasted = { enabled: true, label: "Pasted", connect: { type: "http" as const, url: "https://mcp.example.com" } };
  const given = (team: ReturnType<typeof resolveTeam>) =>
    Object.entries(team.roles)
      .filter(([, seat]) => seat.mcp.includes("pasted"))
      .map(([name]) => name)
      .sort();
  const team = resolveTeam(kit, { mcp: { pasted } });
  assert.deepEqual(team.errors, []);
  assert.deepEqual(given(team), ["backup-peer", "lead", "peer", "reviewer", "senior-reviewer", "supervisor"]);
  assert.deepEqual(given(resolveTeam(kit, { mcp: { pasted: { ...pasted, roles: ["watcher"] } } })), ["watcher"]);
});

test("the desk names each seat's fixed choices from the kit: who writes and with which skills, who reviews, who leads, where its pages go", () => {
  const kit = loadKit(PLUGIN);
  const team = resolveTeam(kit);
  const choices = (role: string) => choicesFor(kit, team, role);
  const skills = readdirSync(join(PLUGIN, "content", "skills", "peer")).sort();
  assert.deepEqual(choices("lead"), {
    add_tasks: { role: ["peer", "backup-peer"], skills },
    start_review: { role: ["reviewer", "senior-reviewer"] },
    note: { kind: ["plans", "council", "ultra-review", "repo-refresh"] },
  });
  assert.deepEqual(choices("supervisor"), { open_lane: { role: ["lead"] } });
  assert.deepEqual(choices("peer"), {}, "a seat is named choices only for tools it has");
});
