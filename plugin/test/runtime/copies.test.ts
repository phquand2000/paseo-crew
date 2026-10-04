import assert from "node:assert/strict";
import { existsSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
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

test("one project's copies may be moved to another volume behind a link: new copies and their seats sit at its real path, and no held copy is swept", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const open = async (title: string, lane: string) => {
    const opened = await h.call(sup, "supervisor", "open_lane", { title, outcome: "x", ...scope, isolate: true });
    assert.equal(opened.ok, true, opened.text);
    return h.ledger().slots[h.ledger().lanes[lane]!.slot!]!.path;
  };
  const before = await open("Before", "L1");
  const folder = dirname(before);
  const volume = join(tempDir("crew-volume-"), basename(folder));
  renameSync(folder, volume);
  symlinkSync(volume, folder);

  const after = await open("After", "L2");
  // Codex's sandbox refuses a writable root with a link anywhere in its path.
  assert.equal(realpathSync(after), after, `${after} runs through a link`);
  assert.equal(h.agents.get(h.ledger().lanes.L2!.lead!)!.cwd, after);
  await h.tick();
  assert.deepEqual(
    [join(volume, basename(before)), after].map((path) => existsSync(join(path, ".git"))),
    [true, true],
    "a copy behind the project's link is still held",
  );
});

test("copies taken before their folder moved behind a link are recorded at its real path once the plugin starts again, and their seats are kept", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  assert.equal(
    (await h.call(sup, "supervisor", "open_lane", { title: "B", outcome: "x", ...scope, isolate: true })).ok,
    true,
  );
  const lead = h.ledger().lanes.L1!.lead!;
  const task = { key: "t", title: "T", goal: "g", acceptance: ["a"], hints: ["a.txt"], outOfScope: ["the rest"] };
  assert.equal((await h.call(lead, "lead", "add_tasks", { tasks: [task] })).ok, true);
  const peer = h.ledger().tasks["L1-T1"]!.peer!;
  const before = h.ledger().lanes.L1!.worktree!;
  const folder = dirname(before);
  const volume = join(tempDir("crew-volume-"), basename(folder));
  renameSync(folder, volume);
  symlinkSync(volume, folder);
  const moved = realpathSync(join(volume, basename(before)));

  h.restart();
  await h.tick();
  const ledger = h.ledger();
  const slot = ledger.slots[ledger.lanes.L1!.slot!]!;
  assert.deepEqual(
    [slot.path, ledger.lanes.L1!.worktree, ledger.tasks["L1-T1"]!.worktree],
    [moved, moved, moved],
    "every record of the copy names its real path",
  );
  assert.match(h.git(h.root, "worktree", "list", "--porcelain"), new RegExp(`^worktree ${moved}$`, "m"));
  // Archiving a workspace archives every agent in it: the seats placed through the link stay until they go.
  assert.deepEqual(
    [lead, peer].map((id) => h.agents.get(id)!.archivedAt),
    [null, null],
  );
  const reseated = await h.call(lead, "lead", "reseat", { task: "L1-T1", why: "Codex refuses a root through a link." });
  assert.equal(reseated.ok, true, reseated.text);
  assert.equal(h.agents.get(h.ledger().tasks["L1-T1"]!.peer!)!.cwd, moved);
  await h.tick();
  assert.equal(h.agents.get(lead)!.archivedAt, null, "the Lead seated through the link is kept");
});
