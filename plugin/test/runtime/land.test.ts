import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { contracts } from "../../shared/rpc.ts";
import { configFile, loadConfig } from "../../server/desk/project.ts";
import { harness, laneWithPeer } from "./harness.ts";
import { settle } from "./fake-timeline.ts";

/** A lane with a gate that passes, one commit of `files` on it and a READY from its Lead between turns, whose Human asked to be asked first about `askFirst`. */
async function laneWith(files: Record<string, string>, askFirst: string[] = [], isolate = false) {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true", askFirst });
  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", acceptance: ["a"], outOfScope: ["the rest"], writeSet: ["a.txt", "src/**"], isolate });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  const work = (more: Record<string, string>) => {
    for (const [path, text] of Object.entries(more)) {
      mkdirSync(dirname(join(lane.worktree!, path)), { recursive: true });
      writeFileSync(join(lane.worktree!, path), text);
    }
    h.git(lane.worktree!, "add", "-A");
    h.git(lane.worktree!, "commit", "-qm", "work");
  };
  work(files);
  // As a lane lands in the flow: after its Lead reports it ready.
  await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  h.agents.get(lane.lead!)!.status = "idle";
  const land = () => h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  return { h, sup, lane, work, land, onMain: (path: string) => h.git(h.root, "ls-tree", "--name-only", "-r", "main").split("\n").includes(path) };
}

const risky = { "src/auth/login.ts": "export const login = 1;\n" };

const asked = "It changes src/auth/login.ts, under src/auth, which the Human asked to be asked about first.";

/** The Human's word on a held landing, as the panel sends it; what the desk answered, refusal or not. */
async function decide(h: ReturnType<typeof harness>, approve: boolean, note: string): Promise<string> {
  const answer = await h.rpc(contracts.landDecide, { project: h.project.slug, lane: "L1", approve, note });
  return "decided" in answer ? answer.decided : answer.error;
}

test("a lane touching nothing the Human asked to be asked about first lands at once, with what the desk read of it as evidence", async () => {
  const { land, onMain } = await laneWith(risky);
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.ok(onMain("src/auth/login.ts"), "a path v2 counted as risky is no reason to wait unless the Human says so");
  assert.match(landed.text, /Evidence: 1 commit; 1 file, 1 line changed\. Gate: passed on the lane\. No review of the whole lane is on record\./);
});

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

test("an open incident on a lane is evidence for whoever lands it, and never reaches the Lead it may be about", async () => {
  const { h, sup, lane, peer, timeline } = await laneWithPeer({ attention: { watch: true } });
  await h.call(sup, "supervisor", "set_project", { gate: "npm test" });
  const worktree = h.ledger().tasks["L1-T1"]!.worktree!;
  timeline.beat("turn_started", "t1");
  timeline.add({ type: "user_message", text: "Clean the build" }, "t1");
  timeline.add({ type: "tool_call", callId: "w1", name: "Edit", status: "completed", detail: { type: "edit", filePath: join(worktree, "a.txt"), oldString: "one", newString: "uno" } }, "t1");
  timeline.add({ type: "tool_call", callId: "g1", name: "Bash", status: "completed", detail: { type: "shell", command: "npm test", output: "1 failing", exitCode: 1 } }, "t1");
  await settle();
  assert.equal((await h.call(peer, "peer", "done", { outcome: "complete", summary: "done", checks: "npm test passes" })).ok, true);
  timeline.beat("turn_completed", "t1");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await h.idle(lane.lead!);
  assert.match(h.agents.get(lane.lead!)!.sent.join("\n"), /INCIDENT I\d+ \(claim-contradicted, attend\) on the Peer on L1-T1[^]*handed back as complete, but `npm test` failed the last time it ran, after the last edit/);
  const reported = await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
  assert.doesNotMatch(reported.text, /Incident|claim-contradicted/, "what reaches the Lead of its lane's record leaves incidents out");
  assert.match(h.heard(sup).join("\n"), /REPORT L1 \(Build\): ready to land[^]*- Incident I\d+ on this lane is still open: claim-contradicted\./);
  const landed = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "the Supervisor judged the red gate safe" });
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, /Incident I\d+ on this lane is still open: claim-contradicted\./);
});

