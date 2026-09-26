import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTeam } from "../../server/catalog/team.ts";
import { DeskContext } from "../../server/desk/context.ts";
import { type Task, emptyLedger, loadLedger, saveLedger } from "../../server/desk/ledger.ts";
import type { Project } from "../../server/desk/project.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const kit = makeKit();

test("of two moves on one task the first goes through, and the second changes nothing and hears the status that stopped it", () => {
  const ctx = new DeskContext({ kit, outbox: { post: async () => "sent" }, log: () => {}, teamFor: () => resolveTeam(kit, {}), indexesFor: () => [] });
  const project: Project = { root: tempDir("sw2-context-"), slug: "p", state: tempDir("sw2-context-state-") };
  const ledger = emptyLedger();
  const task = { id: "L1-T1", lane: "L1", kind: "code", mode: "lane", title: "t", goal: "g", acceptance: ["a"], owned: ["a.ts"], outOfScope: [], status: "running", openedAt: 0, updatedAt: 0, silent: 0 } satisfies Task;
  ledger.tasks[task.id] = task;
  saveLedger(project.state, ledger);

  const accepted = ctx.moveTask(project, task.id, "accept");
  const cut = ctx.moveTask(project, task.id, "cut", (entry) => (entry.silent = 9));
  assert.equal(typeof accepted === "object" && accepted.status, "merged");
  assert.equal(cut, "merged");
  const kept = loadLedger(project.state).tasks[task.id]!;
  assert.equal(kept.status, "merged");
  assert.equal(kept.silent, 0, "what went with the refused move was not applied");
  assert.equal(ctx.moveTask(project, "L1-T9", "cut"), undefined);
});
