import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { kitLoader, projectAt, projectRoot, roleOf } from "./kit.ts";

function writeJson(path: string, value: unknown, aheadMs = 0): void {
  writeFileSync(path, JSON.stringify(value));
  if (aheadMs) utimesSync(path, new Date(), new Date(Date.now() + aheadMs));
}

test("kitLoader reads the kit a provider points at and rereads it after a file changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "seatworks-kit-"));
  const kitDir = join(dir, "kit");
  mkdirSync(join(kitDir, "harness", "claude"), { recursive: true });
  writeJson(join(kitDir, "harness", "claude", "harness.json"), { profileRoot: "HOME/.claude/profiles", configDirEnv: "CLAUDE_CONFIG_DIR" });
  writeJson(join(kitDir, "seats.json"), { seats: [{ role: "lead", harness: "claude" }] });
  const config = join(dir, "config.json");
  writeJson(config, {
    agents: { providers: { lead: { env: { SEATWORKS_KIT: kitDir } } } },
    daemon: { agentProfiles: [{ provider: "lead", model: "claude-opus-5" }] },
  });
  const load = kitLoader(config);
  assert.deepEqual(load()?.seats.map((seat) => seat.role), ["lead"]);
  assert.equal(load()?.harnesses.claude?.configDirEnv, "CLAUDE_CONFIG_DIR");
  assert.equal(load()?.profiles[0]?.model, "claude-opus-5");
  writeJson(join(kitDir, "seats.json"), { seats: [{ role: "lead", harness: "claude" }, { role: "peer", harness: "claude" }] }, 5_000);
  assert.deepEqual(load()?.seats.map((seat) => seat.role), ["lead", "peer"]);
});

test("kitLoader finds no kit when no provider names one", () => {
  const dir = mkdtempSync(join(tmpdir(), "seatworks-kit-"));
  writeJson(join(dir, "config.json"), { agents: { providers: {} } });
  assert.equal(kitLoader(join(dir, "config.json"))(), undefined);
});

test("projectRoot finds the nearest .seatworks, and projectAt reads its slug and pinned models", () => {
  const dir = mkdtempSync(join(tmpdir(), "seatworks-root-"));
  mkdirSync(join(dir, ".seatworks"));
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  writeJson(join(dir, ".seatworks", "project.json"), { slug: "demo", models: { lead: "claude-opus-5" } });
  assert.equal(projectRoot(join(dir, "src", "deep")), dir);
  assert.deepEqual(projectAt(dir), { root: dir, slug: "demo", models: { lead: "claude-opus-5" } });
  assert.equal(roleOf("peer/zai/glm-5.3"), "peer");
});
