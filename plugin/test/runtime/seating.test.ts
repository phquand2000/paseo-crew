import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { seatDir } from "../../server/catalog/seats.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";
import { Seating } from "../../server/runtime/seating.ts";
import { TeamSource } from "../../server/runtime/team-source.ts";

test("a login made after a seat was built reaches that seat the next time it starts", () => {
  const home = tempDir("crew-seating-home-");
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

test("a Claude seat takes in a project's AGENTS.md while the project has no CLAUDE.md, and stops once one appears", () => {
  const home = tempDir("crew-seating-home-");
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    const kit = makeKit();
    const seating = new Seating(kit, new TeamSource(kit), { node: "/bin/node", spool: "/spool" });
    const claude = kit.harnesses.claude!;
    // A seat's own directory is added, and Claude reads an added directory's CLAUDE.md but never its AGENTS.md.
    const root = tempDir("crew-supervisor-project-");
    const project = { root, slug: "shop-abc123", state: join(root, ".state") };
    writeFileSync(join(root, "AGENTS.md"), "Use pnpm.\n");
    const file = join(seatDir(kit, kit.roles.find((role) => role.role === "lead")!, claude, home, project), "CLAUDE.md");
    const rules = () => (existsSync(file) ? readFileSync(file, "utf-8") : "");
    seating.ensure("lead", claude, project);
    assert.match(rules(), new RegExp(`^@${join(root, "AGENTS.md")}$`, "m"), "though the project's path holds a word the Lead must not see");
    writeFileSync(join(root, "CLAUDE.md"), "Use npm.\n");
    seating.ensure("lead", claude, project);
    assert.doesNotMatch(rules(), /AGENTS\.md/, "Claude reads the project's CLAUDE.md in its place, as it would outside a seat");
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
});
