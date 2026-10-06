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

test("a turn stopped on its usage limit is not silence: no nudge, no stall", async () => {
  const { h, lane, peer } = await laneWithPeer();
  for (const _ of [1, 2]) {
    await h.beginTurn(peer);
    await h.endTurn(peer, LIMIT, { type: "assistant_message", text: "Checking the trace next." });
  }
  assert.equal(h.ledger().tasks["L1-T1"]!.status, "running");
  assert.doesNotMatch(h.heard(peer).join("\n"), /You stopped without calling done/);
  assert.doesNotMatch(h.heard(lane.lead!).join("\n"), /SILENT L1-T1/);
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
  assert.match(told[0]!, /stopped on its usage limit, which resets \d+:\d\d[ap]m \(Asia\/Saigon\)/);
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
  assert.match(said, /Backup Lead \(Codex\)/);
  assert.match(said, /stopped on its usage limit\.\nThe desk could not read when it resets/);
  assert.doesNotMatch(said, /LANE IDLE L1/);
  await h.tick(reset + 26 * 60 * MINUTE);
  assert.match(h.heard(waits).join("\n"), /LIMIT RESET/);
  assert.doesNotMatch(h.heard(unread).join("\n"), /LIMIT RESET/);
});

test("a Lead on its usage limit with a hand-back waiting can be replaced on another agent, and is let go", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "built" })).ok, true);
  h.agents.get(lane.lead!)!.status = "idle";
  await h.endTurn(lane.lead!, limitAt(Math.floor((Date.now() + 2 * 60 * MINUTE) / MINUTE) * MINUTE));
  await h.tick(Date.now() + 20 * MINUTE);
  assert.match(
    h.heard(sup).join("\n"),
    /Waiting on it: L1-T1's hand-back\.[^]*Next: If the lane cannot wait for the reset, replace_lead with a role named above/,
  );
  const replaced = await h.call(sup, "supervisor", "replace_lead", { lane: "L1", role: "backup-lead" });
  assert.equal(replaced.ok, true, replaced.text);
  assert.match(replaced.text, /stopped on its usage limit, is let go\./);
  const now = h.ledger().lanes.L1!.lead!;
  assert.notEqual(now, lane.lead);
  assert.equal(h.agents.get(now)!.labels?.["crew.role"], "backup-lead");
  assert.ok(h.agents.get(lane.lead!)!.archivedAt);
});

test("a Supervisor on its usage limit pages the Human once a spell, naming what waits on it", async () => {
  const { h, sup, lane } = await laneWithPeer();
  const asked = await h.call(lane.lead!, "lead", "ask", {
    kind: "need",
    text: "Which port the bridge uses.",
    default: "7447",
  });
  assert.equal(asked.ok, true, asked.text);
  const pagers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("crew-pager-"));
  const reset = Math.floor((Date.now() + 2 * 60 * MINUTE) / MINUTE) * MINUTE;
  for (const _ of [1, 2]) await h.endTurn(sup, limitAt(reset));
  assert.equal(pagers().length, 1);
  assert.match(
    pagers()[0]!.prompt ?? "",
    /its Supervisor stopped on its usage limit until \d+:\d\d[ap]m \(Asia\/Saigon\); 1 ask waits on it\.\nSeat a Supervisor on another agent, or wait\./,
  );
});

const BUSY = "unexpected status 503 Service Unavailable: No available accounts";
const SIGNED_OUT = "unexpected status 401 Unauthorized: Not authenticated. Please login first";

/** A turn that ended on an error, as Paseo hands it over when the agent's provider refuses it. */
function failTurn(h: Awaited<ReturnType<typeof laneWithPeer>>["h"], id: string, message: string) {
  const seat = h.agents.get(id)!;
  return h.runtime.turnEnded({
    agent: { id, provider: seat.provider, cwd: seat.cwd, title: seat.title },
    turnId: `t-${id}-${Math.random()}`,
    outcome: { kind: "failed", error: { message } },
    timeline: [],
  });
}

test("a turn the provider turned away for a moment is sent again once; refused again, it goes to the seat's Lead", async () => {
  const { h, lane, peer } = await laneWithPeer();
  const retries = () => h.heard(peer).filter((letter) => letter.includes("RETRY")).length;
  await failTurn(h, peer, BUSY);
  assert.equal(retries(), 1);
  assert.doesNotMatch(h.heard(lane.lead!).join("\n"), /FAILED/);
  await failTurn(h, peer, BUSY);
  assert.equal(retries(), 1);
  assert.match(h.heard(lane.lead!).join("\n"), /FAILED: .* No available accounts/);
  await h.endTurn(peer, "Back on the build.");
  await failTurn(h, peer, BUSY);
  assert.equal(retries(), 2, "a turn that went through earns the next refusal its own retry");
});

test("an agent signed out of its provider pages the Human once a spell, and each owner hears a fresh seat fails the same way", async () => {
  const { h, sup, lane, peer } = await laneWithPeer();
  const pagers = () => [...h.agents.values()].filter((agent) => agent.provider.startsWith("crew-pager-"));
  await failTurn(h, peer, SIGNED_OUT);
  await failTurn(h, lane.lead!, SIGNED_OUT);
  assert.equal(pagers().length, 1);
  assert.match(
    pagers()[0]!.prompt ?? "",
    /Claude Code's model provider refuses its sign-in \(401\), so its seats stop\./,
  );
  for (const owner of [lane.lead!, sup])
    assert.match(
      h.heard(owner).join("\n"),
      /FAILED: [^]*a fresh seat on that agent fails the same way until they sign it in/,
    );
  await h.endTurn(peer, "Signed in again; back on the build.");
  await failTurn(h, peer, SIGNED_OUT);
  assert.equal(pagers().length, 2, "a turn that went through ends the spell");
});
