import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadKit } from "../../server/catalog/kit.ts";
import { BEGIN, END, onlyTheBlock, placeProjectFiles } from "../../server/catalog/project-files.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const read = (root: string, name: string) => readFileSync(join(root, name), "utf-8");

test("a project gets the team's block in AGENTS.md and a pointer to it in CLAUDE.md, and the Human's text is never touched", () => {
  const root = tempDir("sw2-files-");
  assert.deepEqual(placeProjectFiles(root, "Team rules."), ["AGENTS.md", "CLAUDE.md"]);
  assert.equal(read(root, "AGENTS.md"), `${BEGIN}\nTeam rules.\n${END}\n`);
  assert.match(read(root, "CLAUDE.md"), /^<!-- seatworks:begin.*\n@AGENTS\.md\n<!-- seatworks:end -->\n$/);
  assert.deepEqual(placeProjectFiles(root, "Team rules."), [], "written again only when something changed");

  const other = tempDir("sw2-files-");
  writeFileSync(join(other, "AGENTS.md"), "# Ours\n\nUse pnpm.\n");
  writeFileSync(join(other, "CLAUDE.md"), "Be brief.\n\n@AGENTS.md\n");
  placeProjectFiles(other, "Old rules.");
  placeProjectFiles(other, "New rules.");
  assert.equal(read(other, "AGENTS.md"), `# Ours\n\nUse pnpm.\n\n${BEGIN}\nNew rules.\n${END}\n`, "the block is replaced whole, beside the Human's text");
  assert.equal(read(other, "CLAUDE.md"), "Be brief.\n\n@AGENTS.md\n", "a CLAUDE.md that already reaches AGENTS.md is left as it is");
});

test("a lane may take over a copy whose only change is the team's block, and not one the Human has changed", async () => {
  const root = tempDir("sw2-files-");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf-8" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  writeFileSync(join(root, "AGENTS.md"), "# Ours\n");
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
