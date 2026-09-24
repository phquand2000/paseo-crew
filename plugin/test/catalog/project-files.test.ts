import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadKit } from "../../server/catalog/kit.ts";
import { BEGIN, END, onlyTheBlock, placeProjectFiles } from "../../server/catalog/project-files.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const read = (root: string, name: string) => readFileSync(join(root, name), "utf-8");

test("a project gets the team's block in AGENTS.md and a pointer to it in CLAUDE.md, and the Human's text is never touched", () => {
  const root = tempDir("crew-files-");
  assert.deepEqual(placeProjectFiles(root, "Team rules."), ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(read(root, "AGENTS.md"), `${BEGIN}\nTeam rules.\n${END}\n`);
  assert.match(read(root, "CLAUDE.md"), /^<!-- paseo-crew:begin.*\n@AGENTS\.md\n<!-- paseo-crew:end -->\n$/);
  assert.deepEqual(placeProjectFiles(root, "Team rules."), [], "written again only when something changed");

  const other = tempDir("crew-files-");
  writeFileSync(join(other, "AGENTS.md"), "# Ours\n\nUse pnpm.\n");
  writeFileSync(join(other, "CLAUDE.md"), "Be brief.\n\n@AGENTS.md\n");
  placeProjectFiles(other, "Old rules.");
  placeProjectFiles(other, "New rules.");
  assert.equal(read(other, "AGENTS.md"), `# Ours\n\nUse pnpm.\n\n${BEGIN}\nNew rules.\n${END}\n`, "the block is replaced whole, beside the Human's text");
  assert.equal(read(other, "CLAUDE.md"), "Be brief.\n\n@AGENTS.md\n", "a CLAUDE.md that already reaches AGENTS.md is left as it is");
});

test("with the pointer turned off CLAUDE.md is never made, and only the plugin's own block is taken back out of one", () => {
  const root = tempDir("crew-files-");
  assert.deepEqual(placeProjectFiles(root, "Team rules.", { claudePointer: false }), ["AGENTS.md"]);
  assert.equal(existsSync(join(root, "CLAUDE.md")), false);

  placeProjectFiles(root, "Team rules.");
  assert.deepEqual(placeProjectFiles(root, "Team rules.", { claudePointer: false }), ["CLAUDE.md"]);
  assert.equal(existsSync(join(root, "CLAUDE.md")), false, "a file that was nothing but the plugin's pointer goes");

  writeFileSync(join(root, "CLAUDE.md"), "Be brief.\n");
  placeProjectFiles(root, "Team rules.");
  placeProjectFiles(root, "Team rules.", { claudePointer: false });
  assert.equal(read(root, "CLAUDE.md"), "Be brief.\n", "the Human's text stays");
  writeFileSync(join(root, "CLAUDE.md"), "Be brief.\n\n@AGENTS.md\n");
  assert.deepEqual(placeProjectFiles(root, "Team rules.", { claudePointer: false }), [], "a pointer the Human wrote is theirs");
});

test("a CLAUDE.md that is a link to AGENTS.md is the same file, and the block in it stays", () => {
  for (const claudePointer of [false, true]) {
    const root = tempDir("crew-files-");
    writeFileSync(join(root, "AGENTS.md"), "# Ours");
    symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
    assert.deepEqual(placeProjectFiles(root, "Team rules.", { claudePointer }), ["AGENTS.md"]);
    assert.equal(read(root, "AGENTS.md"), `# Ours\n\n${BEGIN}\nTeam rules.\n${END}\n`);
    assert.equal(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink(), true);
    assert.deepEqual(placeProjectFiles(root, "Team rules.", { claudePointer }), []);
  }
});

test("a lane may take over a copy whose only change is the team's block, and not one the Human has changed", async () => {
  const root = tempDir("crew-files-");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf-8" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  writeFileSync(join(root, "AGENTS.md"), "# Ours");
  git("add", "AGENTS.md");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "ours");

  placeProjectFiles(root, "Team rules.");
  assert.equal(await onlyTheBlock(root, "AGENTS.md"), true, "the block beside the Human's committed text");
  assert.equal(await onlyTheBlock(root, "CLAUDE.md"), true, "a CLAUDE.md that is nothing but the pointer");
  writeFileSync(join(root, "AGENTS.md"), read(root, "AGENTS.md").replace("# Ours", "# Ours, edited"));
  assert.equal(await onlyTheBlock(root, "AGENTS.md"), false, "an edit of the Human's rides along with the lane");
  mkdirSync(join(root, "src"));
  assert.equal(await onlyTheBlock(root, "src/AGENTS.md"), false);
  assert.equal(await onlyTheBlock(root, "README.md"), false);
});

test("the team's block is read by every role, so it may show none of the words any role is kept from", () => {
  const kit = makeKit();
  mkdirSync(join(kit.dir, "content", "project"), { recursive: true });
  const words = kit.roles.flatMap((role) => role.hidesWords ?? []);
  assert.ok(words.length > 0, "the test kit hides words from some role");
  writeFileSync(join(kit.dir, "content", "project", "AGENTS.md"), `Ask your ${words[0]} first.\n`);
  assert.throws(() => loadKit(kit.dir), new RegExp(`words some must not see: ${words[0]}`));
  writeFileSync(join(kit.dir, "content", "project", "AGENTS.md"), "Ask your owner first.\n");
  assert.equal(loadKit(kit.dir).team, "Ask your owner first.\n");
});
