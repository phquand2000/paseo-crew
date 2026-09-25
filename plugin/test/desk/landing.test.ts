import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { makeKit } from "../kit.ts";
import { saveIncidents } from "../../server/desk/incidents.ts";
import { type Lane, type Task, emptyLedger } from "../../server/desk/ledger.ts";
import { askFirstHits, changeOf, landFacts } from "../../server/desk/landing.ts";
import { type Project, configFile, loadConfig, saveConfig } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";

const passed = { set: true, ok: true };
const kit = makeKit();

/** A repository whose main holds a test with two assertions, and a lane branch the test writes on. */
function shop() {
  const root = tempDir("sw2-landing-");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("src/cart.ts", "export const total = 1;\n");
  write("test/cart.test.ts", "assert.equal(total, 1);\nassert.ok(total);\n");
  write("test/old.test.ts", "assert.ok(true);\n");
  write("package-lock.json", "{}\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "seed");
  git("checkout", "-qb", "lane/l1");
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "work");
  };
  const project: Project = { root, slug: "shop-abc123", state: tempDir("sw2-landing-state-") };
  const lane = { id: "L1", title: "Cart", outcome: "a cart", acceptance: [], outOfScope: [], base: "main", branch: "lane/l1", writeSet: ["src/**", "test/**"], contracts: [], opener: "sup", status: "open", openedAt: 0, tasks: 0, ready: { at: 0 } } as unknown as Lane;
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane;
  const asksFirst = (paths: string[]) => saveConfig(project.state, { ...loadConfig(project.state), askFirst: paths });
  return { root, git, write, commit, project, lane, ledger, asksFirst };
}

const task = (id: string, extra: Partial<Task>): Task =>
  ({ id, lane: "L1", kind: "code", mode: "lane", title: `Task ${id}`, goal: "", acceptance: [], hints: [], holds: [], outOfScope: [], status: "merged", openedAt: 0, updatedAt: 0, silent: 0, ...extra }) as Task;

test("a lane brings what it changed since it left its base, however far the base has moved since, and the gate", async () => {
  const { git, write, commit, project, lane, ledger } = shop();
  write("src/cart.ts", "export const total = 2;\n");
  write("test/cart.test.ts", "assert.equal(total, 2);\nassert.ok(total);\nassert.ok(total > 0);\n");
  commit();
  git("checkout", "-q", "main");
  write("src/other.ts", "export const other = 1;\n");
  commit();
  git("checkout", "-q", "lane/l1");
  const change = await changeOf(project, lane);
  assert.deepEqual(change.files, ["src/cart.ts", "test/cart.test.ts"], "main's own change since is not the lane's");
  assert.deepEqual(await landFacts(kit, project, ledger, lane, change, passed), ["1 commit; 2 files, 5 lines changed.", "Gate: passed on the lane.", "Tests changed: test/cart.test.ts.", "No review of the whole lane is on record."]);
  assert.deepEqual(await landFacts(kit, project, ledger, lane, change, { set: false, ok: true }), ["1 commit; 2 files, 5 lines changed.", "Gate: none set, so nothing ran the lane's checks.", "Tests changed: test/cart.test.ts.", "No review of the whole lane is on record."]);
});

test("everything the desk reads of a lane goes with it as evidence, and none of it holds the landing", async () => {
  const { root, write, commit, project, lane, ledger } = shop();
  write("test/cart.test.ts", "assert.equal(total, 1);\nit.skip('later', () => {});\n");
  rmSync(join(root, "test/old.test.ts"));
  write("src/auth/login.ts", "export const login = 1;\n");
  write("docs/notes.md", "x\n".repeat(600));
  write("package-lock.json", `${"{}\n".repeat(900)}`);
  commit();
  ledger.tasks["L1-T1"] = task("L1-T1", { handback: { file: "", outcome: "complete", summary: "", at: 0, gate: { ok: false, note: "npm test: the gate failed with exit 1" } } });
  ledger.tasks["L1-R1"] = task("L1-R1", { kind: "review", status: "done", handback: { file: "", outcome: "changes", summary: "", at: 0 } });
  saveIncidents(project.state, {
    next: 3,
    items: {
      I1: { id: "I1", seat: "peer-1", where: "w", lane: "L1", task: "L1-T1", kind: "test-weakened", level: "attend", quote: "q", facts: [], opened: 0, last: 0, count: 1, open: true },
      I2: { id: "I2", seat: "peer-2", where: "w", lane: "L2", kind: "destructive", level: "page", quote: "q", facts: [], opened: 0, last: 0, count: 1, open: true },
    },
  });
  const change = await changeOf(project, lane);
  assert.deepEqual(askFirstHits(project, change), [], "a project whose Human asked to be asked about nothing lands everything the Supervisor lands");
  assert.deepEqual(await landFacts(kit, project, ledger, lane, change, { set: true, ok: false }), [
    "1 commit; 5 files, 604 lines changed.",
    "Gate: failed on the lane.",
    "Tests changed: test/cart.test.ts, test/old.test.ts.",
    "test/old.test.ts is deleted.",
    "test/cart.test.ts: adds a skip marker.",
    "docs/notes.md is outside the lane's write set, src/**, test/**.",
    "package-lock.json is outside the lane's write set, src/**, test/**.",
    "L1-T1 was accepted over its red gate: npm test: the gate failed with exit 1.",
    "Incident I1 on this lane is still open: test-weakened.",
    "L1-R1 review: changes.",
    "The lane's latest review, L1-R1, ended in changes, and nothing was accepted after it.",
  ]);
});

test("a landing waits for the Human only where it changes a path they asked to be asked about first", async () => {
  const { write, commit, project, lane, asksFirst } = shop();
  write("src/auth/login.ts", "export const login = 1;\n");
  write("src/authors.ts", "export const authors = [];\n");
  write("db/001.sql", "create table t (id int);\n");
  commit();
  asksFirst(["src/auth", "**/*.sql", "infra/"]);
  assert.deepEqual(askFirstHits(project, await changeOf(project, lane)), [
    "It changes src/auth/login.ts, under src/auth, which the Human asked to be asked about first.",
    "It changes db/001.sql, under **/*.sql, which the Human asked to be asked about first.",
  ], "a plain path covers what is under it, and only on a path boundary");
});

test("standing orders the desk cannot read hold every landing for the Human rather than letting it through", async () => {
  const { write, commit, project, lane } = shop();
  write("src/cart.ts", "export const total = 5;\n");
  commit();
  mkdirSync(project.state, { recursive: true });
  writeFileSync(configFile(project.state), "{ not json");
  assert.match(askFirstHits(project, await changeOf(project, lane)).join("\n"), /^The Human's standing orders cannot be read \(.*project\.json is there but could not be read.*\), so no landing goes ahead without them\.$/);
});

test("a lane carried on a branch with history of its own brings only what it did there", async () => {
  const { git, write, commit, project, lane, asksFirst } = shop();
  write("src/auth/old.ts", "export const old = 1;\n");
  commit();
  const onBranch = { ...lane, onBranch: true, base: "lane/l1", startSha: git("rev-parse", "HEAD").trim() } as Lane;
  write("src/cart.ts", "export const total = 6;\n");
  commit();
  asksFirst(["src/auth"]);
  const change = await changeOf(project, onBranch);
  assert.deepEqual(change.files, ["src/cart.ts"], "the branch's commits from before the lane are the Human's, not the lane's");
  assert.deepEqual(askFirstHits(project, change), []);
});