test("a READY stands until the lane is amended: status says so, and the Lead must report again", async () => {
  const { h, sup, lane } = await laneWith({ "a.txt": "one\nfour\n" });
  assert.equal((await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true })).ok, true);
  assert.ok(h.ledger().lanes.L1!.ready);
  assert.match((await h.call(sup, "supervisor", "status", {})).text, /Reported ready \d+ min ago\./);
  await h.call(sup, "supervisor", "amend_lane", { lane: "L1", acceptance: ["four", "five"], why: "the Human added five" });
  assert.equal(h.ledger().lanes.L1!.ready, undefined, "what it was ready against has changed");
  assert.doesNotMatch((await h.call(sup, "supervisor", "status", {})).text, /Reported ready/);
});

test("a lane its Lead has not reported ready as it now stands lands on the Supervisor's word, with that in the evidence", async () => {
  const { h, sup, land } = await laneWith({ "a.txt": "one\nfour\n" });
  await h.call(sup, "supervisor", "amend_lane", { lane: "L1", acceptance: ["a", "b"], why: "the Human added b" });
  const landed = await land();
  assert.equal(landed.ok, true, landed.text);
  assert.match(landed.text, /Evidence: Its Lead has not reported it ready as it now stands: never, or the lane was amended since\. 1 commit/);
  assert.match(h.git(h.root, "show", "main:a.txt"), /four/);
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
  const events = readFileSync(join(h.project.state, "events.log"), "utf-8").split("\n").filter((line) => line.includes('"lane.closed"'));
  assert.equal(events.length, 1, "closed once");
});

test("a lane is landed over a red gate only with the Supervisor's reason for it", async () => {
  const { h, sup } = await laneWith({ "a.txt": "one\nfour\n" });
  await h.call(sup, "supervisor", "set_project", { gate: "false" });
  const bare = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true });
  assert.equal(bare.ok, false);
  assert.match(bare.text, /needs its reason/);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\ntwo\nthree\n", "main is as it was");
  const said = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "the failing test is the flaky one already on main" });
  assert.equal(said.ok, true, said.text);
  assert.equal(h.git(h.root, "show", "main:a.txt"), "one\nfour\n");
});

test("a lane asked to carry on the Human's branch works on it where it is, keeps their uncommitted work, and lands by its gate alone", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "test ! -f BROKEN" });
  h.git(h.root, "switch", "-qc", "fix/login");
  h.commit(h.root, "a.txt", "one\ntwo\nthree\nhalf a fix\n");
  writeFileSync(join(h.root, "b.txt"), "bee, still being edited\n");
  const main = h.git(h.root, "rev-parse", "main").trim();
  const scope = { outcome: "the login fix is finished", acceptance: ["a"], outOfScope: ["anything else in the repository"] };

  const opened = await h.call(sup, "supervisor", "open_lane", { title: "Finish the fix", ...scope, onBranch: true });
  assert.equal(opened.ok, true, opened.text);
  const lane = h.ledger().lanes.L1!;
  assert.equal(lane.branch, "fix/login", "no lane branch of its own");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login");
  assert.deepEqual(h.git(h.root, "branch", "--format=%(refname:short)").trim().split("\n").sort(), ["fix/login", "main"]);
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, still being edited\n", "the Human's uncommitted edit is where they left it");
  assert.equal(h.agents.get(lane.lead!)!.cwd, h.project.root);
  assert.match(h.agents.get(lane.lead!)!.prompt ?? "", /fix\/login, the Human's own[\s\S]*have the first task working there commit it as found, in a commit of its own/, "the Human's work in progress stays theirs, apart from the lane's");
  assert.notEqual(loadConfig(h.project.state).base, "fix/login", "a branch carried on is not made the project's base");

  const second = await h.call(sup, "supervisor", "open_lane", { title: "Also here", ...scope, onBranch: true });
  assert.equal(second.ok, false, "one checkout holds one branch, and L1 has it");
  assert.match(second.text, /L1/);

  h.commit(h.root, "b.txt", "bee, done\n");
  // What the branch held before the lane is the Human's own, so only the lane's commit is asked about.
  await h.call(sup, "supervisor", "set_project", { askFirst: ["a.txt", "b.txt"] });
  const held = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.match(held.text, /waits for the Human's approval, on the Flow tab of the panel\. It changes b\.txt, under b\.txt, which the Human asked to be asked about first\.\n/);
  await h.call(sup, "supervisor", "set_project", { askFirst: [] });
  const closed = await h.call(sup, "supervisor", "land_lane", { lane: "L1" });
  assert.equal(closed.ok, true, closed.text);
  assert.match(closed.text, /the work stays on fix\/login, the branch it carried on; nothing was merged anywhere/);
  assert.equal(h.git(h.root, "rev-parse", "main").trim(), main, "nothing was merged into main");
  assert.equal(h.git(h.root, "branch", "--show-current").trim(), "fix/login", "and the Human's copy was not switched away");
  assert.equal(readFileSync(join(h.root, "b.txt"), "utf-8"), "bee, done\n");
});

