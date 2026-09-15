import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runGate } from "../core/gate.ts";
import { issueArgs } from "../desk/issue.ts";
import { type Lane, type Task, emptyLedger, nextAskId, nextLaneId, nextTaskId, slugify } from "../desk/ledger.ts";
import { letters } from "../desk/letters.ts";
import { takeRequests, writeReply } from "./spool.ts";
import { tempDir } from "../core/testing.ts";
import { fillCommand, parseVerdicts } from "./watcher.ts";

const lane: Lane = {
  id: "L1",
  title: "Discounts",
  outcome: "Orders apply a percentage discount",
  acceptance: ["a 10% code lowers the total"],
  outOfScope: [],
  base: "main",
  branch: "lane/l1-discounts",
  writeSet: [],
  contracts: [],
  opener: "sup",
  status: "open",
  openedAt: 0,
  tasks: 1,
};
const task: Task = {
  id: "L1-T1",
  lane: "L1",
  kind: "code",
  mode: "lane",
  title: "Apply discount",
  goal: "Totals reflect the code",
  acceptance: ["10% off"],
  owned: ["src/pricing.js"],
  outOfScope: [],
  branch: "task/l1-t1-apply-discount",
  status: "running",
  openedAt: 0,
  updatedAt: 0,
  silent: 0,
};

test("ids count per ledger and per lane, and titles become branch slugs", () => {
  const ledger = emptyLedger();
  const id = nextLaneId(ledger);
  const entry = { ...lane, id, tasks: 0 };
  assert.equal(id, "L1");
  assert.equal(nextTaskId(ledger, entry, "code"), "L1-T1");
  assert.equal(nextTaskId(ledger, entry, "review"), "L1-R2");
  assert.equal(nextAskId(ledger), "A1");
  assert.equal(slugify("Add Discount Codes: 10% off!", 24), "add-discount-codes-10-of");
});

test("what a Peer and a Lead read carries none of the words hidden from them", () => {
  const peerText = [letters.brief(task, lane), letters.rework("fix it"), letters.cut("wrong"), letters.nudge("done"), letters.message("your lead", "hi"), letters.reviewBrief({ ...task, id: "L1-R2", kind: "review" }, task, "Is rounding right?", lane.branch)].join("\n");
  for (const word of ["paseo", "supervisor", "watcher", "seat"]) assert.equal(new RegExp(`\\b${word}\\b`, "i").test(peerText), false, word);
  const leadText = [letters.directive(lane), letters.conflict(task, ["a.js"], lane.branch), letters.stalled(task, "bye"), letters.copied(task, "x")].join("\n");
  for (const word of ["supervisor", "watcher"]) assert.equal(new RegExp(`\\b${word}\\b`, "i").test(leadText), false, word);
});

test("watcher output parses to one verdict per ending and ignores noise", () => {
  const output = "Working...\n1 unheard-wait | \"once that lands I'll dispatch\"\n2. normal | done\n**3 wrong-premise** | turns out V9 is missing\n3 normal | duplicate\n9 struggle | out of range\n";
  assert.deepEqual(
    parseVerdicts(output, 3).map((verdict) => verdict.label),
    ["unheard-wait", "normal", "wrong-premise"],
  );
  assert.deepEqual(fillCommand(["devin", "--model", "{model}", "--prompt-file", "{promptFile}"], { model: "swe", promptFile: "/p" }), ["devin", "--model", "swe", "--prompt-file", "/p"]);
});

test("issue references resolve to gh arguments", () => {
  assert.deepEqual(issueArgs("#12"), ["issue", "view", "12"]);
  assert.deepEqual(issueArgs("acme/shop#7"), ["issue", "view", "7", "-R", "acme/shop"]);
  assert.deepEqual(issueArgs("https://github.com/acme/shop/issues/9"), ["issue", "view", "9", "-R", "acme/shop"]);
  assert.equal(issueArgs("fix the bug"), undefined);
});

test("the spool hands each request over once and replies by id", () => {
  const spool = tempDir("sw2-spool-");
  const request = { id: "r1", agent: "a", role: "peer", tool: "done", args: {}, cwd: "/", at: Date.now() };
  writeReply(spool, "warmup", { ok: true, text: "" });
  writeFileSync(join(spool, "requests", "r1.json"), JSON.stringify(request));
  assert.deepEqual(takeRequests(spool).map((entry) => entry.id), ["r1"]);
  assert.deepEqual(takeRequests(spool), []);
  writeReply(spool, "r1", { ok: true, text: "handed back" });
  assert.equal(JSON.parse(readFileSync(join(spool, "replies", "r1.json"), "utf-8")).text, "handed back");
});

test("the gate reports exit, output tail and timeouts", async () => {
  const dir = tempDir("sw2-gate-");
  const pass = await runGate("echo ok", dir, join(dir, "g1.log"), 10_000);
  assert.equal(pass.ok, true);
  assert.match(pass.tail, /ok/);
  const fail = await runGate("echo broken >&2; exit 3", dir, join(dir, "g2.log"), 10_000);
  assert.deepEqual([fail.ok, fail.code], [false, 3]);
  const slow = await runGate("sleep 5", dir, join(dir, "g3.log"), 300);
  assert.deepEqual([slow.ok, slow.timedOut], [false, true]);
  assert.equal(existsSync(join(dir, "g3.log")), true);
});
