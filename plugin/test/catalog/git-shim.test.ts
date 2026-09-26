import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { seatBin } from "../../server/catalog/launch.ts";
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
];

test("a seat's shell, on the PATH the desk gives it, refuses what only the desk does however it is spelled, and runs the rest with the real git", () => {
  const root = tempDir("sw2-shim-");
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@x",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "seed",
  ]);
  const state = tempDir("sw2-shim-state-");
  mkdirSync(join(state, "bin"));
  writeFileSync(join(state, "bin", "hub"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const kit = loadKit(PLUGIN);
  const dir = seatBin(kit, state)!;
  assert.deepEqual(
    readdirSync(dir).sort(),
    ["git", ...Object.keys(kit.refused)].sort(),
    "nothing the kit no longer refuses is left refusing",
  );

  const git = (...args: string[]) => spawnSync(join(dir, "git"), args, { encoding: "utf-8" });
  const refused = (...args: string[]) => {
    const ran = git(...args);
    return ran.status === 1 && /^git: refused: /.test(ran.stderr);
  };
  assert.equal(git("-C", root, "config", "alias.sw", "switch").status, 0);
  const spelled: [string, string[]][] = [
    ["-C does not hide a push", ["-C", root, "push", "origin", "main"]],
    ["nor does an alias given inline", ["-c", "alias.p=push", "-C", root, "p"]],
    ["nor one kept in the repository's config", ["-C", root, "sw", "-c", "elsewhere"]],
    [
      "nor naming the repository by its parts",
      ["--no-pager", `--git-dir=${join(root, ".git")}`, `--work-tree=${root}`, "checkout", "-b", "x"],
    ],
    ["a pull merges as a merge does", ["-C", root, "pull", "--no-rebase", ".", "main"]],
    ["a new working copy is the desk's to make", ["-C", root, "worktree", "add", join(root, "..", "aside")]],
    ...BRANCH_REWRITES.map((flags): [string, string[]] => [
      `git branch ${flags.join(" ")}: the desk's record would name a branch that is gone, and git takes a long option cut short`,
      ["-C", root, "branch", flags[0]!, "main", ...flags.slice(1)],
    ]),
  ];
  for (const [why, args] of spelled) assert.ok(refused(...args), why);
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
    /work\n[^\n]*seed/,
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
