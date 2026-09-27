import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

const LIMIT = "You've hit your session limit · resets 4:30am (Asia/Saigon)";

test("a turn stopped on its agent's usage limit is not silence: no nudge, no stall, nothing struggling", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  for (const _ of [1, 2]) {
    await h.beginTurn(peer);
    await h.endTurn(peer, LIMIT, { type: "assistant_message", text: "Checking the trace next." });
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running");
  assert.doesNotMatch(h.heard(peer).join("\n"), /Your turn ended without calling done/);
  assert.doesNotMatch(h.heard(lane.lead!).join("\n"), /SILENT L1-T1/);
  assert.doesNotMatch(h.heard(sup).join("\n"), /STRUGGLING/);
  assert.deepEqual(
    h.events("seat.limited").map(({ agent, resets }) => [agent, resets]),
    [
      [peer, "4:30am (Asia/Saigon)"],
      [peer, "4:30am (Asia/Saigon)"],
    ],
  );
});
