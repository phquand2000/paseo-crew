import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeWords } from "../../client/format/watch.ts";
import { withKey } from "../../client/model/layer.ts";
import { KEPT } from "../../shared/settings.ts";

test("a key typed on the panel goes with the save beside the ones shown as KEPT, and forgetting one leaves the others", () => {
  const shown = { rules: "Keep diffs small.", sensor: { other: { key: KEPT } } };
  assert.deepEqual(withKey(shown, "jev", "a-new-key"), { rules: "Keep diffs small.", sensor: { other: { key: KEPT }, jev: { key: "a-new-key" } } });
  assert.deepEqual(withKey({ ...shown, sensor: { ...shown.sensor, jev: { key: KEPT } } }, "jev", null), shown);
  assert.deepEqual(withKey({ sensor: { jev: { key: KEPT } } }, "jev", null), { sensor: undefined }, "the last key forgotten leaves no sensor block");
});

test("the watch's line says who answers, and how that stands, in words", () => {
  const judge = { label: "Jev", minutes: null, detail: null };
  assert.deepEqual(judgeWords({ ...judge, label: "", state: "off" }), { title: "Nobody answers the watch's questions", hint: "Answered by is off: set it on Team, on the Watcher. The code's own facts go on.", tone: "muted" });
  assert.equal(judgeWords({ ...judge, state: "nokey", detail: "OpenRouter key" }).hint, "Add its OpenRouter key on Team, under Machine defaults, on the Watcher. The code's own facts go on.");
  assert.match(judgeWords({ ...judge, state: "waiting" }).hint, /^Nothing has been asked of it yet\./);
  assert.deepEqual(judgeWords({ ...judge, state: "answering", minutes: 3 }), { title: "Jev answers the watch's questions", hint: "Its answers are kept in assessments.log; no seat is sent them.", tone: "success" });
  assert.deepEqual(judgeWords({ ...judge, state: "failing", minutes: 4, detail: "503: busy" }), { title: "Jev is not answering", hint: "503: busy. The code's own facts go on; nothing waits for an answer.", tone: "warning" });
});
