import assert from "node:assert/strict";
import { test } from "node:test";
import { applyModels, fetchModels, readModels } from "../../server/catalog/models.ts";
import { desiredProvider } from "../../server/catalog/providers.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const opus = { id: "opus", label: "Opus", isDefault: true, thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }], defaultThinkingOptionId: "high" };

test("the models are what Paseo lists for each agent, not what the plugin marked as default", async () => {
  const kit = makeKit();
  const state = tempDir("crew-state-");
  const asked: string[] = [];
  const { cache, changed } = await fetchModels(kit, async (provider) => {
    asked.push(provider);
    return provider.endsWith("-claude") ? { models: [opus, { id: "old", label: "Old", isSelectable: false }] } : { models: [{ id: "swe-2", label: "SWE 2" }] };
  }, state);
  assert.deepEqual(asked, ["crew-supervisor-claude", "crew-lead-agy"]);
  assert.equal(changed, true);
  assert.deepEqual(cache.claude!.models, [{ id: "opus", label: "Opus", thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] }]);
  assert.deepEqual(readModels(state), cache);

  applyModels(kit, cache);
  assert.deepEqual(kit.harnesses.agy!.models, [{ id: "swe-2", label: "SWE 2" }]);
});

test("an agent Paseo cannot list keeps its last list, and says why", async () => {
  const kit = makeKit();
  const state = tempDir("crew-state-");
  await fetchModels(kit, async () => ({ models: [opus] }), state, Date.parse("2026-09-01T00:00:00Z"));
  const { cache, changed } = await fetchModels(kit, async (provider) => {
    if (provider.endsWith("-agy")) throw new Error("agy is not on PATH");
    return { models: [opus] };
  }, state);
  assert.equal(changed, false);
  assert.equal(cache.agy!.error, "agy is not on PATH");
  assert.equal(cache.agy!.at, "2026-09-01T00:00:00.000Z");
  assert.equal(cache.agy!.models[0]!.id, "opus");

  const before = kit.harnesses.agy!.models;
  applyModels(kit, { agy: { at: "", error: "none", models: [] } });
  assert.equal(kit.harnesses.agy!.models, before);
});

test("a role moved to an agent its preset does not name starts on the model another role's preset names there, not the first listed", () => {
  const kit = makeKit();
  applyModels(kit, { agy: { at: "", error: null, models: [{ id: "claude-in-agy", label: "Claude in Agy" }, { id: "swe", label: "SWE" }] } });
  const team = resolveTeam(kit, { roles: { lead: { harness: "agy" } } });
  assert.equal(team.roles.lead!.model?.id, "swe");
  assert.deepEqual(desiredProvider(kit, team, team.roles.lead!.role, kit.harnesses.agy!).additionalModels, [{ id: "swe", label: "SWE", isDefault: true }]);
});
