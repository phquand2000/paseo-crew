import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../../server/core/ports.ts";
import { harness } from "./harness.ts";

test("a seat is created with its role's prompt, then what its harness needs said against that agent's own instructions", () => {
  const h = harness();
  const prompt = (provider: string) => h.runtime.create({ provider, cwd: h.root } as AgentConfig).systemPrompt ?? "";
  const delta = readFileSync(join(import.meta.dirname, "..", "..", "harness", "codex", "delta", "peer.md"), "utf-8");
  const onCodex = prompt("sw2-peer-codex");
  assert.match(onCodex, /^# Peer\n/);
  assert.ok(onCodex.endsWith(`\n\n${delta}`), onCodex.slice(-400));
  assert.doesNotMatch(prompt("sw2-peer-claude"), /"The user" in your base instructions/, "an agent whose own instructions need nothing said against them gets nothing");
});
