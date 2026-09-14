import assert from "node:assert/strict";
import { test } from "node:test";
import { type Timeline, lastUserText, outputText } from "./timeline.ts";

const timeline = [
  { type: "assistant_message", text: "earlier reply" },
  { type: "user_message", text: "SWEEP since 2026-09-14T00:00:00.000Z" },
  { type: "tool_call", name: "read" },
  { type: "assistant_message", text: "first part, " },
  { type: "assistant_message", text: "second part" },
] as unknown as Timeline;

test("outputText joins the assistant messages after the last user message", () => {
  assert.equal(outputText(timeline), "first part, second part");
});

test("lastUserText returns the latest user message", () => {
  assert.equal(lastUserText(timeline), "SWEEP since 2026-09-14T00:00:00.000Z");
  assert.equal(lastUserText([] as unknown as Timeline), "");
});
