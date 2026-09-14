import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decide.ts";
import { makeKit } from "./testkit.ts";
import type { Timeline } from "./timeline.ts";

const kit = makeKit();
const lead = kit.roles.find((role) => role.role === "lead")!;
const peer = kit.roles.find((role) => role.role === "peer")!;

function turn(...items: object[]): Timeline {
  return [{ type: "user_message", text: "go" }, ...items] as unknown as Timeline;
}

const say = (text: string) => ({ type: "assistant_message", text });

test("a Lead turn with a NEED block writes one letter up and opens a request", () => {
  const result = decide({
    role: lead,
    agent: { id: "lead-1", title: "Lead A", parentAgentId: "sup-1" },
    turnId: "t1",
    outcome: { kind: "completed" },
    timeline: turn(say("Slices briefed.\n\nNEED: a decision on guest checkout")),
  });
  assert.equal(result.letters.length, 1);
  assert.equal(result.letters[0]?.to, "sup-1");
  assert.match(result.letters[0]?.text ?? "", /NEED: a decision on guest checkout/);
  assert.deepEqual(
    result.requests?.map((block) => block.kind),
    ["NEED"],
  );
});

test("a Lead turn that asks for nothing sends nothing and closes its requests", () => {
  const result = decide({
    role: lead,
    agent: { id: "lead-1", title: "Lead A", parentAgentId: "sup-1" },
    turnId: "t2",
    outcome: { kind: "completed" },
    timeline: turn(say("Waiting on the Peers.")),
  });
  assert.deepEqual(result.letters, []);
  assert.deepEqual(result.requests, []);
});

test("the Lead's own words are only read after the last user message", () => {
  const timeline = [
    { type: "user_message", text: "first" },
    say("NEED: old request"),
    { type: "user_message", text: "second" },
    say("Done."),
  ] as unknown as Timeline;
  const result = decide({ role: lead, agent: { id: "lead-1", title: "A", parentAgentId: "sup-1" }, turnId: null, outcome: { kind: "completed" }, timeline });
  assert.deepEqual(result.requests, []);
});

test("a Peer turn is carried to its Lead as a clipped hand-back", () => {
  const result = decide({
    role: peer,
    agent: { id: "peer-1", title: "S1", parentAgentId: "lead-1" },
    turnId: "t3",
    outcome: { kind: "completed" },
    timeline: turn(say(`Outcome: done\n${"x".repeat(5000)}`)),
  });
  assert.equal(result.letters.length, 1);
  assert.equal(result.letters[0]?.to, "lead-1");
  assert.match(result.letters[0]?.text ?? "", /^HANDBACK from "S1"/);
  assert.match(result.letters[0]?.text ?? "", /more characters/);
  assert.equal(result.requests, null);
});

test("a failed turn and a refused final call are both reported", () => {
  const failed = decide({
    role: peer,
    agent: { id: "peer-1", title: "S1", parentAgentId: "lead-1" },
    turnId: "t4",
    outcome: { kind: "failed", error: { message: "provider crashed" } },
    timeline: turn(),
  });
  assert.match(failed.letters[0]?.text ?? "", /SEAT FAILED/);

  const denied = decide({
    role: peer,
    agent: { id: "peer-1", title: "S1", parentAgentId: "lead-1" },
    turnId: "t5",
    outcome: { kind: "completed" },
    timeline: turn(say("Listing worktrees."), { type: "tool_call", name: "execute", status: "failed", error: { message: "Permission denied for this tool." }, detail: { type: "shell", command: "git worktree list" } }),
  });
  assert.match(denied.letters[0]?.text ?? "", /SEAT STOPPED.*git worktree list/);
});

test("canceled turns and seats without a parent send nothing", () => {
  assert.deepEqual(
    decide({ role: peer, agent: { id: "p", title: "S", parentAgentId: "l" }, turnId: null, outcome: { kind: "canceled", reason: "user" }, timeline: turn(say("hi")) }).letters,
    [],
  );
  assert.deepEqual(
    decide({ role: lead, agent: { id: "l", title: "L", parentAgentId: null }, turnId: null, outcome: { kind: "completed" }, timeline: turn(say("REPORT: done")) }).letters,
    [],
  );
});
