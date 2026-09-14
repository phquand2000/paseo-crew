import assert from "node:assert/strict";
import { test } from "node:test";
import type { Kit, Project } from "../kit.ts";
import { applyProfile, launchReasons } from "./launch.ts";

type Config = Parameters<typeof applyProfile>[1];

const kit: Kit = {
  seats: [
    { role: "lead", harness: "claude", mayStart: ["peer", "reviewer"] },
    { role: "peer", harness: "omp" },
    { role: "reviewer", harness: "omp" },
  ],
  profiles: [
    { provider: "reviewer", model: "zai/glm-5.3", modeId: "full", thinkingOptionId: "max" },
    { provider: "peer", model: "zai/glm-5.3-flash" },
  ],
  providers: { reviewer: { models: [{ id: "zai/glm-5.3" }, { id: "zai/glm-5.3-flash" }] } },
  harnesses: {},
};
const project: Project = { root: "/repo", slug: "repo", models: {} };
const config = (extra: Partial<Config> = {}): Config => ({ provider: "reviewer", cwd: "/repo", ...extra }) as Config;

test("a provider that is not a seat passes through untouched", () => {
  const request = config({ provider: "claude" });
  assert.equal(applyProfile(kit, request, undefined), request);
});

test("a seat outside a project is refused", () => {
  assert.throws(() => applyProfile(kit, config(), undefined), /starts only inside a project that has \.seatworks/);
});

test("the profile fills the model, mode and thinking level", () => {
  const result = applyProfile(kit, config(), project);
  assert.equal(result.model, "zai/glm-5.3");
  assert.equal(result.modeId, "full");
  assert.equal(result.thinkingOptionId, "max");
});

test("an offered model and a thinking level passed at launch are kept", () => {
  const result = applyProfile(kit, config({ model: "zai/glm-5.3-flash", thinkingOptionId: "high" }), project);
  assert.equal(result.model, "zai/glm-5.3-flash");
  assert.equal(result.thinkingOptionId, "high");
});

test("a model the seat does not offer is refused", () => {
  assert.throws(() => applyProfile(kit, config({ model: "claude-opus-5" }), project), /runs zai\/glm-5\.3 or zai\/glm-5\.3-flash/);
});

test("a model the project pins wins over the profile's", () => {
  const pinned: Project = { ...project, models: { reviewer: "zai/glm-5.3-flash" } };
  assert.equal(applyProfile(kit, config(), pinned).model, "zai/glm-5.3-flash");
});

test("launchReasons names a role the parent may not start and a start in another project", () => {
  const rootOf = (cwd: string) => (cwd.startsWith("/a") ? "/a" : cwd.startsWith("/b") ? "/b" : undefined);
  assert.deepEqual(launchReasons(kit, { provider: "peer", cwd: "/a/x" }, { provider: "lead", cwd: "/a" }, rootOf), []);
  assert.deepEqual(launchReasons(kit, { provider: "reviewer", cwd: "/a" }, { provider: "peer", cwd: "/a" }, rootOf), [
    "a peer starts no agents",
  ]);
  assert.deepEqual(launchReasons(kit, { provider: "peer", cwd: "/b" }, { provider: "lead", cwd: "/a" }, rootOf), [
    "it runs outside /a, where a seat would load another project's prompts and records",
  ]);
});
