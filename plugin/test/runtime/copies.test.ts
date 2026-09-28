import assert from "node:assert/strict";
import { existsSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import { stateRoot, worktreeRoot } from "../../server/core/paths.ts";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["anything else in the repository"] };

test("the copies' folder may be moved to another volume behind a link: new copies sit at its real path, and no held copy is swept", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const open = async (title: string, lane: string) => {
    const opened = await h.call(sup, "supervisor", "open_lane", { title, outcome: "x", ...scope, isolate: true });
    assert.equal(opened.ok, true, opened.text);
    return h.ledger().slots[h.ledger().lanes[lane]!.slot!]!.path;
  };
  const before = await open("Before", "L1");
  const volume = join(tempDir("crew-volume-"), "worktrees");
  renameSync(worktreeRoot(), volume);
  symlinkSync(volume, join(stateRoot(), "worktrees"));

  const after = await open("After", "L2");
  assert.ok(after.startsWith(realpathSync(volume) + sep), `${after} is not on the volume's real path`);
  assert.match(h.git(h.root, "worktree", "list", "--porcelain"), new RegExp(`^worktree ${after}$`, "m"));
  await h.tick();
  assert.deepEqual(
    [before, after].map((path) => existsSync(join(path, ".git"))),
    [true, true],
    "a copy recorded through the link is still held",
  );
});
