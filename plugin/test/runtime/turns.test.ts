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

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "sw2-turns-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  writeFileSync(join(root, "a.txt"), "one\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return root;
}

function setup(handbackOutcome: string) {
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
  const watched: { agent: string; text: string }[] = [];
  const desk = { setTask: async () => undefined, event: () => {}, post: async () => {}, supervisorFor: async () => undefined };
  const turns = new TurnRules({ kit, desk: desk as never, remember: () => {}, watch: (item: { agent: string; text: string }) => watched.push(item) });
  const ended = (text: string) =>
    turns.ended({} as never, {
      agent: { id: "seat-peer", provider: "sw2-peer-devin/swe-2-max", cwd: root, title: "peer", parentAgentId: null, workspaceId: null },
      turnId: "t1",
      outcome: { kind: "completed" },
      timeline: [{ type: "user_message", text: "go" }, { type: "assistant_message", text }],
    } as never);
  return { watched, ended };
}

const NEUTRAL = "I added the endpoint and committed it on the lane branch.";

test("a hand-back claiming completion is watched even when its words trip no cue", async () => {
  const { watched, ended } = setup("complete");
  await ended(NEUTRAL);
  assert.equal(watched.length, 1, "a complete hand-back should be watched whatever words it used");
  assert.equal(watched[0]!.agent, "seat-peer");
});

test("the words an ending uses do not decide whether it is watched", async () => {
  const { watched, ended } = setup("partial");
  await ended(NEUTRAL);
  assert.equal(watched.length, 1, "a partial hand-back reaches the Watcher, rather than being filtered out by its wording");
  assert.equal(watched[0]!.agent, "seat-peer");
});
