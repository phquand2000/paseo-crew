import assert from "node:assert/strict";
import { test } from "node:test";
import { harness, laneWithPeer } from "./harness.ts";

const LIMIT = "You've hit your session limit · resets 4:30am (Asia/Saigon)";
const MINUTE = 60_000;

/** The limit notice as Claude Code words it, resetting at `at`'s minute on Saigon's clock. */
function limitAt(at: number): string {
  const clock = new Date(at).toLocaleTimeString("en-US", {
    timeZone: "Asia/Saigon",
    hour: "numeric",
    minute: "2-digit",
  });
  return `You've hit your session limit · resets ${clock.replace(/\s/g, "").toLowerCase()} (Asia/Saigon)`;
}

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

test("a Peer on its usage limit is told to its Lead once, with who can take the work meanwhile, and woken at the reset", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const reset = Math.floor((Date.now() + 2 * 60 * MINUTE) / MINUTE) * MINUTE;
  for (const _ of [1, 2]) await h.endTurn(peer, limitAt(reset));
  const told = h.heard(lane.lead!).filter((letter) => letter.includes("LIMITED"));
  assert.equal(told.length, 1);
  assert.match(told[0]!, /stopped on its agent's usage limit, which resets \d+:\d\d[ap]m \(Asia\/Saigon\)/);
  assert.match(told[0]!, /Backup Peer \(Codex\)/);
  await h.tick(reset);
  assert.doesNotMatch(h.heard(peer).join("\n"), /LIMIT RESET/, "a few minutes' margin past the reset");
  await h.tick(reset + 5 * MINUTE);
  await h.tick(reset + 60 * MINUTE);
  assert.equal(h.heard(peer).filter((letter) => letter.includes("LIMIT RESET")).length, 1);
  await h.endTurn(peer, "Picked the trace up again.");
  await h.endTurn(peer, limitAt(reset + 24 * 60 * MINUTE));
  assert.equal(
    h.heard(lane.lead!).filter((letter) => letter.includes("LIMITED")).length,
    2,
    "a turn past the limit ends the spell",
  );
});

test("a Lead on its usage limit is told to whoever supervises and is not idle until woken; one with no reset time is not woken", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  for (const title of ["Waits", "Unread"])
    await h.call(sup, "supervisor", "open_lane", {
      title,
      outcome: "x",
      acceptance: ["a"],
      outOfScope: ["b"],
      isolate: true,
    });
  const [waits, unread] = [h.ledger().lanes.L1!.lead!, h.ledger().lanes.L2!.lead!];
  for (const lead of [waits, unread]) h.agents.get(lead)!.status = "idle";
  const reset = Math.floor((Date.now() + 2 * 60 * MINUTE) / MINUTE) * MINUTE;
  await h.endTurn(waits, limitAt(reset));
  await h.endTurn(unread, "You've hit your session limit");
  await h.tick(Date.now() + 20 * MINUTE);
  const said = h.heard(sup).join("\n");
  assert.match(said, /Every role that could take the work runs on this agent too/);
  assert.match(said, /stopped on its agent's usage limit\.\nThe desk could not read when it resets/);
  assert.doesNotMatch(said, /LANE IDLE L1/);
  await h.tick(reset + 26 * 60 * MINUTE);
  assert.match(h.heard(waits).join("\n"), /LIMIT RESET/);
  assert.doesNotMatch(h.heard(unread).join("\n"), /LIMIT RESET/);
});
