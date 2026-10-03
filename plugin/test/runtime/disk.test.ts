import assert from "node:assert/strict";
import { test } from "node:test";
import { loadIncidents } from "../../server/desk/store/incidents.ts";
import { laneWithPeer } from "./harness.ts";

test("under the disk's soft floor new tasks wait and the Supervisor and the Human hear once; under the hard floor a page opens", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const floors = await h.call(sup, "supervisor", "set_project", { diskFloorGiB: { soft: 20, hard: 10 } });
  assert.match(floors.text, /new tasks wait under 20 GiB free/);
  const reversed = await h.call(sup, "supervisor", "set_project", { diskFloorGiB: { soft: 5, hard: 10 } });
  assert.match(reversed.text, /^The hard floor \(10 GiB\) must be under the soft one/);
  const pagers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("crew-pager-"));
  const lows = () => h.heard(sup).filter((text) => text.startsWith("DISK LOW"));
  const diskIncident = () =>
    Object.values(loadIncidents(h.project.state).items).find((item) => item.kind === "disk-low");

  h.setFreeGiB(15);
  await h.tick();
  await h.tick();
  assert.equal(lows().length, 1, "told once while it stays under the floor");
  assert.match(pagers().at(-1)?.prompt ?? "", /15 GiB free, under its soft floor of 20 GiB/);
  assert.equal(pagers().length, 1);

  await h.call(lane.lead!, "lead", "add_tasks", {
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
  const side = () => h.ledger().tasks["L1-T2"]!;
  assert.equal(side().status, "waiting");
  assert.match(side().held?.why ?? "", /soft floor of 20 GiB/);

  h.setFreeGiB(4);
  await h.tick();
  await h.tick();
  assert.deepEqual([diskIncident()?.level, diskIncident()?.open, diskIncident()?.held], ["page", true, undefined]);
  assert.equal(pagers().length, 2, "the page reaches the Human's phone once");
  assert.match(h.heard(sup).join("\n"), /INCIDENT .*\(disk-low, page\)/);

  h.setFreeGiB(30);
  await h.tick();
  assert.equal(diskIncident()?.open, false, "closed once the disk is back over its floors");
  assert.notEqual(side().status, "waiting", "the task that waited starts");
  assert.equal(pagers().length, 2);
});
