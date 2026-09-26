// First, so this file has a HOME of its own even run alone: what it writes under HOME would otherwise land in the owner's.
import "../setup.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hiddenWordsIn } from "../../server/catalog/hidden-words.ts";
import { can, harnessFileSources, loadKit, providerId } from "../../server/catalog/kit.ts";
import { seatEnv, stateWrites } from "../../server/catalog/launch.ts";
import { applyReconcile, seatPairs } from "../../server/catalog/providers.ts";
import { materialize, seatDir } from "../../server/catalog/seats.ts";
import { serversFor } from "../../server/catalog/servers.ts";
import { resolveTeam, withHarness } from "../../server/catalog/team.ts";
import { readConfig } from "../../server/core/config-file.ts";
import { paseoConfigPath, stateRoot } from "../../server/core/paths.ts";
import { ANSWER_WITHIN_MS } from "../../server/desk/desk.ts";
import { realProbes } from "../../server/runtime/doctor.ts";
import { tempDir } from "../tempdir.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DESK_GIT = "push pull merge checkout switch reset rebase cherry-pick update-ref stash worktree".split(" ");
const SEARCHES = ["supervisor", "lead", "peer"];
const BUILT_INS: Record<string, string[]> = {
  claude:
    "Bash Edit Write MultiEdit NotebookEdit Read Glob Grep LSP WebFetch WebSearch Skill TodoWrite TaskCreate TaskGet TaskList TaskUpdate AskUserQuestion".split(
      " ",
    ),
  omp: "read grep find glob lsp todo ast_grep ast_edit edit write bash eval debug wait web_search".split(" "),
  opencode: "read edit glob grep list lsp skill todowrite webfetch websearch question task".split(" "),
};

/** The value at a dotted path of a built seat's settings. */
const at = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined),
      value,
    );
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

