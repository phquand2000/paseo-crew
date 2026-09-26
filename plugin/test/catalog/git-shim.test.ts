import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit.ts";
import { seatBin } from "../../server/catalog/launch.ts";
import { tempDir } from "../tempdir.ts";

const plugin = fileURLToPath(new URL("../..", import.meta.url));
const git = (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "git")).find((path) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
})!;

/** A repository with one commit on main, and a way to run a command in it as a seat's git. */
function repo() {
  const root = tempDir("sw2-shim-");
  execFileSync(git, ["-C", root, "init", "-q", "-b", "main"]);
  execFileSync(git, ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "seed"]);
  const run = (bin: string[], ...args: string[]) => spawnSync(bin[0]!, [...bin.slice(1), ...args], { encoding: "utf-8" });
  return { root, run };
}

test("a seat's git refuses what only the desk does to branches and copies, however it is spelled, and runs the rest", () => {
  const { root, run } = repo();
  const shim = ["node", join(plugin, "bin", "git-shim.mjs"), git];
  const refused = (...args: string[]) => {
    const ran = run(shim, ...args);
    return ran.status === 1 && /^git: refused: /.test(ran.stderr);
  };
  assert.ok(refused("-C", root, "push", "origin", "main"), "-C does not hide a push");
  assert.ok(refused("-c", "alias.p=push", "-C", root, "p"), "nor does an alias given inline");
  assert.equal(run(shim, "-C", root, "config", "alias.sw", "switch").status, 0);
  assert.ok(refused("-C", root, "sw", "-c", "elsewhere"), "nor one kept in the repository's config");
  assert.ok(refused("--no-pager", `--git-dir=${join(root, ".git")}`, `--work-tree=${root}`, "checkout", "-b", "x"));
  assert.ok(refused("-C", root, "branch", "-D", "main"));
  // A pull is a merge, and deleting, renaming or overwriting a branch leaves the desk's record naming one that is gone; git takes a long option cut short.
  assert.ok(refused("-C", root, "pull", "--no-rebase", ".", "main"), "a pull merges as a merge does");
  for (const flags of [["-d"], ["--delete"], ["--del"], ["-m", "moved"], ["--move", "moved"], ["--mo", "moved"], ["-C", "copied"], ["-vd"], ["--forc", "HEAD"]]) assert.ok(refused("-C", root, "branch", ...flags.slice(0, 1), "main", ...flags.slice(1)), `git branch ${flags[0]}`);
  assert.ok(refused("-C", root, "worktree", "add", join(root, "..", "aside")));
  for (const allowed of [["status", "--short"], ["branch"], ["branch", "-vv"], ["branch", "-c", "main", "copy"], ["branch", "aside"], ["branch", "--sort", "-committerdate"], ["worktree", "list"], ["log", "--oneline"]]) {
    const ran = run(shim, "-C", root, ...allowed);
    assert.equal(ran.status, 0, `${allowed.join(" ")}: ${ran.stderr}`);
  }
  assert.equal(run(shim, "-C", root, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "work").status, 0);
  assert.match(run(shim, "-C", root, "log", "--oneline").stdout, /work\n[^\n]*seed/, "and what it runs is the real git's doing");
});

test("every seat's PATH starts at a launcher named git that runs the shim with the real git, and at one for each command the kit refuses", () => {
  const { root, run } = repo();
  const state = tempDir("sw2-shim-state-");
  mkdirSync(join(state, "bin"));
  writeFileSync(join(state, "bin", "hub"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const kit = loadKit(plugin);
  const dir = seatBin(kit, state)!;
  assert.ok(dir);
  assert.equal(run([join(dir, "git")], "-C", root, "push").status, 1);
  assert.equal(run([join(dir, "git")], "-C", root, "status").status, 0);
  const shell = (line: string) => spawnSync("/bin/sh", ["-c", line], { encoding: "utf-8", env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` } });
  assert.match(shell(`git -C '${root}' push`).stderr, /^git: refused: git push/, "found by name, as a seat's shell finds it");
  assert.ok(Object.keys(kit.refused).length > 0);
  for (const [name, why] of Object.entries(kit.refused)) {
    // `env` looks a command up on PATH as the shell does, past any rule that reads only the command line's first word.
    const ran = shell(`env ${name} --version`);
    assert.equal(ran.status, 1, name);
    assert.equal(ran.stderr, `${name}: refused: ${why}. Say what you need to whoever gave you the work.\n`);
  }
  assert.deepEqual(readdirSync(dir).sort(), ["git", ...Object.keys(kit.refused)].sort(), "nothing the kit no longer refuses is left refusing");
});
