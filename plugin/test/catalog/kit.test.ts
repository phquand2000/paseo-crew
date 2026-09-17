import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { can, harnessProblems, loadKit, roleThatCan, rolesThatCan, toolsOf } from "../../server/catalog/kit.ts";
import { tempDir } from "../../server/core/testing.ts";

const good = () => ({
  id: "acme",
  label: "Acme CLI",
  baseProvider: "acp",
  configDirEnv: "ACME_CONFIG_DIR",
  profileRoot: "HOME/.acme/seats",
  skillsDir: "skills",
  settings: { file: "config.json", source: "settings.json", roleSource: "settings/ROLE.settings.json" },
  mcp: { file: "mcp.json", delivery: "file", transports: ["stdio"], key: "mcpServers" },
  provider: { command: ["KIT/bin/seat-room", "acp"] },
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
