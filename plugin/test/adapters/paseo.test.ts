import assert from "node:assert/strict";
import { test } from "node:test";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";

test("before the daemon hands the plugin its handle, seats and workspaces cannot be listed, rather than listed as none", async () => {
  const host = new PaseoHost();
  await assert.rejects(host.seats.open(), /has not reached this plugin/);
  await assert.rejects(host.workspaces.owned("shop-1a2b"), /has not reached this plugin/);
});
