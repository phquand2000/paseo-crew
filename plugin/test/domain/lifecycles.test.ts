import assert from "node:assert/strict";
import { test } from "node:test";
import { ASK, type AskStatus } from "../../server/domain/ask.ts";
import { type Held, close, deliveryOf, hold, tell, unheard } from "../../server/domain/incident.ts";
import { LANE, type LaneStatus } from "../../server/domain/lane.ts";
import type { Lifecycle } from "../../server/domain/lifecycle.ts";
import { DECIDED, SETTLED, TASK, type TaskStatus } from "../../server/domain/task.ts";

const TASK_STATUSES: TaskStatus[] = ["waiting", "running", "done", "rework", "queued", "merging", "merged", "failed", "cut", "stalled"];

const steps = <S extends string>(life: Lifecycle<S, string>) => Object.entries(life.moves).map(([move, step]) => ({ move, ...step }));

function reached<S extends string>(life: Lifecycle<S, string>, recorded: S[]): Set<S> {
  const seen = new Set<S>(recorded);
  for (let grew = true; grew; ) {
    grew = false;
    for (const step of steps(life)) {
      if (seen.has(step.to) || !step.from.some((status) => seen.has(status))) continue;
      seen.add(step.to);
      grew = true;
    }
  }
  return seen;
}

test("only the Lead's accept puts a task in its lane: the desk merges what the Lead queued and nothing else", () => {
  const into = (status: TaskStatus) => steps(TASK).filter((step) => step.to === status && !step.from.includes(status)).map((step) => step.move);
  assert.deepEqual(into("merged"), ["accept", "merged"]);
  assert.deepEqual(into("queued"), ["queue", "requeue"]);
  assert.deepEqual(into("merging"), ["merge"]);
  assert.deepEqual(TASK.moves.merge.from, ["queued"]);
  assert.deepEqual(TASK.moves.requeue.from, ["merging"], "a merge a stop cut off goes back to where the Lead's accept put it");
  assert.deepEqual(TASK.moves.merged.from, ["merging"]);
});

test("every task status is reached from how a task is recorded, and all but a settled one has a way on", () => {
  assert.deepEqual([...reached(TASK, ["waiting", "running"])].sort(), [...TASK_STATUSES].sort());
  const stuck = TASK_STATUSES.filter((status) => !SETTLED.includes(status) && !steps(TASK).some((step) => step.from.includes(status) && step.to !== status));
  assert.deepEqual(stuck, []);
  assert.deepEqual(steps(TASK).filter((step) => step.from.includes("merged")).map((step) => step.move), [], "nothing moves a merged task");
});

test("once the Lead has decided a task, its Peer can no longer hand it back or be sent back to it, and its silence is not a stall", () => {
  for (const move of ["handBack", "rework", "stall"] as const) assert.deepEqual(TASK.moves[move].from.filter((status) => DECIDED.includes(status)), [], move);
});

test("a move the table does not allow from the status an entry has leaves the entry as it was", () => {
  const task: { status: TaskStatus } = { status: "merged" };
  assert.equal(TASK.move(task, "cut"), false);
  assert.equal(task.status, "merged");
  assert.equal(TASK.move(task, "accept"), false);
  const running: { status: TaskStatus } = { status: "running" };
  assert.equal(TASK.move(running, "handBack"), true);
  assert.equal(running.status, "done");
});

test("a lane opens or is dropped while it waits, closes or waits again once open, and stays closed", () => {
  assert.deepEqual([...reached(LANE, ["waiting", "open"])].sort(), ["closed", "open", "waiting"]);
  assert.deepEqual(steps(LANE).filter((step) => step.from.includes("closed")), []);
  const lane: { status: LaneStatus } = { status: "open" };
  assert.equal(LANE.move(lane, "drop"), false, "an open lane is closed, not dropped");
  assert.equal(LANE.move(lane, "close"), true);
  assert.equal(lane.status, "closed");
});

test("an ask is answered once", () => {
  const ask: { status: AskStatus } = { status: "open" };
  assert.equal(ASK.move(ask, "answer"), true);
  assert.equal(ASK.move(ask, "answer"), false);
  assert.equal(ask.status, "answered");
});

test("an incident is held until it is told, a letter nobody read holds it for somebody, and closing keeps whether it was told", () => {
  const fresh: { open: boolean; told?: number; held?: Held; closed?: number } = { open: true };
  assert.equal(deliveryOf(fresh), "unsent");
  assert.equal(unheard(fresh), false, "nothing was sent to go unread");
  assert.equal(hold(fresh, "budget"), true);
  assert.equal(hold(fresh, "shadow"), true, "held again, for why it is held now");
  assert.deepEqual([deliveryOf(fresh), fresh.held], ["held", "shadow"]);
  assert.equal(tell(fresh, 5), true);
  assert.deepEqual([deliveryOf(fresh), fresh.told, fresh.held], ["told", 5, undefined]);
  assert.equal(tell(fresh, 9), false, "told once");
  assert.equal(hold(fresh, "budget"), false, "a told incident is not held back");
  assert.equal(unheard(fresh), true);
  assert.deepEqual([deliveryOf(fresh), fresh.told, fresh.held], ["held", undefined, "nobody"]);
  assert.equal(close(fresh, 11), true);
  assert.equal(close(fresh, 12), false);
  assert.deepEqual([fresh.open, fresh.closed, fresh.held], [false, 11, "nobody"]);
});
