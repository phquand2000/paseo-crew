import assert from "node:assert/strict";
import { test } from "node:test";
import { type Timeline, deniedCall, outputText } from "./timeline.ts";

const t = (...items: object[]) => items as unknown as Timeline;

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
  assert.equal(deniedCall(timeline), "Bash: git log");
});

test("a last call that never completed and got no reply counts as refused", () => {
  const timeline = t({ type: "user_message", text: "go" }, { type: "tool_call", name: "exec", status: "canceled", detail: { command: "gh api user" } });
  assert.equal(deniedCall(timeline), "exec: gh api user");
});

test("a refused call the seat recovered from is not reported", () => {
  const timeline = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "Bash", status: "failed", error: "denied", detail: { command: "git log" } },
    { type: "assistant_message", text: "That was refused, so I read the file instead. ".repeat(10) },
  );
  assert.equal(deniedCall(timeline), undefined);
  const recovered = t(
    { type: "user_message", text: "go" },
    { type: "tool_call", name: "Bash", status: "failed", error: "denied" },
    { type: "tool_call", name: "Read", status: "completed" },
  );
  assert.equal(deniedCall(recovered), undefined);
});
