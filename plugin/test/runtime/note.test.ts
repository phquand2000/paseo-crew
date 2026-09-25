import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { laneWithPeer } from "./harness.ts";

test("a Lead keeps a page in a folder its role writes under the project's state, and nowhere else", async () => {
  const { h, lane } = await laneWithPeer();
  const note = (args: Record<string, unknown>) => h.call(lane.lead!, "lead", "note", args);
  const file = join(h.project.state, "plans", "cart-plan.md");

  const wrote = await note({ kind: "plans", name: "cart-plan.md", text: "# Cart\n\nTotals first." });
  assert.equal(wrote.text, `Wrote ${file}. Name it by that path wherever you point to it.`);
  assert.equal(readFileSync(file, "utf-8"), "# Cart\n\nTotals first.\n");
  assert.match((await note({ kind: "plans/", name: "cart-plan.md", text: "# Cart\n\nTax first.\n" })).text, /^Replaced /);
  assert.equal(readFileSync(file, "utf-8"), "# Cart\n\nTax first.\n");

  assert.match((await note({ kind: "gates", name: "x.md", text: "t" })).text, /gates is no folder you keep pages in: plans, council, ultra-review, repo-refresh\./);
  assert.match((await note({ kind: "..", name: "ledger.json", text: "{}" })).text, /\.\. is no folder you keep pages in/);
  assert.match((await note({ kind: "plans", name: "../ledger.json", text: "{}" })).text, /\.\.\/ledger\.json is not one file name/);
  assert.deepEqual(h.events("note.written").map(({ file, replaced }) => [file, replaced]), [["plans/cart-plan.md", false], ["plans/cart-plan.md", true]]);
});
