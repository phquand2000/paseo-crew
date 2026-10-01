import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { seatBin } from "../../server/catalog/seat/launch.ts";
import { tempDir } from "../tempdir.ts";

const PLUGIN = fileURLToPath(new URL("../..", import.meta.url));
const BRANCH_REWRITES = [
  ["-d"],
  ["--delete"],
  ["--del"],
  ["-m", "moved"],
  ["--move", "moved"],
  ["--mo", "moved"],
  ["-C", "copied"],
  ["-vd"],
  ["--forc", "HEAD"],
];
const ALLOWED = [
  ["status", "--short"],
  ["branch"],
  ["branch", "-vv"],
  ["branch", "-c", "main", "copy"],
  ["branch", "aside"],
  ["branch", "--sort", "-committerdate"],
  ["worktree", "list"],
  ["log", "--oneline"],
  ["fetch", "."],
  ["fetch", ".", "+main:refs/remotes/here/main"],
];

test("a seat's shell, on the PATH the desk gives it, refuses what only the desk does however it is spelled, and runs the rest with the real git", () => {
  const root = tempDir("crew-shim-");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  const commit = (message: string) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "-am", message]);
  writeFileSync(join(root, "kept.txt"), "first\n");
  execFileSync("git", ["-C", root, "add", "kept.txt"]);
  commit("seed");
  writeFileSync(join(root, "kept.txt"), "second\n");
  commit("change");
  const state = tempDir("crew-shim-state-");
  mkdirSync(join(state, "bin"));
  writeFileSync(join(state, "bin", "hub"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const kit = loadKit(PLUGIN);
  const dir = seatBin(kit, state)!;
  assert.deepEqual(
    readdirSync(dir).sort(),
    ["git", "ssh", ...Object.keys(kit.refused)].sort(),
    "nothing the kit no longer refuses is left refusing",
  );

  const git = (...args: string[]) => spawnSync(join(dir, "git"), args, { encoding: "utf-8" });
  const refused = (...args: string[]) => {
    const ran = git(...args);
    return ran.status === 1 && /^git: refused: /.test(ran.stderr);
  };
  assert.equal(git("-C", root, "config", "alias.sw", "switch").status, 0);
  const chain = Array.from({ length: 11 }, (_, at) => [
    "-c",
    `alias.a${at}=${at === 10 ? "push" : `a${at + 1}`}`,
  ]).flat();
  const spelled: [string, string[]][] = [
    ["-C does not hide a push", ["-C", root, "push", "origin", "main"]],
    ["nor does an alias given inline", ["-c", "alias.p=push", "-C", root, "p"]],
    ["nor one kept in the repository's config", ["-C", root, "sw", "-c", "elsewhere"]],
    ["nor one opening with git's own options", ["-c", "alias.pp=-p push", "-C", root, "pp"]],
    ["nor a shell alias, whose git runs past this one", ["-c", "alias.sp=!git push", "-C", root, "sp"]],
    ["nor a chain of aliases deeper than it reads", [...chain, "-C", root, "a0"]],
    [
      "nor naming the repository by its parts",
      ["--no-pager", `--git-dir=${join(root, ".git")}`, `--work-tree=${root}`, "checkout", "-b", "x"],
    ],
    ["a pull merges as a merge does", ["-C", root, "pull", "--no-rebase", ".", "main"]],
    ["a new working copy is the desk's to make", ["-C", root, "worktree", "add", join(root, "..", "aside")]],
    ["a fetch that writes a branch moves it as update-ref does", ["-C", root, "fetch", ".", "HEAD:refs/heads/aside"]],
    ["as does one naming the branch short", ["-C", root, "fetch", ".", "+main:other"]],
    ["or mapping it with --refmap", ["-C", root, "fetch", "--refmap=+refs/heads/*:refs/heads/x/*", ".", "main"]],
    [
      "or with a remote set to fetch into branches",
      ["-c", "remote.here.url=.", "-c", "remote.here.fetch=+refs/heads/*:refs/heads/x/*", "-C", root, "fetch", "here"],
    ],
    ...BRANCH_REWRITES.map((flags): [string, string[]] => [
      `git branch ${flags.join(" ")}: the desk's record would name a branch that is gone, and git takes a long option cut short`,
      ["-C", root, "branch", flags[0]!, "main", ...flags.slice(1)],
    ]),
  ];
  for (const [why, args] of spelled) assert.ok(refused(...args), why);
  const checkout = git("-C", root, "checkout", "HEAD~1", "--", "kept.txt");
  assert.match(
    checkout.stderr,
    /git restore --source=<commit> -- <path>/,
    "a refusal names what the seat may run instead",
  );
  assert.equal(git("-C", root, "restore", "--source=HEAD~1", "--", "kept.txt").status, 0);
  assert.equal(readFileSync(join(root, "kept.txt"), "utf-8"), "first\n", "and what it names does the work");
  execFileSync("git", ["-C", root, "stash", "-q"]);
  assert.match(git("-C", root, "stash", "list").stderr, /git log -g refs\/stash/);
  assert.match(git("-C", root, "log", "-g", "--oneline", "refs/stash").stdout, /stash@\{0\}/);
  const aside = git("-C", root, "worktree", "add", join(root, "..", "old"), "HEAD~1");
  const archive = /git archive <commit> \| tar -x -C "\$\(mktemp -d\)"/;
  assert.match(aside.stderr, archive, "a refused working copy names how to read a revision whole");
  const old = tempDir("crew-shim-old-");
  execFileSync("sh", ["-c", `git -C "$0" archive HEAD~1 | tar -x -C "$1"`, root, old]);
  assert.equal(readFileSync(join(old, "kept.txt"), "utf-8"), "first\n", "and what it names does the work");
  for (const args of ALLOWED) {
    const ran = git("-C", root, ...args);
    assert.equal(ran.status, 0, `${args.join(" ")}: ${ran.stderr}`);
  }
  assert.equal(
    git("-C", root, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "work").status,
    0,
  );
  assert.match(
    git("-C", root, "log", "--oneline").stdout,
    /work\n[^\n]*change/,
    "and what it runs is the real git's doing",
  );

  const shell = (line: string) =>
    spawnSync("/bin/sh", ["-c", line], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` },
    });
  assert.match(
    shell(`git -C '${root}' push`).stderr,
    /^git: refused: git push/,
    "found by name, as a seat's shell finds it",
  );
  assert.ok(Object.keys(kit.refused).length > 0);
  for (const [name, why] of Object.entries(kit.refused)) {
    const ran = shell(`env ${name} --version`);
    assert.deepEqual(
      [ran.status, ran.stderr],
      [1, `${name}: refused: ${why}. Say what you need to whoever gave you the work.\n`],
      `${name}, looked up on PATH as the shell does, past any rule that reads only a command line's first word`,
    );
  }
});

