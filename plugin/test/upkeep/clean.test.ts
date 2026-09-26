import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveTeam } from "../../server/catalog/team.ts";
import { contentRoot, stateRoot, worktreeRoot } from "../../server/core/paths.ts";
import { writeJson } from "../../server/core/store.ts";
import { emptyLedger } from "../../server/desk/ledger.ts";
import { removeGarbage, scanGarbage } from "../../server/upkeep/clean.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

function world() {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const root = tempDir("sw2-repo-");
  const shop = { root, slug: "shop-abc123", state: join(stateRoot(home), "projects", "shop-abc123") };
  const seat = (name: string) => {
    const dir = join(home, name.includes("claude") ? ".claude/profiles" : ".omp/seats", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), "{}");
    return dir;
  };
  const copy = (name: string, dirty = false) => {
    const dir = join(worktreeRoot(home), shop.slug, name);
    mkdirSync(dir, { recursive: true });
    if (dirty) {
      execFileSync("git", ["init", "-q", dir]);
      writeFileSync(join(dir, "work.txt"), "unsaved");
    }
    return dir;
  };
  const live: { provider: string; slug: string }[] = [];
  let lead = "claude";
  const ctx = {
    kit,
    home,
    known: [shop],
    live,
    teamFor: () => resolveTeam(kit, {}, { roles: { lead: { harness: lead } } }),
  };
  return { home, shop, seat, copy, live, ctx, moveLead: (to: string) => (lead = to) };
}

const found = async (ctx: Parameters<typeof scanGarbage>[0]) =>
  (await scanGarbage(ctx))
    .map((item) => [item.kind, item.path, item.why, item.held, item.careful] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

test("clean up lists only what nothing will use again: seats nothing will sit in, copies no slot holds, detached records, unlinked copies of the guides and Migrate's backups", async () => {
  const { home, shop, seat, copy, live, ctx, moveLead } = world();
  assert.deepEqual(await found(ctx), [], "a machine with nothing left over lists nothing");
  const current = seat("sw2-lead-claude-shop-abc123");
  const detached = seat("sw2-peer-omp-gone-def456");
  const removedRole = seat("sw2-scout-omp-shop-abc123");
  seat("sw2-peer-omp-old-fff000");
  live.push({ provider: "sw2-peer-omp", slug: "old-fff000" });
  seat("sw2-lead-claude");
  const held = copy("S1");
  const free = copy("S2");
  const dirty = copy("S3", true);
  writeJson(join(shop.state, "ledger.json"), {
    ...emptyLedger(),
    slots: { S1: { id: "S1", path: held, lane: "L1", createdAt: 1 } },
  });
  const old = join(stateRoot(home), "projects", "old-fff000");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "CONTEXT.md"), "# Old");
  const used = join(contentRoot(home), "guides-aaaaaaaaaaaa");
  const stale = join(contentRoot(home), "guides-bbbbbbbbbbbb");
  mkdirSync(used, { recursive: true });
  mkdirSync(stale, { recursive: true });
  symlinkSync(used, join(stateRoot(home), "guides"));
  const backups = [
    join(stateRoot(home), "settings.json.bak-20260922-071230"),
    join(shop.state, "settings.json.bak-20260922-071230"),
  ];
  for (const backup of backups) writeFileSync(backup, "{}");

  const tokens = "a copy Migrate kept of settings it repaired; it can hold a pasted server's token";
  assert.deepEqual(
    await found(ctx),
    [
      ["backup", backups[0], tokens, null, false],
      ["seat", detached, "gone-def456 is not attached", null, false],
      ["seat", removedRole, "this version has no scout role", null, false],
      ["copy", free, "the desk holds no slot for it", null, false],
      ["copy", dirty, "the desk holds no slot for it", "it has uncommitted changes", false],
      ["snapshot", stale, "no seat links to it", null, false],
      [
        "records",
        old,
        "detached; attaching it again would find its lanes. It holds the project's CONTEXT.md",
        null,
        true,
      ],
      ["backup", backups[1], tokens, null, false],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    "never a seat a seat is running in, a copy a slot holds, a copy of the guides in use, or a name that is no seat's",
  );
  moveLead("omp");
  assert.deepEqual(
    (await found(ctx)).find(([, path]) => path === current),
    ["seat", current, "the Lead sits on Oh My Pi now", null, false],
    "a seat whose role moved to another agent",
  );
});

test("removal takes only what a fresh scan still finds free, and leaves a folder a seat has started in since and a copy with work in it", async () => {
  const { seat, copy, live, ctx } = world();
  const one = seat("sw2-peer-omp-gone-def456");
  const two = seat("sw2-lead-omp-gone-def456");
  const free = copy("S2");
  const dirty = copy("S3", true);
  const picked = (await found(ctx)).map(([, path]) => path);
  live.push({ provider: "sw2-lead-omp", slug: "gone-def456" });

  const result = await removeGarbage(ctx, picked);
  assert.deepEqual(result.removed.sort(), [one, free].sort());
  assert.deepEqual(
    result.failed.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: two, error: "it is in use now, or already gone" },
      { path: dirty, error: "it has uncommitted changes" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
  assert.deepEqual(
    [existsSync(one), existsSync(free), existsSync(two), existsSync(join(dirty, "work.txt"))],
    [false, false, true, true],
  );
});
