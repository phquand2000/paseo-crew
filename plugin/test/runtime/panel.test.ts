import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { settle } from "./fake-timeline.ts";
import { laneWithPeer } from "./harness.ts";

const incidentsOf = (state: string) =>
  JSON.parse(readFileSync(join(state, "incidents.json"), "utf-8")).items as Record<
    string,
    { kind: string; held?: string }
  >;

test("with mail off a page still reaches whoever supervises, and the rest is recorded and waits until the owner turns mail on", async () => {
  const { h, sup, timeline } = await laneWithPeer();
  timeline.beat("turn_started", "t1");
  timeline.add(
    {
      type: "tool_call",
      callId: "c1",
      name: "Edit",
      status: "completed",
      detail: {
        type: "edit",
        filePath: "src/a.ts",
        oldString: "const x = f();",
        newString: "// @ts-ignore\nconst x = f();",
      },
    },
    "t1",
  );
  timeline.add(
    {
      type: "tool_call",
      callId: "c2",
      name: "Bash",
      status: "running",
      detail: { type: "shell", command: "git push --force origin main" },
    },
    "t1",
  );
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  assert.deepEqual(
    Object.values(incidentsOf(h.project.state)).map((item) => [item.kind, item.held]),
    [
      ["suppressed", "shadow"],
      ["destructive", undefined],
    ],
  );
  const sent = h.agents.get(sup)!.sent.join("\n");
  assert.match(
    sent,
    /INCIDENT I2 \(destructive, page\)/,
    "a page is irreversible and often done already, so no switch holds it",
  );
  assert.doesNotMatch(sent, /INCIDENT I1/);
  const view = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in view);
  const waiting = view.watch.incidents.filter((item) => item.held);
  assert.deepEqual(
    waiting.map((item) => [item.name, item.quote, item.held]),
    [["Peer · L1-T1 Clean build", "src/a.ts: adds @ts-ignore", "shadow"]],
    "the card names the seat by its task, and shows the step and why it waits",
  );
});

test("a desk call the harness refused for bad JSON is recorded, though it never reached the desk", async () => {
  const { h, sup } = await laneWithPeer();
  h.beginTurn(sup);
  await h.endTurn(sup, "Opening the lane.", {
    type: "tool_call",
    callId: "c1",
    name: "mcp__team__open_lane",
    status: "failed",
    error: {
      content: "InputValidationError: mcp__team__open_lane was called with input that could not be parsed as JSON.",
    },
    detail: { type: "unknown", input: { __unparsedToolInput: { raw: '{"title": "Build"' } }, output: null },
  });
  // The call never reached the desk and no watch follows the Supervisor, so this log is its only record.
  assert.deepEqual(
    h.events("call.malformed").map(({ tool, role }) => [tool, role]),
    [["mcp__team__open_lane", "supervisor"]],
    "the Supervisor is the one role no watch follows, so this is the only way it is ever said",
  );
  assert.deepEqual(
    h.events("tool").filter((event) => !event.ok),
    [],
    "and no failed desk call was recorded, because the desk was never reached",
  );

  // Paseo hands the hook the whole session, so the next turn carries the same failed call again.
  await h.endTurn(sup, "Now the task.", {
    type: "tool_call",
    callId: "c2",
    name: "status",
    status: "completed",
    detail: {},
  });
  assert.equal(h.events("call.malformed").length, 1);

  // No letter carries it, so the panel is where it is seen.
  const view = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in view);
  assert.deepEqual(
    view.watch.trouble.map((entry) => entry.kind),
    ["call.malformed"],
  );
});

test("a lane's budget for the day holds back what is only worth attention, however many arrive at once, lane by lane, and never what is irreversible", async () => {
  const { h, sup, peer } = await laneWithPeer({ attention: { watch: true, incidentsPerLane: 1 } });
  const seat = (id: string) => ({ id, provider: "sw2-peer-claude/claude-opus-5", title: id });
  const attend = (kind: string, quote: string) => [{ kind, level: "attend" as const, quote, facts: [kind] }];
  await Promise.all([
    h.runtime.desk.notice(h.project, seat(peer), attend("test-weakened", "one")),
    h.runtime.desk.notice(h.project, seat(peer), attend("suppressed", "two")),
    h.runtime.desk.notice(h.project, seat("p-c"), attend("test-weakened", "three")),
    h.runtime.desk.notice(h.project, seat("p-d"), [
      { kind: "destructive", level: "page", quote: "rm -rf /", facts: ["destructive"] },
    ]),
  ]);
  const items = Object.values(JSON.parse(readFileSync(join(h.project.state, "incidents.json"), "utf-8")).items) as {
    kind: string;
    held?: string;
    told?: number;
    level: string;
    lane?: string;
  }[];
  const told = items
    .filter((item) => item.level === "attend" && item.told !== undefined)
    .map((item) => item.lane ?? "none")
    .sort();
  assert.deepEqual(told, ["L1", "none"], "one a day for the lane, and one for what is about no lane");
  assert.equal(items.filter((item) => item.held === "budget").length, 1);
  assert.ok(items.find((item) => item.kind === "destructive")!.told, "an irreversible act is never held for budget");
  await h.idle(sup);
  await h.idle(h.ledger().lanes.L1!.lead!);
  assert.equal(
    (
      h.agents
        .get(sup)!
        .sent.join("\n")
        .match(/INCIDENT/g) ?? []
    ).length,
    2,
  );
});
