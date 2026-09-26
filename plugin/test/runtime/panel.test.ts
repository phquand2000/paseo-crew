import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { settle } from "./fake-timeline.ts";
import { laneWithPeer } from "./harness.ts";

type Booked = { kind: string; seat: string; quote: string; held?: string; told?: number; level: string; lane?: string };

const incidentsOf = (state: string) =>
  Object.values(
    (JSON.parse(readFileSync(join(state, "incidents.json"), "utf-8")) as { items: Record<string, Booked> }).items,
  );

test("with mail off a page still reaches whoever supervises, the rest is recorded and waits, and a call its harness refused is recorded though it never reached the desk", async () => {
  const { h, sup, timeline } = await laneWithPeer();
  timeline.beat("turn_started", "t1");
  const edit = {
    type: "edit",
    filePath: "src/a.ts",
    oldString: "const x = f();",
    newString: "// @ts-ignore\nconst x = f();",
  };
  timeline.add({ type: "tool_call", callId: "c1", name: "Edit", status: "completed", detail: edit }, "t1");
  const push = { type: "shell", command: "git push --force origin main" };
  timeline.add({ type: "tool_call", callId: "c2", name: "Bash", status: "running", detail: push }, "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.idle(sup);
  assert.deepEqual(
    incidentsOf(h.project.state).map((item) => [item.kind, item.held]),
    [
      ["suppressed", "shadow"],
      ["destructive", undefined],
    ],
  );
  const sent = h.agents.get(sup)!.sent.join("\n");
  assert.match(sent, /INCIDENT I2 \(destructive, page\)/, "a page is irreversible and often done already");
  assert.doesNotMatch(sent, /INCIDENT I1/);
  const held = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in held);
  assert.deepEqual(
    held.watch.incidents.filter((item) => item.held).map((item) => [item.name, item.quote, item.held]),
    [["Peer · L1-T1 Clean build", "src/a.ts: adds @ts-ignore", "shadow"]],
    "the card names the seat by its task, and shows the step and why it waits",
  );

  await h.beginTurn(sup);
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
  // No watch follows the Supervisor and the call never reached the desk, so this log is its only record.
  assert.deepEqual(
    h.events("call.malformed").map(({ tool, role }) => [tool, role]),
    [["mcp__team__open_lane", "supervisor"]],
  );
  assert.deepEqual(
    h.events("tool").filter((event) => !event.ok),
    [],
    "and no failed desk call was recorded",
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
  const view = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("watch" in view);
  assert.deepEqual(
    view.watch.trouble.map((entry) => entry.kind),
    ["call.malformed"],
    "no letter carries it, so the panel is where it is seen",
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
  const items = incidentsOf(h.project.state);
  const told = items
    .filter((item) => item.level === "attend" && item.told !== undefined)
    .map((item) => item.lane ?? "none")
    .sort();
  assert.deepEqual(told, ["L1", "none"], "one a day for the lane, and one for what is about no lane");
  const spent = items.filter((item) => item.held === "budget");
  assert.equal(spent.length, 1);
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

  // Seen again once the owner turns mail off, it is held again, for the reason it is held now.
  const read = await h.rpc(contracts.settingsRead, { project: h.project.slug });
  const saved = await h.rpc(contracts.settingsWrite, {
    project: h.project.slug,
    revision: read.revision,
    values: { attention: { watch: false } },
  });
  assert.equal(saved.status, "saved", JSON.stringify(saved));
  const [again] = spent;
  await h.runtime.desk.notice(h.project, seat(again!.seat), attend(again!.kind, again!.quote));
  assert.deepEqual(
    incidentsOf(h.project.state)
      .filter((item) => item.kind === again!.kind && item.seat === again!.seat)
      .map((item) => item.held),
    ["shadow"],
  );
});
