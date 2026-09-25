import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { configFile } from "../../server/desk/project.ts";
import { contracts } from "../../shared/rpc.ts";
import { asked, decide, laneWith, risky } from "./landable.ts";

test("a lane touching a path the Human asked to be asked about first waits for them: nothing lands, its Lead is told to hold still, and only the panel approves it", async () => {
  const { h, sup, lane, land, onMain } = await laneWith(risky, ["src/auth"]);
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /REPORT L1 \(Cart\): ready to land[^]*Landing it waits for the Human\. It changes src\/auth\/login\.ts, under src\/auth[^]*What the desk read of it:\n- 1 commit; 1 file, 1 line changed\./, "the Supervisor knows before it lands");
  const held = await land();
  assert.match(held.text, /Lane L1 was not landed: it waits for the Human's approval, on the Flow tab of the panel\. It changes src\/auth\/login\.ts, under src\/auth[^]*1 commit; 1 file[^]*You cannot approve it/);
  assert.equal(onMain("src/auth/login.ts"), false);
  assert.equal(h.ledger().lanes.L1!.status, "open");
  await h.idle(lane.lead!);
  const toLead = h.heard(lane.lead!).join("\n");
  assert.match(toLead, /LAND HELD L1 \(Cart\): the Human looks at it before it lands\. It changes src\/auth\/login\.ts, under src\/auth, which the Human asked to be asked about first\.[^]*Next: Commit nothing more on the lane until the Human decides\./);
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /LAND HELD/, "it asks nothing of a Lead that has stopped, so it does not wake it");
  assert.doesNotMatch(toLead, /supervisor/i);
  assert.match((await land()).text, /Lane L1 still waits for the Human's approval to land, since \d+ min ago\. It changes src\/auth\/login\.ts/);
  const status = (await h.call(sup, "supervisor", "status", {})).text;
  assert.match(status, /A landing that touches src\/auth waits for the Human \(askFirst\)\./);
  assert.match(status, /Landing waits \d+ min for the Human's approval: It changes src\/auth\/login\.ts/);
  const flow = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("lanes" in flow);
  assert.deepEqual(flow.lanes.find((entry) => entry.id === "L1")!.landApproval, {
    minutes: 0,
    approved: false,
    signals: [asked],
    evidence: ["1 commit; 1 file, 1 line changed.", "Gate: passed on the lane.", "No review of the whole lane is on record."],
  });

  assert.match(await decide(h, true, "fine, it only renames"), /Approved: Lane L1 closed; squashed lane\/l1-cart into one commit on main, its own commits kept at refs\/seatworks\/lanes\/L1\. Its Peers are archived, and its Lead agent-\d+ stays until you release it\.[^]*The Human approved it\./);
  assert.ok(onMain("src/auth/login.ts"));
  assert.deepEqual([h.ledger().lanes.L1!.status, h.ledger().lanes.L1!.landed, h.ledger().lanes.L1!.landApproval], ["closed", true, undefined]);
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /LANDED L1 \(Cart\) after the Human approved it: fine, it only renames\. Lane L1 closed/);
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /LANDED L1/, "the Human's word asks nothing more of it, so it does not wake it");
});

test("a landing the Human sends back leaves the lane open with their note for its Lead, and landing it again asks again", async () => {
  const { h, sup, lane, land } = await laneWith(risky, ["src/auth"]);
  await land();
  assert.match(await decide(h, false, "put the login change behind a flag."), /Lane L1 is sent back to its Lead/);
  assert.deepEqual([h.ledger().lanes.L1!.status, h.ledger().lanes.L1!.landApproval], ["open", undefined]);
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /LAND SENT BACK L1 \(Cart\): put the login change behind a flag\. The lane stays open\.\n\nNext: Act on the note, then report the lane ready again\./);
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /SENT BACK L1 \(Cart\) by the Human: put the login change behind a flag/);
  assert.match((await land()).text, /waits for the Human's approval/);
});

test("an approval is for the lane as it was held: a commit after it means the lane is looked at again", async () => {
  const { h, land, work, onMain } = await laneWith(risky, ["src/auth"]);
  await land();
  work({ "src/auth/session.ts": "export const session = 1;\n" });
  assert.match(await decide(h, true, ""), /Lane L1 changed after it was held, so this approval is not for what it holds now/);
  assert.equal(onMain("src/auth/login.ts"), false);
  assert.equal(h.ledger().lanes.L1!.landApproval, undefined);
  assert.match((await land()).text, /It changes src\/auth\/login\.ts, src\/auth\/session\.ts, under src\/auth/);
});

