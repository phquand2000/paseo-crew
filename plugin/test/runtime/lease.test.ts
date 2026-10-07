import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";
import { hookAgent } from "./noticed.ts";

test("a lease queues seats in order and goes on when released, when a turn is stopped, when it runs out or its seat goes", async () => {
  const { h, lane, peer: first } = await laneWithPeer();
  const lead = lane.lead!;
  await h.call(lead, "lead", "add_tasks", {
    tasks: [
      {
        key: "b",
        title: "Side",
        goal: "g",
        acceptance: ["a"],
        hints: ["b.txt"],
        outOfScope: ["x"],
        holds: ["b.txt"],
        parallel: true,
      },
    ],
  });
  await h.tick();
  const second = h.ledger().tasks["L1-T2"]!.peer!;
  const lease = (id: string, role: string, args: Record<string, unknown>) => h.call(id, role, "lease", args);

  assert.match((await lease(first, "peer", { resource: " Board ", minutes: 20 })).text, /^You hold board until/);
  const queued = await lease(second, "peer", { resource: "board" });
  assert.match(
    queued.text,
    new RegExp(`^peer ${first} \\(L1-T1\\) holds board until .*; you are number 1 in its queue`),
  );
  assert.match((await lease(lead, "lead", { resource: "board", minutes: 10 })).text, /you are number 2 in its queue/);

  assert.equal((await lease(first, "peer", { resource: "board", release: true })).ok, true);
  assert.match(h.heard(second).join("\n"), /LEASE board: it is yours now/);
  const status = await h.call(lead, "lead", "status", {});
  assert.match(
    status.text,
    new RegExp(`## Leases\\n\\n- board: peer ${second} \\(L1-T2\\) since .*; waiting: lead ${lead}`),
  );

  const turnId = "t-cut";
  await h.runtime.turnEnded({ agent: hookAgent(h, second), turnId, outcome: { kind: "canceled" }, timeline: [] });
  assert.match(h.heard(second).join("\n"), /LEASE ENDED board: your work was stopped\. It is no longer yours\./);
  assert.match(h.heard(lead).join("\n"), /LEASE board: it is yours now/);

  await lease(first, "peer", { resource: "board" });
  await h.tick(Date.now() + 11 * 60_000);
  assert.match(h.heard(lead).join("\n"), /LEASE ENDED board: its time ran out\./);
  assert.match(h.heard(first).join("\n"), /LEASE board: it is yours now/);

  await lease(second, "peer", { resource: "board" });
  await h.runtime.archived(hookAgent(h, first));
  assert.equal(h.ledger().leases?.board?.holder, second, "the seat that waited holds it once the holder is gone");
  assert.deepEqual(
    h.events("lease.released").map((event) => event.why),
    ["released", "cut", "expired", "archived"],
  );
});
