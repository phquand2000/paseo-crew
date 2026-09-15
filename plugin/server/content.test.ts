import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderPrompt } from "./content.ts";
import { makeKit } from "./testkit.ts";

test("guides and state placeholders render into the prompt", () => {
  const kit = makeKit();
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  assert.equal(renderPrompt(kit, supervisor, { guides: "/g", state: "/s" }), "# Supervisor\n\nGuides live in /g; state in /s.\n");
});

test("a placeholder the renderer does not know is refused rather than shipped", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  writeFileSync(join(kit.dir, "content/prompts/LEAD.md"), "Read {{notes}} first.\n");
  assert.throws(() => renderPrompt(kit, lead, { guides: "/g", state: "/s" }), /placeholder \{\{notes\}\}/);
});