test("an approved landing that cannot happen yet stays approved, and lands when the Supervisor closes the lane again", async () => {
  const { h, sup, land, onMain } = await laneWith(risky, ["src/auth"], true);
  await land();
  // main moves on, so landing merges it in first; that merge is the desk's own and does not undo the approval.
  writeFileSync(join(h.root, "b.txt"), "main moved\n");
  h.git(h.root, "commit", "-qam", "main moved");
  writeFileSync(join(h.root, "a.txt"), "the Human is editing\n");
  assert.equal(await decide(h, true, ""), "Approved. It could not land yet: the main working copy on main has uncommitted changes. The Supervisor lands it once that is cleared.");
  assert.equal(h.ledger().lanes.L1!.landApproval?.approved !== undefined, true);
  await h.idle(sup);
  const told = h.agents.get(sup)!.sent.join("\n");
  assert.match(told, /APPROVED L1 \(Cart\) for landing by the Human, but it could not land yet: the main working copy on main has uncommitted changes\. The approval stands/);
  assert.doesNotMatch(told, /land false/, "the Human approved it: dropping the lane is not the way out offered");
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Landing approved by the Human \d+ min ago; land_lane lands it\./);
  h.git(h.root, "checkout", "--", "a.txt");
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.doesNotMatch(landed.text, /waits/);
  assert.ok(onMain("src/auth/login.ts"));
});

test("a landing held over a red gate lands over it once approved, as the Supervisor asked", async () => {
  const { h, sup, onMain } = await laneWith({ "a.txt": "one\nfour\n" }, ["a.txt"]);
  await h.call(sup, "supervisor", "set_project", { gate: "false" });
  const held = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "the Supervisor judged the red gate safe" });
  assert.match(held.text, /waits for the Human's approval[^]*Gate: failed on the lane\./);
  assert.match(await decide(h, true, ""), /Approved: Lane L1 closed[^]*over a red gate/);
  assert.ok(onMain("a.txt"));
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\nfour\n");
});

test("an approval that could not land yet does not cover a commit made after it", async () => {
  const { h, land, work, onMain } = await laneWith(risky, ["src/auth"], true);
  await land();
  writeFileSync(join(h.root, "a.txt"), "the Human is editing\n");
  await decide(h, true, "");
  h.git(h.root, "checkout", "--", "a.txt");
  work({ "a.txt": "one\nfour\n" });
  assert.match((await land()).text, /waits for the Human's approval/);
  assert.equal(onMain("src/auth/login.ts"), false);
});

test("standing orders the desk cannot read hold every landing for the Human rather than letting it through", async () => {
  const { h, land } = await laneWith({ "a.txt": "one\nfour\n" });
  writeFileSync(configFile(h.project.state), "{ not json");
  assert.match((await land()).text, /waits for the Human's approval, on the Flow tab of the panel\. The Human's standing orders cannot be read/);
  assert.doesNotMatch(h.git(h.root, "show", "main:a.txt"), /four/);
});

test("an approval stands when all a landing still lacks is its Lead's READY, and the lane lands once the Lead reports again", async () => {
  const { h, sup, lane, land, onMain } = await laneWith(risky, ["src/auth"]);
  await land();
  // As seen live: the Supervisor amends the lane while the Human reads the held landing, which undoes the READY.
  await h.call(sup, "supervisor", "amend_lane", { lane: "L1", writeSet: ["a.txt", "src/**", ".gitignore"], why: "the lane ignores its backups" });
  assert.match(await decide(h, true, ""), /^Approved\. It could not land yet: its Lead has not reported it ready as it now stands/);
  assert.ok(h.ledger().lanes.L1!.landApproval?.approved, "the Human looked at this lane as it is; only the Lead's word is missing");
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.ok(onMain("src/auth/login.ts"));
});

test("a held landing is read again when it is asked about, so it waits only on what still holds it", async () => {
  const { h, sup, land } = await laneWith(risky, ["src/auth", "a.txt"]);
  assert.match((await land()).text, /under src\/auth/);
  await h.call(sup, "supervisor", "set_project", { askFirst: ["src/auth/login.ts"] });
  const again = await land();
  assert.match(again.text, /Lane L1 still waits for the Human's approval to land, since \d+ min ago\. It changes src\/auth\/login\.ts, under src\/auth\/login\.ts/);
  assert.deepEqual(h.ledger().lanes.L1!.landApproval!.signals, ["It changes src/auth/login.ts, under src/auth/login.ts, which the Human asked to be asked about first."]);
  await h.call(sup, "supervisor", "set_project", { askFirst: [] });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.equal(h.ledger().lanes.L1!.status, "closed", "nothing the Human asked about is left in it, so nothing is left for them to look at");
});

test("a landing the Human approves twice at once lands once, and the second approval hears there is nothing left to approve", async () => {
  const { h, land } = await laneWith(risky, ["src/auth"]);
  await land();
  const once = () => h.rpc(contracts.landDecide, { project: h.project.slug, lane: "L1", approve: true, note: "fine" });
  const [first, second] = await Promise.all([once(), once()]);
  assert.deepEqual(["decided" in first, "decided" in second].sort(), [false, true]);
  assert.match("error" in first ? first.error : "error" in second ? second.error : "", /has no landing waiting for your approval/);
  assert.equal(h.events("lane.closed").length, 1, "closed once");
});
