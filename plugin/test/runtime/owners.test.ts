import assert from "node:assert/strict";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a failed turn or a hand-back reaches the seat's owner with what that owner can do: the Lead for its Peer, whoever supervises for a Lead or once the Lead is gone", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const fail = (id: string) => {
    const seat = h.agents.get(id)!;
    return h.runtime.turnEnded({ agent: { id, provider: seat.provider, cwd: seat.cwd, title: seat.title }, turnId: `t-${id}`, outcome: { kind: "failed", error: { message: "the model is overloaded" } }, timeline: [] });
  };
  await fail(peer);
  assert.match(h.heard(lane.lead!).join("\n"), /FAILED: .* ended its turn with an error: the model is overloaded\n\nNext: Nothing restarts it: message it to continue, or cut the task and start it again\./);
  await fail(lane.lead!);
  assert.match(h.heard(sup).join("\n"), /FAILED: .* ended its turn with an error: the model is overloaded\n\nNext: Nothing restarts it: read what it did, then message the lane to continue, or drop_lane it and open it again\./);

  h.agents.get(lane.lead!)!.archivedAt = new Date().toISOString();
  h.commit(lane.worktree!, "a.txt", "done\n");
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "a.txt changed" })).ok, true);
  assert.match(h.heard(sup).join("\n"), /HANDBACK L1-T1 \(Clean build\) from [^]*Next: Its Lead is gone: replace_lead puts a new Lead on the lane, this hand-back included/);
});
