import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const HOME = mkdtempSync(join(tmpdir(), "sw2-turns-home-"));
process.env.HOME = HOME;

const { loadKit } = await import("../../server/catalog/kit.ts");
const { emptyLedger, saveLedger } = await import("../../server/desk/ledger.ts");
const { projectOf } = await import("../../server/desk/project.ts");
const { TurnRules } = await import("../../server/runtime/turns.ts");

const kit = loadKit(join(import.meta.dirname, "..", ".."));

type Seen = { agent: string; text: string; reading: { signals: string[]; score: number; notes: string[] } };

const call = (detail: Record<string, unknown>) => ({ type: "tool_call", name: "tool", status: "completed", error: null, detail });

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "sw2-turns-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return root;
}

function setup(handbackOutcome: string, watchEveryClean = 4) {
  const root = repo();
  const project = projectOf(root);
  const ledger = emptyLedger();
  ledger.lanes.L1 = {
    id: "L1", title: "Lane", outcome: "", acceptance: [], outOfScope: [], base: "main", branch: "lane-l1",
    writeSet: [], contracts: [], lead: "seat-lead", opener: "seat-sup", status: "open", openedAt: Date.now(), tasks: 1,
  };
  ledger.tasks["L1-T1"] = {
    id: "L1-T1", lane: "L1", kind: "code", mode: "lane", title: "Task", goal: "", acceptance: [], owned: [],
    outOfScope: [], peer: "seat-peer", status: "done", openedAt: Date.now(), updatedAt: Date.now(), silent: 0,
    handback: { file: "/x.md", outcome: handbackOutcome, summary: "s", at: Date.now() },
  } as never;
  saveLedger(project.state, ledger);
  const watched: Seen[] = [];
  const desk = { setTask: async () => undefined, event: () => {}, post: async () => {}, supervisorFor: async () => undefined };
  const turns = new TurnRules({
    kit,
    desk: desk as never,
    remember: () => {},
    watch: (item: Seen) => watched.push(item),
    attention: () => ({ ...kit.attention, watchEveryClean }),
  });
  const handedBack = (status = "done") => {
    const current = emptyLedger();
    Object.assign(current, ledger);
    current.tasks["L1-T1"]!.status = status as never;
    current.agents = { "seat-peer": { id: "seat-peer", role: "peer", recordedAt: Date.now() } } as never;
    saveLedger(project.state, current);
  };
  const endedAs = (id: string, provider: string, text: string, ...calls: unknown[]) =>
    turns.ended({
      agent: { id, provider, cwd: root, title: "seat", parentAgentId: null, workspaceId: null },
      turnId: "t1",
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "go" }, ...calls, { type: "assistant_message", text }],
    } as never);
  const ended = (text: string, ...calls: unknown[]) =>
    turns.ended({
      agent: { id: "seat-peer", provider: "sw2-peer-devin/swe-2-max", cwd: root, title: "peer", parentAgentId: null, workspaceId: null },
      turnId: "t1",
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "go" }, ...calls, { type: "assistant_message", text }],
    } as never);
  return { watched, ended, endedAs, handedBack };
}

test("an ending is judged by what the turn did, however calmly it was worded", async () => {
  const { watched, ended } = setup("complete");
  await ended("All done, the tests are green.", call({ type: "shell", command: "git reset --hard origin/main" }));
  assert.equal(watched.length, 1, "an act that cannot be undone reaches the Watcher whatever the closing words said");
  assert.deepEqual(watched[0]!.reading.signals, ["destructive"]);
  assert.ok(watched[0]!.reading.notes.length > 0, "the Watcher is told what it did, not only what it said");
});

test("alarming words over a clean turn do not buy an ending the Watcher's time", async () => {
  const { watched, ended } = setup("partial");
  await ended("Hold on — actually I am not sure this is right, so I put a workaround in for now.");
  assert.equal(watched.length, 0, "word choice is not evidence; this waits its turn in the sample like any other quiet ending");
});

test("quiet endings are sampled on a budget rather than every one of them sent", async () => {
  const { watched, ended } = setup("complete", 3);
  await ended("Committed the change.");
  await ended("Committed the change.");
  assert.equal(watched.length, 0, "a healthy seat does not cost a Watcher turn every time it stops");
  await ended("Committed the change.");
  assert.equal(watched.length, 1, "a clean seat is still looked at, on a budget rather than on every turn");
});

test("the budget counts the project's endings, not one short-lived seat's", async () => {
  const { watched, ended, endedAs } = setup("complete", 3);
  await ended("Committed the change.");
  await endedAs("seat-lead", "sw2-lead-claude/claude-opus-5", "Handed the task out and waited.");
  assert.equal(watched.length, 0, "neither seat on its own reaches the budget");
  await ended("Committed the change.");
  assert.equal(watched.length, 1, "seats that each live one lane still add up to a look at the project");
});

test("the turn that hands the work back is always read, whatever the budget says", async () => {
  const { watched, ended, handedBack } = setup("complete", 50);
  handedBack();
  await ended("All acceptance cases verified. Calling done.");
  assert.equal(watched.length, 1, "the turn that claims the work is finished is the one worth reading");
});

test("a hand-back is still read when the Lead accepted it before the turn ended", async () => {
  const { watched, ended, handedBack } = setup("complete", 50);
  handedBack("merged");
  await ended("All acceptance cases verified. Calling done.");
  assert.equal(watched.length, 1, "acceptance lands seconds after the hand-back; the turn that claimed the work must not be lost to that race");
});

test("going over the same ground three times is seen even when the hand-back reads well", async () => {
  const { watched, ended } = setup("complete");
  await ended(
    "Added the helper and its tests; everything passes.",
    call({ type: "edit", filePath: "src/strings.js" }),
    call({ type: "edit", filePath: "src/strings.js" }),
    call({ type: "edit", filePath: "src/strings.js" }),
  );
  assert.equal(watched.length, 1);
  assert.deepEqual(watched[0]!.reading.signals, ["repetition"]);
});
