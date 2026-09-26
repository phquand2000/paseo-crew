import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { harness } from "./harness.ts";

test("a seat is created with its role's prompt, then what its harness needs said against that agent's own instructions", () => {
  const h = harness();
  const prompt = (provider: string) => h.runtime.create({ provider, cwd: h.root }, {}).config.systemPrompt ?? "";
  const delta = readFileSync(join(import.meta.dirname, "..", "..", "harness", "codex", "delta", "peer.md"), "utf-8");
  const onClaude = prompt("sw2-peer-claude");
  assert.match(onClaude, /^# Peer\n/);
  assert.equal(
    prompt("sw2-peer-codex"),
    `${onClaude.trimEnd()}\n\n${delta}`,
    "the same prompt, then Codex's delta; an agent whose own instructions need nothing said against them gets nothing",
  );
});
