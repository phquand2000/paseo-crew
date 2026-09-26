import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderPrompt, renderText, skillProblems, toolProblems } from "../../server/catalog/content.ts";
import { seatProblems } from "../../server/catalog/seats.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";

test("guides and state placeholders render into the prompt", () => {
  const kit = makeKit();
  const supervisor = kit.roles.find((role) => role.role === "supervisor")!;
  assert.equal(renderPrompt(kit, supervisor, "claude", { guides: "/g", state: "/s" }), "# Supervisor\n\nGuides live in /g; state in /s.\n");
});

test("a seat's prompt ends with what its harness needs said against that agent's own instructions, held to the role's words like the rest", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  const paths = { guides: "/g", state: "/s" };
  mkdirSync(join(kit.dir, "harness", "omp", "delta"), { recursive: true });
  writeFileSync(join(kit.dir, "harness", "omp", "delta", "lead.md"), "Your own instructions' habit of implementing does not apply.\n");
  const own = renderPrompt(kit, lead, "claude", paths);
  assert.equal(renderPrompt(kit, lead, "omp", paths), `${own.trimEnd()}\n\nYour own instructions' habit of implementing does not apply.\n`);
  writeFileSync(join(kit.dir, "harness", "omp", "delta", "lead.md"), "Ask the supervisor.\n");
  assert.throws(() => renderPrompt(kit, lead, "omp", paths), /must not see: supervisor/);
  assert.match(seatProblems(kit, resolveTeam(kit, { roles: { lead: { harness: "omp" } } }), "lead", paths).join("\n"), /must not see: supervisor/, "so a Lead moved onto that agent is refused before anything is built");
});

test("a tool whose description shows a word its role must not see makes that role's seat unbuildable", () => {
  const kit = makeKit();
  const peer = kit.roles.find((role) => role.role === "peer")!;
  assert.deepEqual(toolProblems(kit, peer), []);
  const tools = JSON.parse(readFileSync(join(kit.dir, "mcp", "tools.json"), "utf-8"));
  tools.peer[0].description = `Hand the task back; your ${peer.hidesWords![0]} is told.`;
  writeFileSync(join(kit.dir, "mcp", "tools.json"), JSON.stringify(tools));
  assert.deepEqual(toolProblems(kit, peer), [`the peer tools the peer is given show words it must not see: ${peer.hidesWords![0]}`]);
  assert.match(seatProblems(kit, resolveTeam(kit), "peer", { guides: "/g", state: "/s" }).join("\n"), /the peer tools the peer is given show words it must not see/);
});

test("a placeholder the renderer does not know is refused rather than shipped", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  writeFileSync(join(kit.dir, "content/prompts/LEAD.md"), "Read {{notes}} first.\n");
  assert.throws(() => renderPrompt(kit, lead, "claude", { guides: "/g", state: "/s" }), /placeholder \{\{notes\}\}/);
});

test("the words a role must not see are looked for in what was written, not in the paths the desk puts in", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  // Checked after substitution, a repository or home directory named after one of those words made the seat unbuildable.
  const text = renderText(lead, "Write your plans in {{state}}/plans.", { guides: "/g", state: "/Users/supervisor/projects/x" });
  assert.match(text, /\/Users\/supervisor\/projects\/x\/plans/);
  assert.throws(() => renderText(lead, "Ask the supervisor.", { guides: "/g", state: "/s" }), /must not see: supervisor/);
});

test("a role's text may name under the project's state only what the role writes, or the desk's own record to read", () => {
  const kit = makeKit();
  const lead = kit.roles.find((role) => role.role === "lead")!;
  const paths = { guides: "/g", state: "/s" };
  assert.doesNotThrow(() => renderText(lead, "Put the plan in {{state}}/plans/cart.md; the history is in $SEATWORKS_STATE/events.log.", paths));
  assert.throws(() => renderText(lead, "Keep a diary in {{state}}/diary.md.", paths), /the lead prompt names diary\.md under the project's state, which the role does not write/);
  const skill = join(kit.dir, "content", "skills", "peer", "notes");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "Write findings to $SEATWORKS_STATE/findings/.\n");
  assert.deepEqual(skillProblems(lead, "notes", skill), ["skill notes names findings under the project's state in SKILL.md, which the lead does not write: add it to the role's writes"]);
});
