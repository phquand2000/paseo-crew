import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { configFile } from "../../server/desk/project.ts";
import { contracts } from "../../shared/rpc.ts";
import { heldLook } from "./lane-gates.ts";
import { asked, decide, laneWith, risky } from "./landable.ts";

type Landable = Awaited<ReturnType<typeof laneWith>>;

/** main moves on and the Human edits a.txt on it, so a landing merges main in first and then cannot move main. */
function mainBusy({ h }: Landable) {
  writeFileSync(join(h.root, "b.txt"), "main moved\n");
  h.git(h.root, "commit", "-qam", "main moved");
  writeFileSync(join(h.root, "a.txt"), "the Human is editing\n");
}

test("a lane touching a path the Human asked to be asked about first waits for them: nothing lands, its Lead is told to hold still, and only the panel approves it", async () => {
  const { h, sup, lane, land, onMain } = await laneWith(risky, ["src/auth"]);
  await h.idle(sup);
  assert.match(
    h.heard(sup).join("\n"),
    /REPORT L1 \(Cart\): ready to land[^]*Landing it waits for the Human\. It changes src\/auth\/login\.ts, under src\/auth[^]*What the desk read of it:\n- 1 commit; 1 file, 1 line changed\./,
  );
  const held = await land();
  assert.match(
    held.text,
    /Lane L1 was not landed: it waits for the Human's approval, on the Flow tab of the panel\. It changes src\/auth\/login\.ts, under src\/auth[^]*1 commit; 1 file[^]*You cannot approve it/,
  );
  assert.equal(onMain("src/auth/login.ts"), false);
  assert.equal(h.ledger().lanes.L1!.status, "open");
  await h.idle(lane.lead!);
  const toLead = h.heard(lane.lead!).join("\n");
  assert.match(
    toLead,
    /LAND HELD L1 \(Cart\): the Human looks at it before it lands\. It changes src\/auth\/login\.ts, under src\/auth, which the Human asked to be asked about first\.[^]*Next: Commit nothing more on the lane until the Human decides\./,
  );
  assert.doesNotMatch(h.agents.get(lane.lead!)!.sent.join("\n"), /LAND HELD/);
  assert.doesNotMatch(toLead, /supervisor/i);
  assert.match(
    (await land()).text,
    /Lane L1 still waits for the Human's approval to land, since \d+ min ago\. It changes src\/auth\/login\.ts/,
  );
  const status = (await h.call(sup, "supervisor", "status", {})).text;
  assert.match(status, /A landing that touches src\/auth waits for the Human \(askFirst\)\./);
  assert.match(status, /Landing waits \d+ min for the Human's approval: It changes src\/auth\/login\.ts/);
  const flow = await h.rpc(contracts.flow, { project: h.project.slug });
  assert.ok("lanes" in flow);
  assert.deepEqual(flow.lanes.find((entry) => entry.id === "L1")!.landApproval, {
    minutes: 0,
    approved: false,
    signals: [asked],
    evidence: [
      "1 commit; 1 file, 1 line changed.",
      "Gate: passed on the lane.",
      "No review of the whole lane is on record.",
    ],
  });

  assert.match(
    await decide(h, true, "fine, it only renames"),
    /Approved: Lane L1 closed; squashed lane\/l1-cart into one commit on main, its own commits kept at refs\/seatworks\/lanes\/L1\. Its Peers are archived, and its Lead agent-\d+ stays until you release it\.[^]*The Human approved it\./,
  );
  assert.ok(onMain("src/auth/login.ts"));
  assert.deepEqual(
    [h.ledger().lanes.L1!.status, h.ledger().lanes.L1!.landed, h.ledger().lanes.L1!.landApproval],
    ["closed", true, undefined],
  );
  await h.idle(sup);
  assert.match(
    h.heard(sup).join("\n"),
    /LANDED L1 \(Cart\) after the Human approved it: fine, it only renames\. Lane L1 closed/,
  );
  assert.doesNotMatch(h.agents.get(sup)!.sent.join("\n"), /LANDED L1/);
});

test("a landing sent back stays open without its READY, and held again is approved as the card showed it: before a READY, over a red gate", async () => {
  const { h, sup, lane, land, onMain } = await laneWith(risky, ["src/auth"]);
  await land();
  assert.match(await decide(h, false, "put the login change behind a flag."), /Lane L1 is sent back to its Lead/);
  const back = h.ledger().lanes.L1!;
  assert.deepEqual([back.status, back.landApproval, back.ready], ["open", undefined, undefined]);
  await h.idle(lane.lead!);
  assert.match(
    h.agents.get(lane.lead!)!.sent.join("\n"),
    /LAND SENT BACK L1 \(Cart\): put the login change behind a flag\. The lane stays open\.\n\nNext: Act on the note, then report the lane ready again\./,
  );
  await h.idle(sup);
  assert.match(h.heard(sup).join("\n"), /SENT BACK L1 \(Cart\) by the Human: put the login change behind a flag/);

  await h.call(sup, "supervisor", "set_project", { gate: "false" });
  const reason = "the Supervisor judged the red gate safe";
  const held = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason });
  assert.match(held.text, /waits for the Human's approval[^]*Gate: failed on the lane\./);
  assert.match(held.text, /Its Lead has not reported it ready as it now stands/);
  assert.match(await decide(h, true, ""), /^Approved: Lane L1 closed[^]*over a red gate/);
  assert.ok(onMain("src/auth/login.ts"));
  assert.equal(h.events("lane.closed").find((event) => event.lane === "L1")?.reason, reason);
});

