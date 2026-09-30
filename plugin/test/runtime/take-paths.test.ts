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

test("a Lead takes paths into its write set on its own, told of a lane beside that writes them too, whose Lead is told", async () => {
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

  const taken = await h.call(lead, "lead", "take_paths", { paths: ["docs/**"], why: "the cart ships with its page" });
  assert.equal(taken.ok, true, taken.text);
  assert.doesNotMatch(taken.text, /works beside/);
  const lane = h.ledger().lanes.L1!;
  assert.deepEqual(lane.writeSet, ["src/**", "docs/**"]);
  assert.deepEqual(lane.amended?.at(-1)?.was, { writeSet: ["src/**"] });
  assert.equal(lane.amended?.at(-1)?.by, lead);
  const told = h.heard(sup).find((text) => text.startsWith("TAKEN"));
  assert.equal(
    told,
    "TAKEN by the Lead of L1 (Cart) into its write set: docs/**. Why: the cart ships with its page\n\nNext: Nothing, unless the lane's intent rules it out.",
  );
  assert.ok(!h.agents.get(sup)!.sent.includes(told), "the Supervisor is told without being woken");

  const shared = await h.call(lead, "lead", "take_paths", { paths: ["lib/util.ts"], why: "the cart needs a helper" });
  assert.equal(shared.ok, true, shared.text);
  assert.match(
    shared.text,
    /It now works beside lanes that may write the same: L2 \(lib\/util\.ts and lib\/\*\*\); their Leads are told\./,
  );
  assert.deepEqual(h.ledger().lanes.L1!.writeSet, ["src/**", "docs/**", "lib/util.ts"]);
  assert.match(
    h.heard(h.ledger().lanes.L2!.lead!).join("\n"),
    /LANE BESIDE L1 \(Cart\) works beside your lane and may write what yours does: lib\/util\.ts and lib\/\*\*\./,
  );
  assert.match(
    h.heard(sup).join("\n"),
    /TAKEN by the Lead of L1 \(Cart\)[^]*It now works beside lanes[^]*L2 \(lib\/util\.ts and lib\/\*\*\)/,
  );

  const added = await h.call(lead, "lead", "add_tasks", { tasks: [docs] });
  assert.equal(added.ok, true, added.text);
  assert.doesNotMatch(added.text, /outside the lane's write set/);
});
