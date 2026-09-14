import assert from "node:assert/strict";
import { test } from "node:test";
import type { Kit, Project } from "../kit.ts";
import { seatEnv } from "./room.ts";

type Request = Parameters<typeof seatEnv>[1];

const kit: Kit = {
  seats: [{ role: "lead", harness: "claude" }],
  profiles: [],
  providers: {},
  harnesses: { claude: { profileRoot: "/profiles", configDirEnv: "CLAUDE_CONFIG_DIR" } },
};
const project: Project = { root: "/repo", slug: "demo", models: {} };
const request = (purpose: "interactive" | "history", provider = "lead"): Request => ({
  agentId: "a1",
  workspaceId: null,
  provider,
  cwd: "/repo/src",
  reason: "create",
  purpose,
  env: { KEEP: "1" },
});

test("a provider that is not a seat passes through untouched", () => {
  const open = request("interactive", "claude");
  assert.equal(seatEnv(kit, open, undefined), open);
});

test("a seat outside a project is refused live and left alone for history", () => {
  assert.throws(() => seatEnv(kit, request("interactive"), undefined), /runs only inside a project/);
  const history = request("history");
  assert.equal(seatEnv(kit, history, undefined), history);
});

test("a missing seat directory is refused live and left alone for history", () => {
  assert.throws(() => seatEnv(kit, request("interactive"), project, () => false), /\/profiles\/lead-demo does not exist/);
  const history = request("history");
  assert.equal(seatEnv(kit, history, project, () => false), history);
});

test("a seat gets its project and config directory in its env", () => {
  assert.deepEqual(seatEnv(kit, request("interactive"), project, () => true).env, {
    KEEP: "1",
    SEATWORKS_REPO: "/repo",
    SEATWORKS_SLUG: "demo",
    SEATWORKS_SEAT: "lead-demo",
    CLAUDE_CONFIG_DIR: "/profiles/lead-demo",
  });
});
