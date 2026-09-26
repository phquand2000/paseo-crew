import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { Window } from "../../server/runtime/watch/window.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const row = (item: Record<string, unknown>) => ({ item, seqStart: 1, seq: 1, epoch: "e", turnId: "t", replay: false });

test("a call its harness file names as no call of the seat's own is kept apart, on that harness only", () => {
  const stdin = {
    type: "tool_call",
    callId: "c1",
    name: "terminal",
    status: "completed",
    detail: { type: "plain_text", text: "y\n" },
  };
  assert.equal(
    new Window(kit.harnesses.codex!.timeline).add(row(stdin)).call?.pseudo,
    true,
    "Codex writing to a command's stdin is not a command",
  );
  assert.equal(new Window(kit.harnesses.claude!.timeline).add(row(stdin)).call?.pseudo, false);
});