test("every role builds on every agent the kit ships, each in that agent's own terms", (t) => {
  const kit = loadKit(PLUGIN);
  const base = resolveTeam(kit, { mcp: Object.fromEntries(Object.keys(kit.mcp).map((id) => [id, { enabled: true }])) });
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  writeFileSync(paseoConfigPath(), "{}\n");
  applyReconcile(kit, base);
  const paseo = readConfig<unknown>(paseoConfigPath(), {});
  const home = tempDir("sw2-every-home-");
  const project = { root: "/work/demo", slug: "demo-000000", state: "/state/demo" };
  const agents = Object.values(kit.harnesses).flatMap((harness) => harness.provider.env?.SEATWORKS_AGENT_BIN ?? []);
  for (const { role, harness } of seatPairs(kit)) {
    const where = `${role.role} on ${harness.id}`;
    const edits = !["reviewer", "lead", "pager", "watcher"].includes(role.role);
    const waits = !["lead", "supervisor"].includes(role.role);
    const searches = SEARCHES.includes(role.role);
    const bare = ["watcher", "pager"].includes(role.role);
    assert.deepEqual(
      at(paseo, `agents.providers.${providerId(kit, role.role, harness.id)}.paseoTools`),
      { enabled: false },
      `${where}: no shipped seat acts on another behind the desk or wakes on a clock through Paseo's own tools`,
    );
    const reasons = Object.values(harnessFileSources(kit, harness, role))
      .flat()
      .flatMap((source) =>
        [...readFileSync(source, "utf-8").matchAll(/justification = "([^"]*)"/g)].map((match) => match[1]!),
      );
    if (harness.files) assert.ok(reasons.length > 0, `${where} is given reasons`);
    assert.deepEqual(
      hiddenWordsIn(reasons.join("\n"), role.hidesWords ?? []),
      [],
      `${where}: the reasons for a refusal`,
    );
    assert.equal(
      stateWrites(role, project.state).includes(join(project.state, "CONTEXT.md")),
      role.role === "supervisor",
      `${where}: only the Supervisor writes the project's concept; every other role reads it or is told it`,
    );
    if (bare) {
      assert.equal(can(role, "write"), false, `${where}: touches no work`);
      assert.deepEqual(stateWrites(role, project.state), [], `${where}: writes nothing under the project's state`);
    }
    if (harness.modelCatalog && !realProbes.has(harness.modelCatalog.command[0]!)) {
      t.diagnostic(`${harness.id} is not installed here, so its ${role.role} seat was not built`);
      continue;
    }
    const team = withHarness(base, role.role, harness);
    materialize(
      kit,
      team,
      role.role,
      home,
      project,
      serversFor(kit, team, role.role, { node: "/bin/node", socket: "/desk.sock" }),
    );
    const dir = seatDir(kit, role, harness, home, project);
    const settings = readConfig<unknown>(join(dir, harness.settings.file), {});
    if (harness.id === "claude") {
      const deny = list(at(settings, "permissions.deny"));
      for (const command of DESK_GIT)
        assert.ok(
          [`Bash(git ${command} *)`, `Bash(git -C * ${command} *)`].every((rule) => deny.includes(rule)),
          `${where}: only the desk does git ${command}, with -C or without`,
        );
      for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"])
        assert.equal(
          deny.includes(tool),
          !edits,
          `${where}: ${tool} only where the role edits files; the Lead coordinates and keeps its pages with note`,
        );
      assert.equal(
        deny.includes("Bash(sleep *)"),
        !waits,
        `${where}: mail wakes a coordinating seat, and one asleep in its turn holds it open`,
      );
      for (const agent of agents)
        assert.ok(
          deny.includes(`Bash(${agent} *)`),
          `${where}: a seat does not start ${agent} from its shell, past Paseo`,
        );
      assert.equal(
        deny.includes("WebSearch"),
        !searches,
        `${where}: a Reviewer judges what is in front of it, and the Watcher and the Pager touch nothing`,
      );
      if (bare)
        for (const tool of BUILT_INS.claude!)
          assert.ok(deny.includes(tool), `${where}: a seat that touches nothing has no ${tool}`);
      if (role.role !== "supervisor")
        assert.ok(
          deny.includes("Edit") || deny.includes(`Edit(${stateRoot("~")}/projects/*/CONTEXT.md)`),
          `${where}: the sandbox binds the shell only, so Claude's file tools are kept off the Human's word by name`,
        );
    }
    if (harness.id === "codex") {
      assert.deepEqual(
        at(settings, "features"),
        { multi_agent: false, multi_agent_v2: false },
        `${where}: Paseo is the only control plane`,
      );
      assert.equal(at(settings, "approval_policy"), "never", `${where}: nobody is there to approve`);
      assert.equal(
        at(settings, "skills.bundled.enabled"),
        false,
        `${where}: only the role's skills, as on every other agent`,
      );
      assert.equal(
        at(settings, "sandbox_mode"),
        ["reviewer", "pager", "watcher"].includes(role.role) ? "read-only" : "workspace-write",
        where,
      );
      assert.equal(
        at(settings, "web_search") === "disabled",
        !searches,
        `${where}: searches the web only where the role may`,
      );
      const catalog =
        readConfig<{ models?: Record<string, unknown>[] }>(String(at(settings, "model_catalog_json")), {}).models ?? [];
      assert.ok(
        catalog.length > 0 && catalog.every((model) => model.multi_agent_version === null),
        `${where}: no model offers native agents`,
      );
      assert.ok(
        list(at(settings, "sandbox_workspace_write.writable_roots")).every((path) => path.startsWith("/state/demo/")),
        `${where}: writes into the state only where its content says`,
      );
      const rules = readFileSync(join(dir, "rules", "seatworks.rules"), "utf-8");
      for (const command of DESK_GIT)
        assert.match(
          rules,
          new RegExp(`\\["git", (\\[[^\\]]*)?"${command}"`),
          `${where}: only the desk does git ${command}`,
        );
      assert.equal(
        /"git", "commit"/.test(rules),
        ["supervisor", "lead"].includes(role.role),
        `${where}: commits only where the role commits`,
      );
      assert.equal(/pattern = \["sleep"\]/.test(rules), !waits, `${where}: sleeps only where the role may`);
      const forbidden =
        rules.match(
          /prefix_rule\(pattern = \[\[([^\]]*)\]\], decision = "forbidden", justification = "Agents are started by the desk/,
        )?.[1] ?? "";
      for (const agent of agents)
        assert.ok(
          forbidden.includes(`"${agent}"`),
          `${where}: a seat does not start ${agent} from its shell, past Paseo`,
        );
    }
    if (harness.id === "omp") {
      const patterns = (at(settings, "bash.patterns") ?? []) as { approval: string; match: string }[];
      const denied = patterns.filter((rule) => rule.approval === "deny").map((rule) => rule.match);
      const refuses = (command: string) =>
        [`git ${command}`, `git ${command} *`, `git -C * ${command}`, `git -C * ${command} *`].every((rule) =>
          denied.includes(rule),
        );
      const approval = (tool: string) => at(settings, `tools.approval.${tool}`);
      for (const command of DESK_GIT)
        assert.ok(refuses(command), `${where}: only the desk does git ${command}, with -C or without`);
      assert.ok(
        !denied.some((rule) => /^git (-C \* )?[a-z-]+\*$/.test(rule)),
        `${where}: no pattern takes in a longer command, as git merge* took git merge-base`,
      );
      assert.equal(
        refuses("commit"),
        ["supervisor", "lead", "reviewer"].includes(role.role),
        `${where}: commits only where the role may`,
      );
      assert.equal(denied.includes("sleep *"), !waits, `${where}: sleeps only where the role may`);
      for (const agent of agents)
        assert.ok(
          [agent, `${agent} *`].every((rule) => denied.includes(rule)),
          `${where}: a seat does not start ${agent} from its shell, past Paseo`,
        );
      assert.equal(
        at(settings, "ask.enabled"),
        false,
        `${where}: nobody is there to answer a question that stops the turn`,
      );
      assert.equal(approval("task"), "deny", `${where}: Paseo is the only control plane`);
      assert.equal(
        approval("eval"),
        "deny",
        `${where}: an eval cell starts agents through agent() and workpool(), past Paseo`,
      );
      assert.deepEqual(
        [at(settings, "eval.py"), at(settings, "eval.js")],
        [false, false],
        `${where}: omp offers no eval tool with both backends off, and PI_PY or PI_JS bringing one back still meets the deny`,
      );
      assert.equal(
        approval("debug") === "deny",
        bare,
        `${where}: debugs only where it has a shell that runs the same programs`,
      );
      assert.notEqual(
        at(settings, "skills.enablePiUser"),
        false,
        `${where}: the skills linked into the seat's own directory load`,
      );
      assert.equal(
        at(settings, "tools.xdev"),
        false,
        `${where}: no tool hides behind write, which the Lead and the Reviewer are denied`,
      );
      assert.equal(
        at(settings, "ttsr.builtinRules"),
        false,
        `${where}: omp's own style rules do not overrule the project's`,
      );
      assert.deepEqual(
        [at(settings, "bash.autoBackground.enabled"), at(settings, "launch.enabled")],
        [false, false],
        `${where}: a command runs within its turn, and no service outlives it`,
      );
      const disabled = list(at(settings, "disabledProviders"));
      assert.ok(
        disabled.includes("omp-plugins"),
        `${where}: plugins installed for the owner's own omp do not load in a seat`,
      );
      const request = {
        agentId: "a",
        reason: "create" as const,
        provider: providerId(kit, role.role, "omp"),
        cwd: "/work/demo",
        env: {},
      };
      const env = seatEnv(kit, request, dir, project).env;
      assert.equal(
        env.PI_CONFIG_FILES,
        join(dir, harness.settings.file),
        `${where}: its settings overlay a repository's own .omp/config.yml, which would outrank them`,
      );
      assert.ok(
        Number(env.OMP_MCP_TIMEOUT_MS) > ANSWER_WITHIN_MS,
        `${where}: waits for a desk call longer than the desk takes to answer it, where omp gives up at 30 s`,
      );
      assert.equal(approval("web_search") === "deny", !searches, `${where}: searches the web only where the role may`);
      if (bare) for (const tool of BUILT_INS.omp!) assert.equal(approval(tool), "deny", `${where}: has no ${tool}`);
      assert.equal(
        ["edit", "write", "ast_edit"].every((tool) => approval(tool) === "deny"),
        !edits,
        `${where}: edits files only where the role may`,
      );
      assert.ok(disabled.includes("claude"), `${where}: the owner's own Claude setup does not load in a seat`);
      const servers = (at(readConfig<unknown>(join(dir, harness.mcp.file), {}), "mcpServers") ?? {}) as Record<
        string,
        unknown
      >;
      assert.equal(
        "team" in servers,
        Boolean(role.tools),
        `${where}: the desk's tools are in the file omp reads them from`,
      );
    }
    if (harness.id === "opencode") {
      const bash = (at(settings, "permission.bash") ?? {}) as Record<string, unknown>;
      const allowed = (tool: string) => at(settings, `permission.${tool}`);
      assert.equal(Object.keys(bash)[0], "*", `${where}: the allow comes first, since the last rule that matches wins`);
      for (const command of DESK_GIT)
        assert.ok(
          bash[`git ${command} *`] === "deny" && bash[`git -C * ${command} *`] === "deny",
          `${where}: only the desk does git ${command}, with -C or without`,
        );
      assert.equal(
        bash["git commit *"] === "deny",
        ["supervisor", "lead", "reviewer"].includes(role.role),
        `${where}: commits only where the role may`,
      );
      assert.equal(bash["sleep *"] === "deny", !waits, `${where}: sleeps only where the role may`);
      for (const agent of agents)
        assert.ok(
          bash["*"] === "deny" || (bash[agent] === "deny" && bash[`${agent} *`] === "deny"),
          `${where}: a seat does not start ${agent} from its shell, past Paseo`,
        );
      assert.deepEqual(
        [allowed("task"), allowed("question"), allowed("external_directory")],
        ["deny", "deny", "allow"],
        `${where}: no subagents, no question that stops the turn, and nothing waiting on a person`,
      );
      assert.equal(allowed("edit") === "deny", !edits, `${where}: edits files only where the role may`);
      assert.equal(allowed("websearch") === "deny", !searches, `${where}: searches the web only where the role may`);
      if (bare)
        for (const tool of [...BUILT_INS.opencode!, "bash"])
          assert.equal(tool === "bash" ? bash["*"] : allowed(tool), "deny", `${where}: has no ${tool}`);
    }
    if (harness.id === "pi") {
      assert.deepEqual(
        at(settings, "packages"),
        ["npm:pi-mcp-adapter"],
        `${where}: the desk's tools reach Pi only through the adapter`,
      );
      assert.equal(
        at(settings, "defaultProjectTrust"),
        "never",
        `${where}: the repository's own .pi does not load in a seat`,
      );
      const tools = {
        reviewer: ["read", "bash", "grep", "find", "ls"],
        lead: ["read", "bash", "grep", "find", "ls"],
        pager: [],
        watcher: [],
      }[role.role as "reviewer"];
      assert.deepEqual(at(settings, "defaultTools"), tools, where);
      const desk = at(readConfig<unknown>(join(dir, harness.mcp.file), {}), "mcpServers.team");
      if (!role.tools)
        assert.equal(desk, undefined, `${where}: a role given no desk tools is not connected to the desk`);
      else {
        assert.equal(
          at(desk, "lifecycle"),
          "keep-alive",
          `${where}: the adapter lists an unconnected server with no tools, so a fresh Peer could not find done`,
        );
        assert.equal(at(desk, "directTools"), true, `${where}: and its verbs are tools of their own`);
        assert.ok(
          Number(at(desk, "requestTimeoutMs")) > ANSWER_WITHIN_MS,
          `${where}: waits for a desk call longer than the desk takes to answer it, where the SDK gives up at 60 s`,
        );
      }
    }
    assert.ok(existsSync(join(dir, harness.skillsDir)), `${where}: skills`);
  }
});
