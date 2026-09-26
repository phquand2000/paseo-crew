import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import type { TimelineItem } from "../../server/core/ports.ts";
import { deniedCall, malformed, outputText } from "../../server/runtime/timeline.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const { refused } = kit.ecosystem.watch;
const unparsed = kit.harnesses.claude!.timeline?.unparsed;
const go: TimelineItem = { type: "user_message", text: "go" };
const failed = (name: string, error: unknown, detail?: unknown): TimelineItem => ({
  type: "tool_call",
  name,
  status: "failed",
  error,
  detail,
});

test("what a turn's end says of its last call and of calls its harness refused as not JSON, read from Paseo's timeline", () => {
  const words: TimelineItem[] = [
    { type: "user_message", text: "one" },
    { type: "assistant_message", text: "old" },
    { type: "user_message", text: "two" },
    { type: "assistant_message", text: "new " },
    { type: "tool_call", name: "read", status: "completed" },
    { type: "assistant_message", text: "words" },
  ];
  assert.equal(outputText(words), "new words", "the assistant's words after the last user message, around its calls");

  const denied = failed(
    "Bash",
    { content: "Permission to use Bash with command git log has been denied." },
    {
      type: "shell",
      command: "git log",
    },
  );
  const policy = failed("shell", "policy says no", { command: "rm -rf build" });
  const lastCalls: [TimelineItem[], string, { what: string; refused: boolean } | undefined, string][] = [
    [
      [go, denied, { type: "assistant_message", text: "" }],
      refused,
      { what: "Bash: git log", refused: true },
      "refused",
    ],
    [
      [go, { type: "tool_call", name: "exec", status: "canceled", detail: { command: "gh api user" } }],
      refused,
      { what: "exec: gh api user", refused: false },
      "a last call that never came back ends the turn too, and is not called a refusal",
    ],
    [
      [
        go,
        failed("Bash", "denied", { command: "git log" }),
        { type: "assistant_message", text: "That was refused, so I read the file instead. ".repeat(10) },
      ],
      refused,
      undefined,
      "recovered from in words",
    ],
    [
      [go, failed("Bash", "denied"), { type: "tool_call", name: "Read", status: "completed" }],
      refused,
      undefined,
      "or by a later call",
    ],
    [
      [go, policy, { type: "assistant_message", text: "Stopped." }],
      refused,
      undefined,
      "a failure the seat spoke after",
    ],
    [
      [go, policy, { type: "assistant_message", text: "Stopped." }],
      "policy says no",
      { what: "shell: rm -rf build", refused: true },
      "only what the pattern names counts as refused",
    ],
  ];
  for (const [timeline, pattern, expected, why] of lastCalls)
    assert.deepEqual(deniedCall(timeline, pattern), expected, why);

  // Claude Code keeps unparsable input under `__unparsedToolInput` and repeats it in the error.
  const notJson = {
    content:
      'InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON.\nYou sent (first 200 of 2472 bytes): {"title": "pick(versions, range) to spec"',
  };
  const input = (raw: string) => ({ type: "unknown", input: { __unparsedToolInput: { raw } }, output: null });
  const mixed: TimelineItem[] = [
    go,
    failed("mcp__team__open_lane", notJson, input('{"title": "pick(versions, range) to spec"')),
    {
      type: "tool_call",
      name: "mcp__team__open_lane",
      status: "completed",
      detail: { type: "unknown", input: { title: "t" }, output: "Lane L1 is open" },
    },
    failed("Bash", "exit 1", { type: "shell", command: "npm test" }),
  ];
  const found = malformed(mixed, unparsed);
  assert.deepEqual(
    found.map((call) => call.tool),
    ["mcp__team__open_lane"],
    "the retry and the ordinary failure are not",
  );
  assert.match(found[0]!.quote, /could not be parsed as JSON/);
  assert.deepEqual(
    malformed([failed("done", null, input("{"))], unparsed).map((call) => call.tool),
    ["done"],
    "the input it could not read is enough",
  );
  const mentions: TimelineItem[] = [
    go,
    failed(
      "Bash",
      { content: "exit 1" },
      { type: "shell", command: "npm test", exitCode: 1, output: "FAIL config.test.ts: could not be parsed as JSON" },
    ),
    failed("Grep", null, {
      type: "unknown",
      input: { pattern: "boom" },
      output: "timeline.ts: const UNPARSED = /__unparsedToolInput|could not be parsed as JSON/",
    }),
  ];
  assert.deepEqual(
    malformed(mentions, unparsed),
    [],
    "only what the harness was handed decides, never a call's own output",
  );
});
