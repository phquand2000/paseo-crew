import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harnessProblems, loadKit } from "./kit.ts";
import { tempDir } from "../core/testing.ts";

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
  const { loadKit } = await import("./kit.ts");
  const kit = loadKit(new URL("../..", import.meta.url).pathname);
  for (const [id, harness] of Object.entries(kit.harnesses)) assert.deepEqual(harnessProblems(id, harness as unknown as Record<string, unknown>), [], `harness ${id}`);
});
