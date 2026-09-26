import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderPrompt, skillSources } from "../../server/catalog/content.ts";
import { contentChanges, decide } from "../../server/upkeep/content.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { env, encoding: "utf-8" });

/** A kit in a repository, with the owner's state beside it, taken in once as it ships. */
async function world() {
  const state = tempDir("sw2-state-");
  const kit = { ...makeKit(), own: join(state, "own") };
  writeFileSync(join(kit.dir, "content", "guides", "PLANS.md"), "# Plans\n");
  git(kit.dir, "init", "-q");
  git(kit.dir, "add", ".");
  git(kit.dir, "commit", "-q", "-m", "2.0.1");
  assert.deepEqual(await contentChanges(kit, state), []);
  const ship = (path: string, text: string) => {
    mkdirSync(join(kit.dir, "content", path, ".."), { recursive: true });
    writeFileSync(join(kit.dir, "content", path), text);
    git(kit.dir, "add", ".");
    git(kit.dir, "commit", "-q", "-m", "2.0.2");
  };
  return { kit, state, ship };
}

const role = (kit: Awaited<ReturnType<typeof world>>["kit"], name: string) =>
  kit.roles.find((entry) => entry.role === name)!;
const paths = { guides: "/g", state: "/s" };

test("a changed prompt or skill is asked about; a changed guide or record is only told", async () => {
  const { kit, state, ship } = await world();
  ship("prompts/LEAD.md", "A new brief.");
  ship("skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan, better\n---\n");
  ship("guides/PLANS.md", "# Plans, rewritten\n");
  const changes = await contentChanges(kit, state);
  assert.deepEqual(
    changes.map((change) => [change.unit, change.kind, change.keepable]),
    [
      ["guides/PLANS.md", "guide", false],
      ["prompts/LEAD.md", "prompt", true],
      ["skills/supervisor/plan-check", "skill", true],
    ],
  );
});

test("keep mine puts the version the owner had back in use, and the original changing again is still told", async () => {
  const { kit, state, ship } = await world();
  const before = readFileSync(join(kit.dir, "content", "prompts", "LEAD.md"), "utf-8");
  ship("prompts/LEAD.md", "A new brief.");
  ship("skills/supervisor/plan-check/SKILL.md", "---\nname: plan-check\ndescription: checks a plan, better\n---\n");

  await decide(kit, state, "prompts/LEAD.md", "mine");
  await decide(kit, state, "skills/supervisor/plan-check", "mine");
  assert.equal(readFileSync(join(state, "own", "prompts", "LEAD.md"), "utf-8"), before);
  assert.match(
    renderPrompt(kit, role(kit, "lead"), "claude", paths),
    new RegExp(before.split("\n")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(
    skillSources(kit, role(kit, "supervisor")).get("plan-check"),
    join(state, "own", "skills", "supervisor", "plan-check"),
  );
  assert.deepEqual(await contentChanges(kit, state), []);

  ship("prompts/LEAD.md", "A newer brief.");
  assert.deepEqual(
    (await contentChanges(kit, state)).map((change) => [change.unit, change.kept]),
    [["prompts/LEAD.md", true]],
  );
});

test("use new sets the owner's copy aside instead of deleting it, and the shipped one is used again", async () => {
  const { kit, state, ship } = await world();
  ship("prompts/LEAD.md", "A new brief.");
  await decide(kit, state, "prompts/LEAD.md", "mine");
  writeFileSync(join(state, "own", "prompts", "LEAD.md"), "My own edit.");
  ship("prompts/LEAD.md", "A newer brief.");

  await decide(kit, state, "prompts/LEAD.md", "new", Date.parse("2026-09-22T07:12:30Z"));
  assert.match(renderPrompt(kit, role(kit, "lead"), "claude", paths), /A newer brief\./);
  assert.deepEqual(readdirSync(join(state, "own", "prompts")), ["LEAD.md.bak-20260922-071230"]);
  assert.equal(readFileSync(join(state, "own", "prompts", "LEAD.md.bak-20260922-071230"), "utf-8"), "My own edit.");
  assert.equal(existsSync(join(state, "own", "prompts", "LEAD.md")), false);
  assert.deepEqual(await contentChanges(kit, state), []);
});
