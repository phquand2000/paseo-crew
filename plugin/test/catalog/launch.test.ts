import assert from "node:assert/strict";
import { delimiter, join, matchesGlob } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit, providerId } from "../../server/catalog/kit.ts";
import { applyRole, seatEnv } from "../../server/catalog/launch.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { readConfig } from "../../server/core/config-file.ts";
import { DESK_OWNED, stateRoot } from "../../server/core/paths.ts";
import type { AgentConfig } from "../../server/core/ports.ts";
import { BACKUP } from "../../server/upkeep/migrate.ts";
import type { Layer } from "../../shared/settings.ts";
import { makeKit } from "../kit.ts";

const PLUGIN = fileURLToPath(new URL("../..", import.meta.url));
const kit = makeKit();
const team = resolveTeam(kit);
const render = () => "ROLE PROMPT";

/** The value at a dotted path of a seat's provider options. */
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
      value,
    );
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const onOmp: Layer = { roles: { lead: { harness: "omp", model: "glm" } } };
const LAUNCHED: [string, Layer, Omit<AgentConfig, "cwd">, [string, string, string, string]][] = [
  [
    "a Lead asked for a model its agent does not list gets the one its settings choose, with its agent's mode",
    {},
    { provider: "sw2-lead-claude", model: "made-up", modeId: "default" },
    ["opus", "bypassPermissions", "medium", "ROLE PROMPT"],
  ],
  [
    "and the thinking its settings choose",
    { roles: { lead: { thinking: "high" } } },
    { provider: "sw2-lead-claude", model: "made-up" },
    ["opus", "bypassPermissions", "high", "ROLE PROMPT"],
  ],
  [
    "a valid model and thinking option are kept, and a caller's prompt comes after the role's",
    {},
    { provider: "sw2-supervisor-claude/opus", model: "opus", thinkingOptionId: "medium", systemPrompt: "extra" },
    ["opus", "bypassPermissions", "medium", "ROLE PROMPT\n\nextra"],
  ],
  [
    "a model that lists no thinking options is given none",
    {},
    { provider: "sw2-peer-omp", thinkingOptionId: "high" },
    ["glm", "full", "none", "ROLE PROMPT"],
  ],
  [
    "a Lead opened on another agent takes that agent's model, whatever the settings choose",
    {},
    { provider: "sw2-lead-omp", model: "opus" },
    ["glm", "full", "none", "ROLE PROMPT"],
  ],
  [
    "on the agent the settings put a role on, the model they choose",
    onOmp,
    { provider: "sw2-lead-omp" },
    ["glm", "full", "none", "ROLE PROMPT"],
  ],
  [
    "and on its own agent, the kit's model and thinking there",
    onOmp,
    { provider: "sw2-lead-claude" },
    ["opus", "bypassPermissions", "medium", "ROLE PROMPT"],
  ],
  [
    "and a model its own agent lists is kept",
    onOmp,
    { provider: "sw2-lead-claude", model: "haiku" },
    ["haiku", "bypassPermissions", "none", "ROLE PROMPT"],
  ],
];

test("a seat is created on the model, mode, thinking and prompt its role and agent call for, and a provider outside the kit is left untouched", () => {
  for (const [what, layer, asked, chosen] of LAUNCHED) {
    const next = applyRole(kit, resolveTeam(kit, layer), { ...asked, cwd: "/repo" }, render);
    assert.deepEqual([next.model, next.modeId, next.thinkingOptionId ?? "none", next.systemPrompt], chosen, what);
  }
  const outside = { provider: "claude", cwd: "/repo", model: "x" };
  assert.equal(applyRole(kit, team, outside, render), outside);
  const bare = { provider: "sw2-lead", cwd: "/repo" };
  assert.equal(applyRole(kit, team, bare, render), bare, "a prefixed id naming no agent is no seat");
});

test("a seat is handed its servers where its agent takes them at launch, its own working directory once and a state grant of only what its role writes, and an agent that takes none of these is handed nothing", () => {
  const servers = { team: { type: "stdio", command: "node", args: ["team.mjs", "lead", "/spool"] } };
  const config: AgentConfig = {
    provider: "sw2-lead-claude",
    cwd: "/repo",
    mcpServers: { other: { type: "stdio", command: "x" } },
    providerOptions: {
      additionalDirectories: ["/elsewhere"],
      settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } },
    },
  };
  const lead = applyRole(kit, team, config, render, "/state/repo", servers);
  assert.deepEqual(
    Object.keys(lead.mcpServers ?? {}).sort(),
    ["other", "team"],
    "the caller's servers stay beside the seat's",
  );
  assert.deepEqual(at(lead.providerOptions, "additionalDirectories"), ["/elsewhere", "/repo"]);
  assert.deepEqual(at(lead.providerOptions, "settings.sandbox.filesystem.allowWrite"), ["/tmp", "/state/repo/plans"]);
  const again = applyRole(
    kit,
    team,
    { ...config, providerOptions: lead.providerOptions },
    render,
    "/state/repo",
    servers,
  );
  assert.deepEqual(
    [
      at(again.providerOptions, "additionalDirectories"),
      at(again.providerOptions, "settings.sandbox.filesystem.allowWrite"),
    ],
    [
      ["/elsewhere", "/repo"],
      ["/tmp", "/state/repo/plans"],
    ],
    "a seat opened again is not handed either twice",
  );
  const peer = applyRole(kit, team, { provider: "sw2-peer-omp", cwd: "/repo" }, render, "/state/repo", servers);
  assert.deepEqual(
    [peer.mcpServers, peer.providerOptions],
    [undefined, undefined],
    "an agent that reads its servers from a file and the project on its own, and takes no write list, is handed nothing",
  );

  const real = loadKit(PLUGIN);
  const shipped = resolveTeam(real);
  const granted = (role: string) =>
    strings(
      at(
        applyRole(real, shipped, { provider: providerId(real, role, "claude"), cwd: "/repo" }, render, "/state/repo")
          .providerOptions,
        "settings.sandbox.filesystem.allowWrite",
      ),
    );
  assert.ok(
    granted("lead").includes("/state/repo/ultra-review"),
    "the ultra-review scripts write their reports from the Lead's shell",
  );
  assert.ok(
    granted("supervisor").includes("/state/repo/CONTEXT.md"),
    "the Supervisor writes the project's concept as the Human settles it",
  );
  assert.ok(
    !granted("supervisor").includes("/state/repo/checkpoints.log"),
    "a record a skill reads is not one it writes",
  );
  assert.deepEqual(granted("peer"), [], "and a role that declares no writes is granted none");
});

