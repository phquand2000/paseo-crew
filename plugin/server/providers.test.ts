import assert from "node:assert/strict";
import { test } from "node:test";
import { desiredProfile, desiredProvider, reconcile } from "./providers.ts";
import { makeKit } from "./testkit.ts";

const kit = makeKit();

test("a role provider carries its harness base, launcher, env, models and tool limits", () => {
  const lead = kit.roles.find((role) => role.role === "lead")!;
  const entry = desiredProvider(kit, lead);
  assert.equal(entry.extends, "claude");
  assert.deepEqual(entry.command, [`${kit.dir}/bin/seat-room`]);
  assert.equal(entry.env.SEATWORKS_ROLE, "lead");
  assert.equal(entry.env.SEATWORKS_KIT, kit.dir);
  assert.equal(entry.models.length, 2);
  const peer = kit.roles.find((role) => role.role === "peer")!;
  assert.deepEqual(desiredProvider(kit, peer).paseoTools, { enabled: false });
  assert.deepEqual(desiredProfile(kit, peer), { id: "sw2-peer", name: "Peer", provider: "sw2-peer", model: "swe", modeId: "bypass" });
});

test("reconcile adds the role providers and profiles and is idempotent", () => {
  const config = { agents: { providers: { claude: { env: { TOKEN: "keep" } } } }, daemon: { agentProfiles: [{ id: "mine", provider: "claude" }] } };
  const first = reconcile(config, kit);
  assert.deepEqual(first.changed.sort(), [
    "profile sw2-lead",
    "profile sw2-peer",
    "profile sw2-supervisor",
    "provider sw2-lead",
    "provider sw2-peer",
    "provider sw2-supervisor",
  ]);
  assert.equal(first.config.agents.providers.claude.env.TOKEN, "keep");
  assert.equal(first.config.daemon.agentProfiles[0].id, "mine");
  assert.deepEqual(reconcile(first.config, kit).changed, []);
});

test("reconcile keeps a user's own env keys and drops keys from another harness", () => {
  const config = {
    agents: {
      providers: {
        "sw2-peer": { extends: "claude", env: { MY_KEY: "x", CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CONFIG_DIR: "/old", SEATWORKS_SLUG: "old" }, description: "stale" },
      },
    },
  };
  const { config: next } = reconcile(config, kit);
  const peer = next.agents.providers["sw2-peer"];
  assert.equal(peer.extends, "acp");
  assert.deepEqual(Object.keys(peer.env).sort(), ["MY_KEY", "SEATWORKS_HARNESS", "SEATWORKS_KIT", "SEATWORKS_ROLE"]);
  assert.equal("description" in peer, false);
});