test("a seat's git works only in its own copy of the project: the Human's checkout and other seats' copies are refused, any other repository is not", () => {
  const root = tempDir("crew-shim-own-copy-");
  const real = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  real("init", "-q", "-b", "main");
  real("commit", "-q", "--allow-empty", "-m", "seed");
  const copies = tempDir("crew-shim-copies-");
  const [mine, theirs] = [join(copies, "S0"), join(copies, "S1")];
  real("worktree", "add", "-q", "-b", "task/l1-t1", mine);
  real("worktree", "add", "-q", "-b", "task/l1-t2", theirs);
  const scratch = tempDir("crew-shim-scratch-");
  execFileSync("git", ["-C", scratch, "init", "-q"]);
  const dir = seatBin(loadKit(PLUGIN), tempDir("crew-shim-own-copy-state-"))!;
  const git = (cwd: string, ...args: string[]) =>
    spawnSync(join(dir, "git"), args, { cwd, encoding: "utf-8", env: { ...process.env, CREW_WORKTREE: mine } });
  for (const [where, cwd, args] of [
    ["its own copy", mine, ["status"]],
    ["its own copy, named from a folder inside it", join(mine, "."), ["log", "--oneline"]],
    ["a repository of its own making, as a test suite's", scratch, ["status"]],
    ["no repository at all", tempDir("crew-shim-bare-"), ["--version"]],
  ] as const) {
    const ran = git(cwd, ...args);
    assert.equal(ran.status, 0, `${where}: ${ran.stderr}`);
  }
  for (const [where, cwd, args] of [
    ["the Human's own checkout", root, ["status"]],
    ["another seat's copy", theirs, ["log"]],
    ["the Human's checkout named with -C", mine, ["-C", root, "commit", "--allow-empty", "-m", "x"]],
    ["or by its parts", mine, [`--git-dir=${join(root, ".git")}`, `--work-tree=${root}`, "status"]],
  ] as const) {
    const ran = git(cwd, ...args);
    assert.match(ran.stderr, /^git: refused: this git works in [^\n]*, not in your own copy/, where);
  }
});

test("a writing seat settles what conflicts on its task's branch through its git, where a seat that does not write is refused", () => {
  const root = tempDir("crew-shim-moves-");
  const real = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  real("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "seed\n");
  real("add", "-A");
  real("commit", "-qm", "seed");
  real("switch", "-qc", "task/l1-t1-cart");
  writeFileSync(join(root, "a.txt"), "task\n");
  real("commit", "-qam", "task");
  real("switch", "-q", "main");
  writeFileSync(join(root, "a.txt"), "base\n");
  real("commit", "-qam", "base");
  real("switch", "-q", "task/l1-t1-cart");
  const dir = seatBin(loadKit(PLUGIN), tempDir("crew-shim-moves-state-"))!;
  const git = (writes: boolean, ...args: string[]) =>
    spawnSync(join(dir, "git"), ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], {
      encoding: "utf-8",
      env: { ...process.env, ...(writes ? { CREW_WRITES: "1" } : {}) },
    });
  const refused = (writes: boolean, ...args: string[]) => /^git: refused: /.test(git(writes, ...args).stderr);

  for (const args of [
    ["merge", "main"],
    ["rebase", "main"],
    ["reset", "--hard", "main"],
    ["cherry-pick", "main"],
  ])
    assert.ok(refused(false, ...args), `a seat that does not write never moves the branch it stands on: ${args[0]}`);
  assert.notEqual(git(true, "rebase", "main").status, 0, "a rebase that stops on a conflict stops as git's own");
  assert.ok(!refused(true, "rebase", "--abort"), "and the seat may back out of it");
  assert.ok(!refused(true, "merge", "main"), "the base merged into its own branch, to settle what conflicts");
  writeFileSync(join(root, "a.txt"), "task and base\n");
  real("add", "a.txt");
  assert.equal(git(true, "commit", "-qm", "settle").status, 0);
  assert.equal(git(true, "reset", "--soft", "HEAD~1").status, 0, "its own history is its own");
  assert.ok(refused(true, "checkout", "main"), "though it still never leaves its branch");
});
