import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "smol-toml";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { providerId } from "../../server/catalog/kit/roles.ts";
import { applyRole } from "../../server/catalog/seat/launch.ts";
import { materialize, seatDir } from "../../server/catalog/seat/seats.ts";
import { resolveTeam, withHarness } from "../../server/catalog/team/team.ts";
import type { AgentConfig } from "../../server/core/ports.ts";
import { placeLinks } from "../../server/desk/copies/links.ts";
import { loadConfig, saveConfig } from "../../server/desk/project/project.ts";
import { pathProblem, projectWrites, seatWrites } from "../../server/desk/project/writes.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const repo = (): string => {
  const root = realpathSync(tempDir("sw2-links-root-"));
  execFileSync("git", ["init", "-q", root]);
  return root;
};

test("the Human's links and writable paths default to none, and set_project's save keeps them", () => {
  const state = tempDir("sw2-links-state-");
  const config = loadConfig(state);
  assert.deepEqual([config.links, config.writable], [[], []]);
  saveConfig(state, { ...config, links: ["AGENTS.md"], writable: ["docs/plans"] });
  assert.deepEqual([loadConfig(state).links, loadConfig(state).writable], [["AGENTS.md"], ["docs/plans"]]);
});

test("a configured path must stay inside the project, and a writable one is granted as its real path", () => {
  const root = realpathSync(tempDir("sw2-links-root-"));
  const outside = realpathSync(tempDir("sw2-links-outside-"));
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  symlinkSync(outside, join(root, "away"));
  assert.equal(pathProblem(root, "docs/plans"), undefined);
  assert.equal(pathProblem(root, "docs/../docs/plans"), undefined);
  assert.match(pathProblem(root, "/etc") ?? "", /not a path relative/);
  assert.match(pathProblem(root, "../x") ?? "", /leaves the project/);
  assert.match(pathProblem(root, ".") ?? "", /leaves the project/);
  assert.match(pathProblem(root, "missing") ?? "", /does not exist/);
  assert.match(pathProblem(root, "away") ?? "", /resolves outside/);
  const state = tempDir("sw2-links-state-");
  saveConfig(state, { ...loadConfig(state), writable: ["docs/plans", "away", "../x", "missing"] });
  assert.deepEqual(projectWrites({ root, slug: "x", state }), [join(root, "docs", "plans")]);
});

test("a role that commits also writes the repository's git directory, where a lane copy keeps its index", () => {
  const kit = makeKit();
  const root = repo();
  const project = { root, slug: "x", state: tempDir("sw2-links-state-") };
  const role = (name: string) => kit.roles.find((entry) => entry.role === name)!;
  assert.deepEqual(seatWrites(role("peer"), project), [join(root, ".git")]);
  assert.deepEqual(seatWrites(role("lead"), project), []);
});

test("a lane copy gets a link to each ignored path the Human named, and a skip is logged for any other", async () => {
  const root = repo();
  writeFileSync(join(root, ".gitignore"), "AGENTS.md\ndocs/plans\n");
  writeFileSync(join(root, "AGENTS.md"), "rules\n");
  writeFileSync(join(root, "tracked.md"), "x\n");
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  const copy = { id: "s1", path: realpathSync(tempDir("sw2-links-copy-")) };
  execFileSync("git", ["init", "-q", copy.path]);
  writeFileSync(join(copy.path, ".gitignore"), "AGENTS.md\ndocs/plans\n");
  const project = { root, slug: "x", state: tempDir("sw2-links-state-") };
  saveConfig(project.state, { ...loadConfig(project.state), links: ["AGENTS.md", "docs/plans", "tracked.md", "../x"] });
  const lines: string[] = [];
  const log = (_project: unknown, line: string) => lines.push(line);
  await placeLinks(log, project, copy);
  assert.equal(readlinkSync(join(copy.path, "AGENTS.md")), join(root, "AGENTS.md"));
  assert.equal(readlinkSync(join(copy.path, "docs", "plans")), join(root, "docs", "plans"));
  assert.throws(() => lstatSync(join(copy.path, "tracked.md")));
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /tracked\.md was not linked into working copy s1: it is not ignored by git/);
  assert.match(lines[1]!, /\.\.\/x was not linked .* leaves the project/);
  const events = readFileSync(join(project.state, "events.log"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { kind: string; path: string });
  assert.deepEqual(
    events.map((event) => [event.kind, event.path]),
    [
      ["link.skipped", "tracked.md"],
      ["link.skipped", "../x"],
    ],
  );
  await placeLinks(log, project, copy);
  assert.equal(lines.length, 4, "a path already in the copy is left as it is");
});

test("a seat's extra writes reach its sandbox at launch and in its own settings file", () => {
  const kit = makeKit();
  const team = resolveTeam(kit);
  const config = {
    provider: providerId(kit, "peer", "claude"),
    cwd: "/repo",
    providerOptions: { settings: { sandbox: { filesystem: { allowWrite: ["/tmp"] } } } },
  } as unknown as AgentConfig;
  const granted = (writes?: string[]) =>
    (
      applyRole(kit, team, config, () => "", "/state/repo", {}, writes) as unknown as {
        providerOptions: { settings: { sandbox: { filesystem: { allowWrite: string[] } } } };
      }
    ).providerOptions.settings.sandbox.filesystem.allowWrite;
  assert.ok(!granted().includes("/repo/.git"));
  assert.ok(granted(["/repo/.git", "/repo/docs/plans"]).includes("/repo/docs/plans"));

  const files: Record<string, string> = {
    "harness.json": JSON.stringify({
      id: "cx",
      label: "Cx",
      baseProvider: "codex",
      configDirEnv: "CODEX_HOME",
      profileRoot: "HOME/.cx",
      contextFile: "AGENTS.md",
      skillsDir: "skills",
      settings: { file: "config.toml", source: "settings.toml", roleSource: "settings/ROLE.settings.toml" },
      stateWrites: { path: "sandbox_workspace_write.writable_roots", delivery: "file" },
      mcp: { file: "config.toml", delivery: "launch", transports: ["stdio", "http"] },
      provider: {},
    }),
    "settings.toml": "",
    "settings/lead.settings.toml": 'sandbox_mode = "workspace-write"\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(kit.dir, "harness", "cx", path)), { recursive: true });
    writeFileSync(join(kit.dir, "harness", "cx", path), text);
  }
  const cx = loadKit(kit.dir);
  const lead = withHarness(resolveTeam(cx), "lead", cx.harnesses.cx!);
  const home = tempDir("sw2-links-home-");
  const where = { root: "/work/shop", slug: "shop-abc123", state: "/state/shop", writes: ["/work/shop/docs/plans"] };
  materialize(cx, lead, "lead", home, where, {});
  const toml = parse(
    readFileSync(join(seatDir(cx, lead.roles.lead!.role, cx.harnesses.cx!, home, where), "config.toml"), "utf-8"),
  ) as { sandbox_workspace_write: { writable_roots: string[] } };
  assert.deepEqual(toml.sandbox_workspace_write.writable_roots, ["/state/shop/plans", "/work/shop/docs/plans"]);
});
