import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileKinds } from "../../server/catalog/kit.ts";
import { contains, countNumstat, diffCounts, headSha, kindOf, mergeBranch } from "../../server/core/git.ts";
import { uncovered } from "../../server/core/scope.ts";
import { advance, landLane, mergeCommit } from "../../server/core/land.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const kinds = fileKinds(makeKit());

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
  const landed = await landLane(root, "main", "lane/l1", (await headSha(root, "lane/l1"))!, { as: "ff", message: "", keep: "refs/seatworks/lanes/L1" });
  assert.equal(landed.landed, true);
  assert.equal(await headSha(root, "main"), await headSha(root, "lane/l1"));
});

/** main with a lane of two commits on it, checked out on main or not. */
async function laneOfTwo(onMain: boolean) {
  const made = repo();
  made.run("checkout", "-qb", "lane/l1");
  made.commit("b.txt", "two\n", "wip one");
  made.commit("b.txt", "two, done\n", "wip two");
  made.run("checkout", "-q", onMain ? "main" : "lane/l1");
  return { ...made, main: (await headSha(made.root, "main"))!, tip: (await headSha(made.root, "lane/l1"))! };
}

test("a lane lands squashed as one commit on main, the tree the gate saw, with its steps kept under a hidden ref", async () => {
  for (const onMain of [true, false]) {
    const { root, run, main, tip } = await laneOfTwo(onMain);
    const landed = await landLane(root, "main", "lane/l1", (await headSha(root, "lane/l1"))!, { as: "squash", message: "Cart (L1)\n\nTotals add up", keep: "refs/seatworks/lanes/L1" });
    assert.equal(landed.landed, true, landed.how);
    assert.equal(run("rev-parse", "main^").trim(), main, "one commit, straight on the main it was gated against");
    assert.equal(run("rev-parse", "main^{tree}").trim(), run("rev-parse", "lane/l1^{tree}").trim());
    assert.equal(run("log", "-1", "--format=%B", "main").trim(), "Cart (L1)\n\nTotals add up");
    assert.equal(run("rev-parse", "refs/seatworks/lanes/L1").trim(), tip);
    assert.equal(await contains(root, "main", "lane/l1"), false, "main does not carry the lane's own commits");
  }
});

test("a lane lands as a merge commit whose second parent is the lane", async () => {
  const { root, run, main, tip } = await laneOfTwo(true);
  const landed = await landLane(root, "main", "lane/l1", (await headSha(root, "lane/l1"))!, { as: "merge", message: "Cart (L1)", keep: "refs/seatworks/lanes/L1" });
  assert.equal(landed.landed, true, landed.how);
  assert.deepEqual(run("log", "-1", "--format=%P", "main").trim().split(" "), [main, tip]);
  assert.equal(run("status", "--porcelain").trim(), "", "the main copy follows its branch");
});

test("a lane that changes nothing lands without an empty commit", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l1");
  commit("a.txt", "changed\n", "try");
  commit("a.txt", "one\n", "undo");
  run("checkout", "-q", "main");
  const before = await headSha(root, "main");
  const landed = await landLane(root, "main", "lane/l1", (await headSha(root, "lane/l1"))!, { as: "squash", message: "Nothing (L1)", keep: "refs/seatworks/lanes/L1" });
  assert.equal(landed.landed, true, landed.how);
  assert.equal(await headSha(root, "main"), before);
  assert.equal(await contains(root, "refs/seatworks/lanes/L1", "lane/l1"), true, "its commits are kept all the same, so its branch can go");
});