test("a Claude seat's file tools are kept off what the desk owns and what sets up the machine's agents and the plugin, and its reads off every key and login", () => {
  const real = loadKit(PLUGIN);
  const deny =
    readConfig<{ permissions?: { deny?: string[] } }>(join(PLUGIN, "harness", "claude", "settings.json"), {})
      .permissions?.deny ?? [];
  const denied = (tool: string, path: string) =>
    deny.some((rule) => rule.startsWith(`${tool}(`) && matchesGlob(path, rule.slice(tool.length + 1, -1)));
  const machine = stateRoot("~");
  const project = `${machine}/projects/shop-1a2b`;
  const home = (path: string) => path.replace(/^HOME/, "~");
  const backup = "settings.json.bak-20260925-120000";
  assert.ok(BACKUP.test(backup), "named as Migrate names a backup");

  const kept: [string, "Edit" | "Read", string[]][] = [
    [
      "the desk's own record, a rolled log too: the sandbox binds the shell only, and a file tool could rewrite a gate",
      "Edit",
      [...DESK_OWNED].flatMap((owned) =>
        owned.endsWith(".log")
          ? [
              `${project}/${owned}`,
              `${project}/${owned.replace(/\.log$/, ".00000001.log")}`,
              `${project}/${owned.replace(/\.log$/, ".00000002.log.gz")}`,
            ]
          : [owned.includes(".") ? `${project}/${owned}` : `${project}/${owned}/x`],
      ),
    ],
    [
      "which can hold a sensor's key, as a save's staged copy and Migrate's backups do",
      "Read",
      [machine, project].flatMap((dir) =>
        ["settings.json", backup, "settings.json.4242.tmp"].map((name) => `${dir}/${name}`),
      ),
    ],
    [
      "another seat's settings, which hold that seat's own denials",
      "Edit",
      Object.values(real.harnesses).map(
        (harness) => `${home(harness.profileRoot)}/sw2-supervisor-${harness.id}-shop-1a2b/${harness.settings.file}`,
      ),
    ],
    [
      "the plugin's own state, which every seat reads or runs",
      "Edit",
      [
        "intents.json",
        "kit.json",
        "content.json",
        "models.json",
        "bin/git",
        "keys.json",
        "content/grilling-09b6abde7462/SKILL.md",
        "guides/PLANS.md",
      ].map((path) => `${machine}/${path}`),
    ],
    ["the keys the desk knows a caller by", "Read", [`${machine}/keys.json`, `${machine}/keys.json.123.tmp`]],
    [
      "a login, through the link to it in a seat's directory",
      "Read",
      ["~/.codex/seats/sw2-peer-codex-shop-1a2b/auth.json"],
    ],
    ["git's own configuration, which the desk's git reads too", "Edit", ["~/.gitconfig", "~/.config/git/config"]],
  ];
  for (const [why, tool, paths] of kept)
    for (const path of paths) assert.ok(denied(tool, path), `a Claude seat may ${tool} ${path}: ${why}`);
  for (const link of Object.values(real.harnesses).flatMap((harness) => harness.links ?? [])) {
    const target = home(link.target);
    assert.ok(
      denied("Edit", target) || denied("Edit", `${target}/x`),
      `a Claude seat may edit ${target}, which the seats link to`,
    );
  }
  for (const path of [
    `${machine}/settings.json`,
    "~/.paseo/config.json",
    "~/.codex/auth.json",
    "~/.pi/agent/auth.json",
    "~/.omp/agent/agent.db",
    "~/.local/share/opencode/auth.json",
    "~/.claude/.credentials.json",
  ])
    assert.ok(
      deny.includes(`Read(${path})`),
      `${path} is also named without a glob, the only kind Claude's sandbox keeps on Linux`,
    );
});

test("a seat's session gets its harness's environment, its config directory, project variables and the git launcher first on its PATH", () => {
  const request = {
    agentId: "a",
    reason: "create" as const,
    provider: "sw2-peer-omp",
    cwd: "/repo",
    env: { KEEP: "1", PATH: "/usr/bin" },
  };
  const next = seatEnv(kit, request, "/seats/peer-omp-repo", { root: "/repo", state: "/state/repo" }, "/state/bin");
  assert.deepEqual(
    next.env,
    {
      KEEP: "1",
      PATH: `/state/bin${delimiter}/usr/bin`,
      SEATWORKS_HARNESS: "omp",
      SEATWORKS_AGENT_BIN: "omp",
      PI_CODING_AGENT_DIR: "/seats/peer-omp-repo",
      SEATWORKS_ROLE: "peer",
      SEATWORKS_PROJECT: "/repo",
      SEATWORKS_STATE: "/state/repo",
    },
    "Paseo may run one agent server for every seat of a harness, so only the session carries the seat's own environment",
  );
});
