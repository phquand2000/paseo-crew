import assert from "node:assert/strict";
import { test } from "node:test";
import { applyModels, fetchModels, readModels } from "../../server/catalog/models.ts";
import { makeKit } from "../kit.ts";
import { tempDir } from "../tempdir.ts";

const opus = { id: "opus", label: "Opus", isDefault: true, thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }], defaultThinkingOptionId: "high" };

test("the models are what Paseo lists for each agent, not what the plugin marked as default", async () => {
  const kit = makeKit();
  const state = tempDir("sw2-state-");
  const asked: string[] = [];
  const { cache, changed } = await fetchModels(kit, async (provider) => {
    asked.push(provider);
    return provider.endsWith("-claude") ? { models: [opus, { id: "old", label: "Old", isSelectable: false }] } : { models: [{ id: "glm-5", label: "GLM 5" }] };
  }, state);
  assert.deepEqual(asked, ["sw2-supervisor-claude", "sw2-lead-omp"]);
  assert.equal(changed, true);
  assert.deepEqual(cache.claude!.models, [{ id: "opus", label: "Opus", thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] }]);
  assert.deepEqual(readModels(state), cache);

  applyModels(kit, cache);
  assert.deepEqual(kit.harnesses.omp!.models, [{ id: "glm-5", label: "GLM 5" }]);
});

test("an agent Paseo cannot list keeps its last list, and says why", async () => {
  const kit = makeKit();
  const state = tempDir("sw2-state-");
  await fetchModels(kit, async () => ({ models: [opus] }), state, Date.parse("2026-09-01T00:00:00Z"));
  const { cache, changed } = await fetchModels(kit, async (provider) => {
    if (provider.endsWith("-omp")) throw new Error("omp is not on PATH");
    return { models: [opus] };
  }, state);
  assert.equal(changed, false);
  assert.equal(cache.omp!.error, "omp is not on PATH");
  assert.equal(cache.omp!.at, "2026-09-01T00:00:00.000Z");
  assert.equal(cache.omp!.models[0]!.id, "opus");

  const before = kit.harnesses.omp!.models;
  applyModels(kit, { omp: { at: "", error: "none", models: [] } });
  assert.equal(kit.harnesses.omp!.models, before);
});