test("a lane that does not contain main is not landed: that merge would be one no gate saw", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l2");
  commit("c.txt", "lane\n", "lane work");
  run("checkout", "-q", "main");
  commit("d.txt", "main\n", "main moved");
  const before = await headSha(root, "main");
  const landed = await landLane(root, "main", "lane/l2", (await headSha(root, "lane/l2"))!, { as: "squash", message: "x", keep: "refs/seatworks/lanes/L2" });
  assert.equal(landed.landed, false);
  assert.match(landed.how, /does not contain main/);
  assert.equal(await headSha(root, "main"), before);
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

test("lines are counted as source, tests or docs, and the files a list of paths does not cover are named", () => {
  assert.equal(kindOf("src/pricing.js", kinds), "src");
  assert.equal(kindOf("test/pricing.test.js", kinds), "test");
  assert.equal(kindOf("src/main/java/OrderServiceTest.java", kinds), "test");
  assert.equal(kindOf("docs/design.md", kinds), "docs");
  assert.equal(kindOf("pkg/cart_test.go", kinds), "test");
  assert.equal(kindOf("pkg/cart_TEST.go", kinds), "src", "a Go or Python test file's name is matched as its tools match it, case and all");
  assert.equal(kindOf("src/main/java/OrderServicetest.java", kinds), "src");
  const counts = countNumstat(["10\t2\tsrc/a.js", "5\t0\ttest/a.test.js", "3\t3\tREADME.md", ""].join("\0"), kinds);
  assert.deepEqual({ src: counts.src, test: counts.test, docs: counts.docs }, { src: 12, test: 5, docs: 6 });
  assert.deepEqual(uncovered(["src/a.js", "src/b/c.js", "lib/x.js"], ["src/a.js", "src/b/"]), ["lib/x.js"]);
  assert.deepEqual(uncovered(["src/apparel/secret.ts"], ["src/app"]), ["src/apparel/secret.ts"], "src/app covers nothing of src/apparel");
  // A write set as a Supervisor writes it: a glob from the front, and a choice of extensions.
  assert.deepEqual(uncovered(["test/cart.test.js", "src/cart.ts", "src/cart.md"], ["**/test*/**", "**/*.{js,ts}"]), ["src/cart.md"]);
});

test("a rename is counted as the two real paths it moved between, not as git's display form", async () => {
  const { root, run, commit } = repo();
  mkdirSync(join(root, "src"), { recursive: true });
  commit("src/pricing.ts", "export const rate = 1;\n".repeat(40), "pricing");
  const before = (await headSha(root))!;
  run("mv", "src/pricing.ts", "src/price.ts");
  run("commit", "-qm", "rename it");

  const counts = (await diffCounts(root, before, "HEAD", kinds))!;
  assert.deepEqual(counts.files.sort(), ["src/price.ts", "src/pricing.ts"], "both sides are real paths a seat can open");
  // A task beside others holding both sides of this rename wrote nowhere else, so its Lead must not be told it did.
  assert.deepEqual(uncovered(counts.files, ["src/pricing.ts", "src/price.ts"]), []);
});

test("a path with a character outside ASCII is read back as itself, not as git's escaped form", async () => {
  const root = tempDir("sw2-quotepath-");
  const run = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  run("init", "-q", "-b", "main");
  run("commit", "-q", "--allow-empty", "-m", "seed");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "giá-trị.ts"), "x\n");
  run("add", "-A");
  run("commit", "-qm", "add");

  const counts = (await diffCounts(root, "HEAD~1", "HEAD", kinds))!;
  assert.deepEqual(counts.files, ["src/giá-trị.ts"], "the Lead is shown the file that changed, not an octal escape of it");
  assert.equal(counts.src, 1);
  // And it is inside the paths a task holds, which the escaped form would not have been.
  assert.deepEqual(uncovered(counts.files, ["src/**"]), []);
});

test("whether a branch is already in another is answered from the branches, not from what is checked out", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l1");
  commit("b.txt", "lane\n", "lane work");
  run("checkout", "-qb", "task/l1-t1");
  commit("c.txt", "task\n", "task work");
  run("checkout", "-q", "lane/l1");
  run("merge", "-q", "--no-ff", "-m", "Merge L1-T1", "task/l1-t1");
  // main is what a plain `branch -d` would read here, and the task's work is not in main at all.
  run("checkout", "-q", "main");

  assert.equal(await contains(root, "lane/l1", "task/l1-t1"), true, "everything on the task branch is in the lane branch");
  assert.equal(await contains(root, "main", "task/l1-t1"), false);
  assert.equal(await contains(root, "lane/l1", "task/gone"), undefined, "a branch that is not there is not an answer to delete on");
});

