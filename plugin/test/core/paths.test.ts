import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { paseoConfigPath, paseoHome } from "../../server/core/paths.ts";

test("the plugin reads and writes the config of the Paseo it runs in, which PASEO_HOME names", () => {
  process.env.HOME = "/home/me";
  assert.equal(paseoConfigPath(), join("/home/me", ".paseo", "config.json"));
  process.env.PASEO_HOME = "/tmp/spike/paseo";
  assert.equal(paseoConfigPath(), join("/tmp/spike/paseo", "config.json"));
  assert.equal(paseoHome(), "/tmp/spike/paseo");
  process.env.PASEO_HOME = "~/other";
  assert.equal(paseoHome(), join("/home/me", "other"));
});
