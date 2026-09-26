import assert from "node:assert/strict";
import { test } from "node:test";
import { switchTo } from "../../server/core/git.ts";
import { harness } from "./harness.ts";

const scope = { outcome: "x", acceptance: ["a"], outOfScope: ["anything else in the repository"] };

function tracked() {
  const h = harness();
  h.git(h.root, "config", "branch.autoSetupMerge", "inherit");
  h.git(h.root, "config", "branch.main.remote", "origin");
  h.git(h.root, "config", "branch.main.merge", "refs/heads/main");
  return h;
}

const upstream = (h: ReturnType<typeof harness>, branch: string) =>
  h
    .git(h.root, "config", "--list")
    .split("\n")
    .filter((line) => line.startsWith(`branch.${branch}.`))
    .join(" ");

test("no branch the desk starts tracks its base's upstream, so a first push cannot land on main", async () => {
  const h = tracked();
  const sup = h.add("sw2-supervisor-claude/claude-opus-5", h.root, "sup");
  await h.call(sup, "supervisor", "set_project", { base: "main" });
  assert.equal((await h.call(sup, "supervisor", "open_lane", { title: "Away", ...scope, isolate: true })).ok, true);
  assert.equal((await h.call(sup, "supervisor", "open_lane", { title: "Here", ...scope })).ok, true);
  for (const lane of Object.values(h.ledger().lanes))
    assert.equal(upstream(h, lane.branch), "", `${lane.id} on ${lane.branch}`);
  h.runtime.dispose();

  const n = tracked();
  const nsup = n.add("sw2-supervisor-claude/claude-opus-5", n.root, "sup");
  await n.call(nsup, "supervisor", "set_project", { base: "main" });
  const opened = await n.call(nsup, "supervisor", "open_lane", {
    title: "Split off",
    ...scope,
    onBranch: true,
    newBranch: "fix/split",
  });
  assert.equal(opened.ok, true, opened.text);
  assert.equal(upstream(n, "fix/split"), "");
  n.runtime.dispose();
});

test("a branch switchTo creates does not track its start's upstream", async () => {
  const h = tracked();
  assert.equal(await switchTo(h.root, "task/one", "main"), undefined);
  assert.equal(upstream(h, "task/one"), "");
  h.runtime.dispose();
});
