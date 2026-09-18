import assert from "node:assert/strict";
import { lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { seatDir } from "../../server/catalog/seats.ts";
import { makeKit } from "../../server/catalog/testkit.ts";
import { tempDir } from "../../server/core/testing.ts";
import { Seating } from "../../server/runtime/seating.ts";
import { TeamSource } from "../../server/runtime/team-source.ts";

test("a login made after a seat was built reaches that seat the next time it starts", () => {
  const home = tempDir("sw2-seating-home-");
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const kit = makeKit();
    const seating = new Seating(kit, new TeamSource(kit), { node: "/bin/node", spool: "/spool" });
    const lead = kit.roles.find((role) => role.role === "lead")!;
    const claude = kit.harnesses.claude!;
    const link = join(seatDir(kit, lead, claude, home), "projects");
    seating.ensure("lead", claude);
    assert.throws(() => lstatSync(link), "nothing to link to yet");
    mkdirSync(join(home, ".claude", "projects"), { recursive: true });
    seating.ensure("lead", claude);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});
