import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stateRoot } from "../../server/core/paths.ts";
import { type MigrateContext, migrate, migrationPlan, stampKit } from "../../server/upkeep/migrate.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const NOW = Date.parse("2026-09-22T07:12:30Z");

function world(): MigrateContext & { machine: string; project: string } {
  const kit = makeKit();
  const home = tempDir("sw2-home-");
  const root = tempDir("sw2-repo-");
  const shop = { root, slug: "shop-abc123", state: join(stateRoot(home), "projects", "shop-abc123") };
  mkdirSync(shop.state, { recursive: true });
  const machine = join(stateRoot(home), "settings.json");
  const project = join(shop.state, "settings.json");
  return {
    kit,
    home,
    known: [shop],
    settings: [
      { where: "machine", file: machine },
      { where: shop.slug, file: project },
    ],
    live: [],
    now: NOW,
    machine,
    project,
  };
}

test("migrate repairs a settings file it can read, dropping only what this version refuses and keeping a copy, and leaves one it cannot for the owner", () => {
  const ctx = world();
  const held = {
    roles: { lead: { harness: "claude", colour: "red" } },
    shelf: { docs: true },
    attention: { by: "nobody", tickSeconds: 60 },
    critic: { key: "a-fake-key-dropped" },
  };
  writeFileSync(ctx.machine, JSON.stringify(held));
  writeFileSync(ctx.project, "{ roles: ");

  const plan = migrationPlan(ctx);
  assert.deepEqual(
    plan.steps.map((step) => [step.where, step.kind, step.auto, step.detail.slice().sort()]),
    [
      ["machine", "settings", true, ["attention.by", "critic", "roles.lead.colour", "shelf"]],
      ["shop-abc123", "settings", false, ["Repair it by hand; Migrate does not guess at what it held."]],
    ],
  );
  assert.ok(!JSON.stringify(plan).includes("a-fake-key-dropped"), "a key it drops is named by its path, never shown");

  const after = migrate(ctx);
  assert.deepEqual(
    after.steps.map((step) => [step.where, step.auto]),
    [["shop-abc123", false]],
    "only what the owner must repair is left",
  );
  assert.deepEqual(JSON.parse(readFileSync(ctx.machine, "utf-8")), {
    roles: { lead: { harness: "claude" } },
    attention: { tickSeconds: 60 },
  });
  assert.deepEqual(
    readdirSync(stateRoot(ctx.home)).filter((name) => name.includes(".bak-")),
    ["settings.json.bak-20260922-071230"],
  );
  assert.deepEqual(JSON.parse(readFileSync(`${ctx.machine}.bak-20260922-071230`, "utf-8")), held);
  assert.equal(
    readFileSync(ctx.project, "utf-8"),
    "{ roles: ",
    "a file that is not JSON is left for the owner to repair",
  );
});

test("migrate names the seats started before this kit was loaded, and changes nothing about them", () => {
  const ctx = world();
  const { since } = stampKit(ctx.kit, ctx.home, NOW);
  writeFileSync(join(ctx.kit.dir, "content", "prompts", "LEAD.md"), "A new brief.");
  const next = stampKit(ctx.kit, ctx.home, NOW + 60_000);
  assert.ok(next.since > since, "the kit stamp moves with its content");
  ctx.live.push(
    {
      provider: "sw2-lead-claude",
      slug: "shop-abc123",
      createdAt: new Date(NOW).toISOString(),
      name: "Lead · Claude Code",
    },
    {
      provider: "sw2-peer-omp",
      slug: "shop-abc123",
      createdAt: new Date(NOW + 120_000).toISOString(),
      name: "Peer · Oh My Pi",
    },
  );
  const plan = migrate(ctx);
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.auto, step.detail.slice(0, -1)]),
    [["seat", false, ["Lead · Claude Code"]]],
  );
  assert.deepEqual(plan.done, []);
});
