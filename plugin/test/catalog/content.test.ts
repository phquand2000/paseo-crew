import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderPrompt, renderText } from "../../server/catalog/content.ts";
import { makeKit } from "../../server/catalog/testkit.ts";

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

test("the words a role must not see are looked for in what was written, not in the paths the desk puts in", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  // Checked after substitution, a repository — or a home directory — named after one of those words
  // made the seat impossible to build.
  const text = renderText(lead, "Write your plans in {{state}}/plans.", { guides: "/g", state: "/Users/supervisor/projects/x" });
  assert.match(text, /\/Users\/supervisor\/projects\/x\/plans/);
  assert.throws(() => renderText(lead, "Ask the supervisor.", { guides: "/g", state: "/s" }), /must not see: supervisor/);
});
