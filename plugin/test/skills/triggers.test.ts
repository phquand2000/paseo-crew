import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { hiddenWordsIn } from "../../server/catalog/kit/hidden-words.ts";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { loadCases, openedSkills, rightRun, skillCards, triggerPrompt } from "./triggers.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every skill a role is given has briefs that should open it and near misses that should not, shown to the role as a seat sees it", () => {
  const kit = loadKit(pluginRoot);
  const cases = loadCases();
  for (const role of kit.roles) {
    const cards = skillCards(kit, role.role);
    const own = cases[role.role] ?? cases[kit.roles.find((one) => one.prompt === role.prompt)!.role] ?? [];
    for (const one of own) {
      for (const name of [...one.expect, ...(one.near ? [one.near] : [])]) {
        assert.ok(cards.has(name), `${role.role} brief names ${name}, which that role is not given: ${one.brief}`);
      }
      assert.deepEqual(hiddenWordsIn(one.brief, role.hidesWords ?? []), [], `${role.role} brief: ${one.brief}`);
    }
    for (const name of cards.keys()) {
      const opens = own.filter((one) => one.expect.includes(name) && one.near !== name).length;
      const misses = own.filter((one) => one.near === name).length;
      assert.ok(opens >= 3, `${role.role} has ${opens} briefs that should open ${name}; write at least three`);
      assert.ok(misses >= 2, `${role.role} has ${misses} near misses for ${name}; write at least two`);
    }
  }
  const prompt = triggerPrompt("peer", skillCards(kit, "peer"), "Goal: fix it.");
  assert.match(
    prompt,
    /^- test-first: Puts evidence before behavior/m,
    "a card is the skill's name and its SKILL.md description, quotes stripped",
  );
  assert.match(prompt, /Your brief:\nGoal: fix it\./);
});

test("a trigger answer is read from the last JSON the agent printed, and a near miss opened fails the run", () => {
  assert.deepEqual(openedSkills('Thinking {"skills": ["council"]} ... final: {"skills": ["repo-refresh"]}'), [
    "repo-refresh",
  ]);
  assert.deepEqual(openedSkills('{"skills": []}'), []);
  assert.equal(openedSkills("I would open council."), undefined);
  const nearMiss = { brief: "b", expect: ["test-first"], near: "diagnosing-bugs" };
  assert.equal(rightRun(nearMiss, ["test-first"]), true);
  assert.equal(rightRun(nearMiss, ["test-first", "diagnosing-bugs"]), false);
  assert.equal(rightRun({ brief: "b", expect: [] }, []), true);
  assert.equal(rightRun({ brief: "b", expect: [] }, ["council"]), false);
});
