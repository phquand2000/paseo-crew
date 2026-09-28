import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "./harness.ts";

const scope = { acceptance: ["a"], outOfScope: ["the rest"] };
const docs = {
  key: "docs",
  title: "Docs",
  goal: "document the cart",
  ...scope,
  holds: ["docs/cart.md"],
  parallel: true,
};

test("a Lead takes a path no other lane holds into its write set on its own, and asks for one another lane holds", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "open_lane", { title: "Cart", outcome: "a cart", ...scope, writeSet: ["src/**"] });
  await h.call(sup, "supervisor", "open_lane", {
    title: "Lib",
    outcome: "a lib",
    ...scope,
    writeSet: ["lib/**"],
    isolate: true,
  });
  const lead = h.ledger().lanes.L1!.lead!;

  const outside = await h.call(lead, "lead", "add_tasks", { tasks: [docs] });
  assert.match(
    outside.text,
    /DOCS holds docs\/cart\.md, outside the lane's write set src\/\*\*: leave it out, or take_paths it first\./,
  );

  const held = await h.call(lead, "lead", "take_paths", { paths: ["lib/util.ts"], why: "the cart needs a helper" });
  assert.equal(held.ok, false);
  assert.match(held.text, /This lane overlaps lane L2 at lib\/util\.ts and lib\/\*\*\. Ask with kind need/);
  assert.deepEqual(h.ledger().lanes.L1!.writeSet, ["src/**"], "a refused take changes nothing");

  const taken = await h.call(lead, "lead", "take_paths", { paths: ["docs/**"], why: "the cart ships with its page" });
  assert.equal(taken.ok, true, taken.text);
  const lane = h.ledger().lanes.L1!;
  assert.deepEqual(lane.writeSet, ["src/**", "docs/**"]);
  assert.deepEqual(lane.amended?.at(-1)?.was, { writeSet: ["src/**"] });
  assert.equal(lane.amended?.at(-1)?.by, lead);
  const told = h.heard(sup).find((text) => text.startsWith("TAKEN"));
  assert.equal(
    told,
    "TAKEN by the Lead of L1 (Cart) into its write set, which no other lane held: docs/**. Why: the cart ships with its page\n\nNext: Nothing, unless the lane's intent rules it out.",
  );
  assert.ok(!h.agents.get(sup)!.sent.includes(told), "the Supervisor is told without being woken");

  const added = await h.call(lead, "lead", "add_tasks", { tasks: [docs] });
  assert.equal(added.ok, true, added.text);
});