test("an approval is for the lane as it was held, and for what the Human asked about then", async () => {
  const landable = await laneWith(
    { "src/auth/login.ts": "export const login = 1;\n", "db/001.sql": "create table t (id int);\n" },
    ["src/auth", "**/*.sql", "infra/"],
    true,
  );
  const { h, sup, land, work, onMain } = landable;
  const askFirst = (paths: string[]) => h.call(sup, "supervisor", "set_project", { askFirst: paths });
  await land();
  assert.deepEqual(h.ledger().lanes.L1!.landApproval!.signals, [
    "It changes src/auth/login.ts, under src/auth, which the Human asked to be asked about first.",
    "It changes db/001.sql, under **/*.sql, which the Human asked to be asked about first.",
  ]);
  await askFirst(["src/auth/login.ts"]);
  assert.match(
    (await land()).text,
    /Lane L1 still waits for the Human's approval to land, since \d+ min ago\. It changes src\/auth\/login\.ts, under src\/auth\/login\.ts/,
  );
  assert.deepEqual(h.ledger().lanes.L1!.landApproval!.signals, [
    "It changes src/auth/login.ts, under src/auth/login.ts, which the Human asked to be asked about first.",
  ]);

  work({ "src/auth/session.ts": "export const session = 1;\n" });
  assert.match(
    await decide(h, true, ""),
    /Lane L1 changed after it was held, so this approval is not for what it holds now/,
  );
  assert.equal(onMain("src/auth/login.ts"), false);
  assert.equal(h.ledger().lanes.L1!.landApproval, undefined);
  await askFirst(["src/auth"]);
  assert.match((await land()).text, /It changes src\/auth\/login\.ts, src\/auth\/session\.ts, under src\/auth/);

  mainBusy(landable);
  assert.match(await decide(h, true, ""), /^Approved\. It could not land yet/);
  h.git(h.root, "checkout", "--", "a.txt");
  work({ "a.txt": "one\nfour\n" });
  assert.match((await land()).text, /waits for the Human's approval/);
  assert.equal(onMain("src/auth/login.ts"), false);

  await askFirst([]);
  const orders = configFile(h.project.state);
  const kept = readFileSync(orders, "utf-8");
  writeFileSync(orders, "{ not json");
  assert.match(
    (await land()).text,
    /The Human's standing orders cannot be read \(.*project\.json is there but could not be read.*\), so no landing goes ahead without them\./,
  );
  assert.equal(onMain("src/auth/login.ts"), false);
  writeFileSync(orders, kept);
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.equal(h.ledger().lanes.L1!.status, "closed");
});

test("an approval that cannot land yet stands through a dirty base, a hold and a missing READY; a hold calls off only a landing not yet approved", async () => {
  const landable = await laneWith(risky, ["src/auth"], true);
  const { h, sup, lane, land, onMain } = landable;
  const hold = () => h.call(sup, "supervisor", "hold_lane", { lane: "L1", reason: "a page came in" });
  const resume = () => h.call(sup, "supervisor", "resume_lane", { lane: "L1" });
  await land();
  assert.match((await hold()).text, /The landing it was waiting on is called off: land it again once it resumes\./);
  assert.equal(h.ledger().lanes.L1!.landApproval, undefined);
  await resume();
  assert.match((await land()).text, /waits for the Human's approval/);

  mainBusy(landable);
  assert.equal(
    await decide(h, true, ""),
    "Approved. It could not land yet: the main working copy on main has uncommitted changes. The Supervisor lands it once that is cleared.",
  );
  assert.ok(h.ledger().lanes.L1!.landApproval?.approved);
  await h.idle(sup);
  const told = h.heard(sup).join("\n");
  assert.match(
    told,
    /APPROVED L1 \(Cart\) for landing by the Human, but it could not land yet: the main working copy on main has uncommitted changes\. The approval stands/,
  );
  assert.doesNotMatch(told.slice(told.lastIndexOf("APPROVED L1")), /drop_lane/);
  assert.match(
    (await h.call(sup, "supervisor", "status", {})).text,
    /Landing approved by the Human \d+ min ago; land_lane lands it\./,
  );

  assert.doesNotMatch((await hold()).text, /called off/);
  await resume();
  await h.call(sup, "supervisor", "amend_lane", {
    lane: "L1",
    writeSet: ["a.txt", "src/**", ".gitignore"],
    why: "backups",
  });
  h.git(h.root, "checkout", "--", "a.txt");
  assert.match(
    (await land()).text,
    /was not landed: its Lead has not reported it ready as it now stands\. The Human's approval stands/,
  );
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.doesNotMatch(landed.text, /waits/);
  assert.ok(onMain("src/auth/login.ts"));
});

test("a landing the Human approves twice at once lands once, and the second approval hears there is nothing left to approve", async () => {
  const { h, sup, land } = await laneWith(risky, ["src/auth"]);
  await land();
  const once = () => h.rpc(contracts.landDecide, { project: h.project.slug, lane: "L1", approve: true, note: "fine" });
  const looked = heldLook(h, sup);
  const first = once();
  await looked.reached;
  assert.deepEqual(await once(), { error: "Lane L1 has no landing waiting for your approval." });
  looked.release();
  assert.ok("decided" in (await first));
  assert.equal(h.events("lane.closed").length, 1);
});
