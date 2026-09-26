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
  const live: { provider: string; slug: string }[] = [];
  let lead = "claude";
  const ctx = {
    kit,
    home,
    known: [shop],
    live,
    teamFor: () => resolveTeam(kit, {}, { roles: { lead: { harness: lead } } }),
  };
  return { kit, home, shop, seat, live, ctx, moveLead: (to: string) => (lead = to) };
}

const paths = async (ctx: Parameters<typeof scanGarbage>[0]) =>
  (await scanGarbage(ctx)).map((item) => item.path).sort();

test("clean up finds seat folders nothing will sit in again, and never one a seat is running in", async () => {
  const { seat, live, ctx, moveLead } = world();
  const current = seat("sw2-lead-claude-shop-abc123");
  const detached = seat("sw2-peer-omp-gone-def456");
  const removedRole = seat("sw2-scout-omp-shop-abc123");
  const running = seat("sw2-peer-omp-old-fff000");
  live.push({ provider: "sw2-peer-omp", slug: "old-fff000" });
  seat("sw2-lead-claude");
  assert.deepEqual(await paths(ctx), [detached, removedRole].sort());

  moveLead("omp");
  const moved = (await scanGarbage(ctx)).find((item) => item.path === current);
  assert.equal(moved?.why, "the Lead sits on Oh My Pi now");
  assert.ok(!(await paths(ctx)).includes(running));
});

test("clean up takes a working copy the desk holds no slot for, and keeps one with work in it", async () => {
  const { home, shop, ctx } = world();
  const copies = join(worktreeRoot(home), shop.slug);
  const held = join(copies, "S1");
  const free = join(copies, "S2");
  const dirty = join(copies, "S3");
  for (const dir of [held, free, dirty]) mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dirty]);
  writeFileSync(join(dirty, "work.txt"), "unsaved");
  writeJson(join(shop.state, "ledger.json"), {
    ...emptyLedger(),
    slots: { S1: { id: "S1", path: held, lane: "L1", createdAt: 1 } },
  });

  const found = await scanGarbage(ctx);
  assert.deepEqual(
    found.filter((item) => item.kind === "copy").map((item) => [item.path, item.held]),
    [
      [free, null],
      [dirty, "it has uncommitted changes"],
    ],
  );

  const result = await removeGarbage(ctx, [free, dirty]);
  assert.deepEqual(result.removed, [free]);
  assert.deepEqual(result.failed, [{ path: dirty, error: "it has uncommitted changes" }]);
  assert.equal(existsSync(join(dirty, "work.txt")), true);
});

test("clean up leaves a detached project's records unpicked when they hold its CONTEXT.md", async () => {
  const { home, shop, ctx } = world();
  mkdirSync(shop.state, { recursive: true });
  const old = join(stateRoot(home), "projects", "old-fff000");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "CONTEXT.md"), "# Old");
  const records = (await scanGarbage(ctx)).filter((item) => item.kind === "records");
  assert.deepEqual(
    records.map((item) => [item.path, item.careful]),
    [[old, true]],
  );
});

test("clean up takes a copy of the guides nothing links to, not the one in use", async () => {
  const { home, ctx } = world();
  const used = join(contentRoot(home), "guides-aaaaaaaaaaaa");
  const stale = join(contentRoot(home), "guides-bbbbbbbbbbbb");
  mkdirSync(used, { recursive: true });
  mkdirSync(stale, { recursive: true });
  symlinkSync(used, join(stateRoot(home), "guides"));
  assert.deepEqual(await paths(ctx), [stale]);
});

test("remove takes only what a fresh scan still finds, and leaves a folder a seat has started in since", async () => {
  const { seat, live, ctx } = world();
  const one = seat("sw2-peer-omp-gone-def456");
  const two = seat("sw2-lead-omp-gone-def456");
  const scanned = await paths(ctx);
  live.push({ provider: "sw2-lead-omp", slug: "gone-def456" });

  const result = await removeGarbage(ctx, scanned);
  assert.deepEqual(result.removed, [one]);
  assert.deepEqual(
    result.failed.map((fail) => fail.path),
    [two],
  );
  assert.equal(existsSync(one), false);
  assert.equal(existsSync(two), true);
});
