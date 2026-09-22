import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { clearProjects, gateCommands, gitRoot, projectOf, slugFor } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";

test("a slug is stable and readable", () => {
  assert.equal(slugFor("/Users/me/project/OMS"), slugFor("/Users/me/project/OMS"));
  assert.match(slugFor("/Users/me/project/OMS"), /^oms-[0-9a-f]{6}$/);
  assert.notEqual(slugFor("/a/OMS"), slugFor("/b/OMS"));
});

test("a worktree belongs to the project of its main repository", () => {
  const repo = realpathSync(tempDir("sw2-repo-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "x");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const worktree = join(realpathSync(tempDir("sw2-wt-")), "lane");
  git("worktree", "add", "-q", "-b", "lane", worktree);
  assert.equal(gitRoot(repo), repo);
  assert.equal(gitRoot(worktree), repo);
  clearProjects();
  assert.equal(projectOf(worktree, "/state").slug, projectOf(repo, "/state").slug);
});

test("a directory outside git is its own project", () => {
  const dir = realpathSync(tempDir("sw2-plain-"));
  clearProjects();
  const project = projectOf(dir, "/state");
  assert.equal(project.root, dir);
  assert.equal(project.state, join("/state", "projects", project.slug));
});

test("a gate that names a package script is also run by the runner that script starts", () => {
  // Briefs tell a Peer to run `node --test ...` directly; the watch once knew only `npm test`.
  const root = tempDir("sw2-gates-");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: 'node --test "test/**/*.test.js"', check: "tsc --noEmit && vitest run --reporter dot" } }));
  assert.deepEqual(gateCommands(root, "npm test"), ["npm test", "node --test"]);
  assert.deepEqual(gateCommands(root, "npm run check"), ["npm run check", "vitest run"]);
  assert.deepEqual(gateCommands(root, "cargo test"), ["cargo test"]);
  assert.deepEqual(gateCommands(root, "npm run missing"), ["npm run missing"]);
  assert.deepEqual(gateCommands(root, undefined), []);
});
