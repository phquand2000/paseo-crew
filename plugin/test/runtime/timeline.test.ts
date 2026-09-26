import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import type { TimelineItem } from "../../server/core/ports.ts";
import { deniedCall, malformed, outputText } from "../../server/runtime/timeline.ts";

const t = (...items: TimelineItem[]) => items;
const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const { refused } = kit.ecosystem.watch;
const unparsed = kit.harnesses.claude!.timeline?.unparsed;

test("output text joins the assistant's words after the last user message", () => {
  const timeline = t(
    { type: "user_message", text: "one" },
    { type: "assistant_message", text: "old" },
    { type: "user_message", text: "two" },
    { type: "assistant_message", text: "new " },
    { type: "tool_call", name: "read", status: "completed" },
    { type: "assistant_message", text: "words" },
  );
  assert.equal(outputText(timeline), "new words");
});

test("a turn that ends right after a refused call is reported with the call", () => {
  const timeline = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "Bash", status: "failed", error: { content: "Permission to use Bash with command git log has been denied." }, detail: { type: "shell", command: "git log" } },
    { type: "assistant_message", text: "" },
  );
  assert.deepEqual(deniedCall(timeline, refused), { what: "Bash: git log", refused: true });
});

test("a last call that never came back ends the turn too, and is not called a refusal", () => {
  const timeline = t({ type: "user_message", text: "go" }, { type: "tool_call", name: "exec", status: "canceled", detail: { command: "gh api user" } });
  // A policy refusal and an ordinary tool failure are different conversations for the Lead.
  assert.deepEqual(deniedCall(timeline, refused), { what: "exec: gh api user", refused: false });
});

test("a refused call the seat recovered from is not reported", () => {
  const timeline = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "Bash", status: "failed", error: "denied", detail: { command: "git log" } },
    { type: "assistant_message", text: "That was refused, so I read the file instead. ".repeat(10) },
  );
  assert.equal(deniedCall(timeline, refused), undefined);
  const recovered = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "Bash", status: "failed", error: "denied" },
    { type: "tool_call", name: "Read", status: "completed" },
  );
  assert.equal(deniedCall(recovered, refused), undefined);
});

test("a harness names how its refusals read, and only those count as refused", () => {
  const timeline = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "shell", status: "failed", error: "policy says no", detail: { command: "rm -rf build" } },
    { type: "assistant_message", text: "Stopped." },
  );
  assert.equal(deniedCall(timeline, refused), undefined, "it failed and the seat spoke after it, so the turn did not end on that call");
  assert.deepEqual(deniedCall(timeline, "policy says no"), { what: "shell: rm -rf build", refused: true });
});

test("a call the harness refused because its input was not JSON is reported, and an ordinary failure is not", () => {
  // Claude Code keeps unparsable input under `__unparsedToolInput` and repeats it in the error.
  const timeline = t(
    { type: "user_message", text: "go" },
    {
      type: "tool_call",
      callId: "c1",
      name: "mcp__team__open_lane",
      status: "failed",
      error: { content: "InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON.\nYou sent (first 200 of 2472 bytes): {\"title\": \"pick(versions, range) to spec\"" },
      detail: { type: "unknown", input: { __unparsedToolInput: { raw: '{"title": "pick(versions, range) to spec"' } }, output: null },
    },
    { type: "tool_call", callId: "c2", name: "mcp__team__open_lane", status: "completed", detail: { type: "unknown", input: { title: "t" }, output: "Lane L1 is open" } },
    { type: "tool_call", callId: "c3", name: "Bash", status: "failed", error: "exit 1", detail: { type: "shell", command: "npm test" } },
  );
  assert.deepEqual(
    malformed(timeline, unparsed).map((call) => call.tool),
    ["mcp__team__open_lane"],
    "the retry and the ordinary failure are not malformed input",
  );
  assert.match(malformed(timeline, unparsed)[0]!.quote, /could not be parsed as JSON/);
});

test("a malformed call is still reported when only the input it could not read survives", () => {
  const timeline = t({ type: "tool_call", callId: "c1", name: "done", status: "failed", error: null, detail: { type: "unknown", input: { __unparsedToolInput: { raw: "{" } }, output: null } });
  assert.deepEqual(malformed(timeline, unparsed).map((call) => call.tool), ["done"]);
});

test("a failed call whose own output happens to mention unparsed JSON is not a malformed call", () => {
  // The phrase is an ordinary error string; only what the harness was handed decides.
  const timeline = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", callId: "c1", name: "Bash", status: "failed", error: { content: "exit 1" }, detail: { type: "shell", command: "npm test", exitCode: 1, output: "FAIL config.test.ts: could not be parsed as JSON" } },
    { type: "tool_call", callId: "c2", name: "Grep", status: "failed", error: null, detail: { type: "unknown", input: { pattern: "boom" }, output: "timeline.ts: const UNPARSED = /__unparsedToolInput|could not be parsed as JSON/" } },
  );
  assert.deepEqual(malformed(timeline, unparsed), []);
});

test("a malformed call belongs to the turn it was made in, and is not reported again at the end of the next", () => {
  // Paseo hands `agent.turn_ended` the seat's whole append-only timeline, so the turn is cut out here.
  const turn = [
    { type: "user_message", text: "open the lane" },
    { type: "tool_call", callId: "c1", name: "mcp__team__open_lane", status: "failed", error: { content: "InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON." }, detail: { type: "unknown", input: { __unparsedToolInput: { raw: "{" } }, output: null } },
    { type: "tool_call", callId: "c2", name: "mcp__team__open_lane", status: "completed", detail: { type: "unknown", input: { title: "t" }, output: "Lane L1 is open" } },
    { type: "assistant_message", text: "Opened." },
  ];
  assert.deepEqual(malformed(t(...turn), unparsed).map((call) => call.tool), ["mcp__team__open_lane"]);
  const later = t(...turn, { type: "user_message", text: "now start a task" }, { type: "tool_call", callId: "c3", name: "status", status: "completed", detail: {} }, { type: "assistant_message", text: "Done." });
  assert.deepEqual(malformed(later, unparsed), [], "the same call is not written to the log again every turn for the rest of the session");
});
