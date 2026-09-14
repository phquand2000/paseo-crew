import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionBlocks } from "./features/watcher.ts";
import { ATTENTION_HEADER, attention, logFields, quoted } from "./messages.ts";

test("every attention message parses back through the header the watcher reads", () => {
  for (const kind of [undefined, "urgent", "log"] as const) {
    const text = attention({ kind, trigger: "minted API", agentId: "a1", role: "peer", what: "a fake of its own code", quote: "q" });
    assert.deepEqual(ATTENTION_HEADER.exec(text)?.slice(1), [kind, "minted API", "a1", "peer"]);
    assert.equal(attentionBlocks(text)[0]?.quote, "q");
  }
});

test("quoted keeps one line, swaps double quotes and caps the length", () => {
  assert.equal(quoted('  he said "hi"\nsecond line'), `"he said 'hi'"`);
  assert.equal(quoted("x".repeat(200)).length, 162);
  assert.equal(logFields("a1", "peer", "question"), "a1 (peer)  question");
  assert.equal(logFields("a1", "peer", "stall", "boom"), 'a1 (peer)  stall  "boom"');
});
