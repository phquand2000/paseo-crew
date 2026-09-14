import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderPrompt } from "./content.ts";
import { makeKit } from "./testkit.ts";

test("a profile placeholder renders as the role's provider id", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  writeFileSync(join(kit.dir, "content/prompts/LEAD.md"), "Peers come from the `{{profile:peer}}` profile.\n");
  assert.equal(renderPrompt(kit, lead, { guides: "/g", state: "/s" }), "Peers come from the `sw2-peer` profile.\n");
});

test("a profile placeholder for an unknown role is refused", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  writeFileSync(join(kit.dir, "content/prompts/LEAD.md"), "Start a `{{profile:scout}}`.\n");
  assert.throws(() => renderPrompt(kit, lead, { guides: "/g", state: "/s" }), /unknown role scout/);
});
