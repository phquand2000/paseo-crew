import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import type { Kit } from "./kit.ts";
import { projectAt, readProject } from "./project.ts";

const kit: Kit = {
  seats: [{ role: "watcher", harness: "omp", sweepMinutes: 15 }],
  profiles: [],
  providers: {},
  harnesses: {},
};

test("an absent setting takes the kit's sweep period, and pushback waits two of them", () => {
  const project = readProject("/repo/demo", { slug: "demo" }, kit);
  assert.deepEqual(project, {
    root: "/repo/demo",
    slug: "demo",
    models: {},
    attention: { sweepMinutes: 15, pushbackMinutes: 30, escalateAfter: 3 },
    problems: [],
  });
  assert.equal(readProject("/repo/demo", undefined).attention.sweepMinutes, 10);
});

test("a project's own settings win, and pushback follows its sweep period unless it names one", () => {
  const swept = readProject("/repo", { attention: { sweepMinutes: 5 } }, kit);
  assert.deepEqual(swept.attention, { sweepMinutes: 5, pushbackMinutes: 10, escalateAfter: 3 });
  const named = readProject("/repo", { models: { lead: "claude-opus-5" }, attention: { pushbackMinutes: 45, escalateAfter: 2 }, tracker: {} }, kit);
  assert.deepEqual(named.attention, { sweepMinutes: 15, pushbackMinutes: 45, escalateAfter: 2 });
  assert.deepEqual(named.models, { lead: "claude-opus-5" });
  assert.deepEqual(named.problems, []);
});

test("an invalid value falls back to its default and names the problem", () => {
  const project = readProject("/repo", { slug: 7, models: { lead: 1 }, attention: { sweepMinutes: 0, escalateAfter: 2.5 } }, kit);
  assert.equal(project.slug, "repo");
  assert.deepEqual(project.models, {});
  assert.deepEqual(project.attention, { sweepMinutes: 15, pushbackMinutes: 30, escalateAfter: 3 });
  assert.deepEqual(project.problems, [
    "models.lead must be a model id; ignoring it",
    "attention.sweepMinutes must be a whole number of at least 1; using 15",
    "attention.escalateAfter must be a whole number of at least 1; using 3",
  ]);
  assert.deepEqual(readProject("/repo", [1]).problems, ["is not a JSON object; using defaults"]);
});

test("projectAt reads the file and reports one that is not JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "seatworks-project-"));
  mkdirSync(join(dir, ".seatworks"));
  assert.deepEqual(projectAt(dir).problems, []);
  assert.equal(projectAt(dir).slug, basename(dir));
  writeFileSync(join(dir, ".seatworks", "project.json"), JSON.stringify({ slug: "demo", attention: { sweepMinutes: 20 } }));
  assert.equal(projectAt(dir, kit).slug, "demo");
  assert.equal(projectAt(dir, kit).attention.pushbackMinutes, 40);
  writeFileSync(join(dir, ".seatworks", "project.json"), "{ slug: demo");
  assert.deepEqual(projectAt(dir).problems, ["is not valid JSON; using defaults"]);
});