test("a lane that reaches a risk rule is rehearsed with its gate, and a red rehearsal is a red gate the Supervisor may land over", async () => {
  const { h, sup, lane, land, onMain } = await laneWith({ "src/db/001.sql": "create table t (id int);\n" });
  const rule = (paths: string[]) => ({ paths, invariant: "running it twice changes nothing", reviewQuestion: "What does a second run do?", rehearse: "false" });
  const ready = async () => {
    await h.call(lane.lead!, "lead", "report", { summary: `ready ${Date.now()}`, ready: true });
    await h.idle(sup);
    return h.heard(sup).filter((text) => text.startsWith("REPORT")).at(-1)!;
  };
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["migrations"])] });
  assert.doesNotMatch(await ready(), /rehearsing/, "a rule the lane's change does not reach is not rehearsed");
  await h.call(sup, "supervisor", "set_project", { riskRules: [rule(["src/db"])] });
  assert.match(await ready(), /Gate: true passed on the lane branch in \d+s\n\nfalse, rehearsing that running it twice changes nothing, failed with exit 1 on the lane branch\./);
  const refused = await land();
  assert.equal(refused.ok, false);
  assert.match(refused.text, /false, rehearsing that running it twice changes nothing, failed with exit 1[^]*land_lane it over the gate with overGate true and your reason/);
  const over = await h.call(sup, "supervisor", "land_lane", { lane: "L1", overGate: true, reason: "the rehearsal is known broken" });
  assert.equal(over.ok, true, over.text);
  assert.ok(onMain("src/db/001.sql"));
});

test("two lanes landed at once each stay on the base: a landing never erases another", async () => {
  const h = harness();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { gate: "true" });
  for (const [title, file] of [["Cart", "cart.txt"], ["Order", "order.txt"]] as const) {
    const opened = await h.call(sup, "supervisor", "open_lane", { title, outcome: title, acceptance: ["a"], outOfScope: ["the rest"], writeSet: [file], isolate: true });
    assert.equal(opened.ok, true, opened.text);
    const lane = Object.values(h.ledger().lanes).find((entry) => entry.title === title)!;
    writeFileSync(join(lane.worktree!, file), `${title}\n`);
    h.git(lane.worktree!, "add", "-A");
    h.git(lane.worktree!, "commit", "-qm", title);
    await h.call(lane.lead!, "lead", "report", { summary: "done", ready: true });
    h.agents.get(lane.lead!)!.status = "idle";
  }
  // The Human works on a branch of their own, so the base is checked out nowhere and moves by its ref alone.
  h.git(h.root, "switch", "-qc", "human-work");
  const replies = await Promise.all(["L1", "L2"].map((lane) => h.call(sup, "supervisor", "land_lane", { lane })));
  const onMain = h.git(h.root, "ls-tree", "--name-only", "-r", "main").split("\n");
  assert.deepEqual(replies.map((reply) => reply.ok), [true, true], "the second waits for the first, then brings in what it landed: " + replies.map((reply) => reply.text).join("\n"));
  assert.deepEqual(["cart.txt", "order.txt"].filter((file) => onMain.includes(file)), ["cart.txt", "order.txt"], "and main has the work of both");
});