test("a lane that moved after its gate ran lands nothing: what would land is not what was tested", async () => {
  const { root, run, commit } = repo();
  run("checkout", "-qb", "lane/l1");
  commit("b.txt", "gated\n", "what the gate saw");
  const tested = (await headSha(root, "lane/l1"))!;
  commit("b.txt", "after\n", "a commit after the gate");
  run("checkout", "-q", "main");
  const before = await headSha(root, "main");
  const landed = await landLane(root, "main", "lane/l1", tested, { as: "squash", message: "x", keep: "refs/seatworks/lanes/L1" });
  assert.equal(landed.landed, false);
  assert.match(landed.how, /moved after its gate ran/);
  assert.equal(await headSha(root, "main"), before);
});

test("base moves only from the commit it was read as, checked out or not: a landing in between is never written over", async () => {
  for (const onMain of [true, false]) {
    const { root, run, commit } = repo();
    const read = (await headSha(root, "main"))!;
    run("checkout", "-qb", "lane/l1");
    commit("b.txt", "lane\n", "lane work");
    const tip = (await headSha(root, "lane/l1"))!;
    run("checkout", "-q", "main");
    commit("c.txt", "landed first\n", "another lane landed meanwhile");
    const landedFirst = await headSha(root, "main");
    if (!onMain) run("checkout", "-q", "lane/l1");
    assert.deepEqual(await advance(root, "main", read, tip), { why: "moved" }, `on main: ${onMain}`);
    assert.equal(await headSha(root, "main"), landedFirst);
  }
});

test("a desk merge reads conflicts as git leaves them and makes its commit unsigned, whatever the Human set for rerere and signing", async () => {
  const { root, run, commit } = repo();
  run("config", "rerere.enabled", "true");
  run("config", "rerere.autoUpdate", "true");
  run("checkout", "-qb", "task/l1-t2");
  commit("a.txt", "task side\n", "task edit");
  run("checkout", "-q", "main");
  commit("a.txt", "lane side\n", "lane edit");
  // Settled once by hand: rerere records it and would settle it again by itself, leaving nothing unmerged to name.
  assert.throws(() => run("merge", "-q", "task/l1-t2"), (error: { stdout?: string }) => /CONFLICT/.test(error.stdout ?? ""));
  writeFileSync(join(root, "a.txt"), "both\n");
  run("commit", "-qam", "settled");
  run("reset", "-q", "--hard", "HEAD~1");
  const merged = await mergeBranch(root, "task/l1-t2", "Merge L1-T2");
  assert.deepEqual(merged.ok ? [] : merged.conflicts, ["a.txt"]);

  run("checkout", "-qb", "task/l1-t3");
  commit("c.txt", "c\n", "task three");
  run("checkout", "-q", "main");
  run("config", "commit.gpgSign", "true");
  run("config", "gpg.program", "false");
  assert.equal((await mergeBranch(root, "task/l1-t3", "Merge L1-T3")).ok, true, "a signer that needs the Human cannot stop a merge only the desk makes");
});

test("a merge made without a checkout has the branch's own tree and both tips for parents, and moves nothing", async () => {
  const { root, run, commit } = repo();
  const onto = (await headSha(root, "main"))!;
  run("checkout", "-qb", "task/l1-t1");
  commit("b.txt", "two\n", "task work");
  run("checkout", "-q", "main");
  const made = (await mergeCommit(root, onto, "task/l1-t1", "Merge L1-T1: Two"))!;
  assert.equal(run("rev-parse", `${made}^{tree}`).trim(), run("rev-parse", "task/l1-t1^{tree}").trim());
  assert.deepEqual(run("log", "-1", "--format=%P %an %s", made).trim(), `${onto} ${run("rev-parse", "task/l1-t1").trim()} seatworks Merge L1-T1: Two`);
  assert.equal(await headSha(root, "main"), onto, "main is where it was until something advances it");
});
