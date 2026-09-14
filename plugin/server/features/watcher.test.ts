import assert from "node:assert/strict";
import { test } from "node:test";
import { type Block, attentionBlocks, planBlocks } from "./watcher.ts";

const text = [
  "Sweep notes.",
  "ATTENTION (urgent): destructive in a1 (peer)",
  "What: ran git reset --hard",
  "Quote: git reset --hard HEAD~3",
  "",
  "ATTENTION (log): struggle in a2 (lead)",
  "What: same command failed twice",
  "",
  "ATTENTION: framing in a2 (lead)",
  "What: a brief offered A or B",
  "Quote: choose A or B",
].join("\n");

test("attentionBlocks splits a sweep into blocks and reads each header and quote", () => {
  const blocks = attentionBlocks(text);
  assert.deepEqual(
    blocks.map(({ kind, trigger, agentId, role, quote }) => ({ kind, trigger, agentId, role, quote })),
    [
      { kind: "urgent", trigger: "destructive", agentId: "a1", role: "peer", quote: "git reset --hard HEAD~3" },
      { kind: "log", trigger: "struggle", agentId: "a2", role: "lead", quote: blocks[1]?.text },
      { kind: undefined, trigger: "framing", agentId: "a2", role: "lead", quote: "choose A or B" },
    ],
  );
});

test("planBlocks sends urgent at once, reports normally, and logs a log block until its third sweep in a row", () => {
  const blocks: Block[] = attentionBlocks(text);
  const first = planBlocks(blocks, true, new Map());
  assert.deepEqual(first.steps.map(({ send, now }) => [send !== undefined, now]), [[true, true], [false, false], [true, false]]);
  assert.deepEqual([...first.seen], [["a2 struggle", 1]]);
  const third = planBlocks(blocks, true, new Map([["a2 struggle", 2]]));
  assert.match(third.steps[1]?.send ?? "", /^ATTENTION: struggle in a2 \(lead\)/);
  const unswept = planBlocks(blocks, false, new Map([["a2 struggle", 2]]));
  assert.equal(unswept.steps[1]?.send, undefined);
  assert.equal(unswept.seen.size, 0);
});
