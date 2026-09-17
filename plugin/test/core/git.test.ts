import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { countNumstat, diffCounts, headSha, kindOf, landLane, mergeBranch, outsideOwned } from "../../server/core/git.ts";
import { tempDir } from "../../server/core/testing.ts";

function repo(): { root: string; run: (...args: string[]) => string; commit: (file: string, text: string, message: string) => void } {
  const root = tempDir("sw2-git-");
  const run = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(root, file), text);
    run("add", file);
    run("commit", "-qm", message);
  };
  run("init", "-q", "-b", "main");
  commit("a.txt", "one\n", "seed");
  return { root, run, commit };
}

test("a task branch merges into the lane and main fast-forwards to it", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l1");
  run("checkout", "-qb", "task/l1-t1");
  commit("b.txt", "two\n", "task work");
  run("checkout", "-q", "lane/l1");
  const merged = await mergeBranch(root, "task/l1-t1", "Merge L1-T1");
  assert.equal(merged.ok, true);
  run("checkout", "-q", "main");
  const landed = await landLane(root, "main", "lane/l1");
  assert.equal(landed.landed, true);
  assert.equal(await headSha(root, "main"), await headSha(root, "lane/l1"));
});

test("a lane lands by merge when main moved without touching the same files", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l2");
  commit("c.txt", "lane\n", "lane work");
  run("checkout", "-q", "main");
  commit("d.txt", "main\n", "main moved");
  const landed = await landLane(root, "main", "lane/l2");
  assert.equal(landed.landed, true);
  assert.equal(run("merge-base", "--is-ancestor", "lane/l2", "main").trim(), "");
});

test("a conflicting task leaves the lane unchanged and names the files", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l1");
  run("checkout", "-qb", "task/l1-t2");
  commit("a.txt", "task side\n", "task edit");
  run("checkout", "-q", "lane/l1");
  commit("a.txt", "lane side\n", "lane edit");
  const before = await headSha(root);
  const merged = await mergeBranch(root, "task/l1-t2", "Merge L1-T2");
  assert.equal(merged.ok, false);
  assert.deepEqual(merged.ok ? [] : merged.conflicts, ["a.txt"]);
  assert.equal(await headSha(root), before);
  assert.equal(run("status", "--porcelain").trim(), "");
});

test("lines are counted as source, tests or docs, and files outside owned paths are named", () => {
  assert.equal(kindOf("src/pricing.js"), "src");
  assert.equal(kindOf("test/pricing.test.js"), "test");
  assert.equal(kindOf("src/main/java/OrderServiceTest.java"), "test");
  assert.equal(kindOf("docs/design.md"), "docs");
  const counts = countNumstat("10\t2\tsrc/a.js\n5\t0\ttest/a.test.js\n3\t3\tREADME.md\n");
  assert.deepEqual({ src: counts.src, test: counts.test, docs: counts.docs }, { src: 12, test: 5, docs: 6 });
  assert.deepEqual(outsideOwned(["src/a.js", "src/b/c.js", "lib/x.js"], ["src/a.js", "src/b/"]), ["lib/x.js"]);
});

test("a path with a character outside ASCII is read back as itself, not as git's escaped form", async () => {
  const root = mkdtempSync(join(tmpdir(), "sw2-quotepath-"));
  const run = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  run("init", "-q", "-b", "main");
  run("commit", "-q", "--allow-empty", "-m", "seed");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "giá-trị.ts"), "x\n");
  run("add", "-A");
  run("commit", "-qm", "add");

  const counts = await diffCounts(root, "HEAD~1", "HEAD");
  assert.deepEqual(counts.files, ["src/giá-trị.ts"], "the Lead is shown the file that changed, not an octal escape of it");
  assert.equal(counts.src, 1);
  // And it is inside the paths the task owned, which the escaped form would not have been.
  assert.deepEqual(outsideOwned(counts.files, ["src/**"]), []);
});
