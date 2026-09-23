import assert from "node:assert/strict";
import { test } from "node:test";
import { desiredProfile, desiredProvider, reconcile, seatPairs } from "../../server/catalog/providers.ts";
import { resolveTeam } from "../../server/catalog/team.ts";
import { makeKit } from "../kit.ts";

const kit = makeKit();
const team = resolveTeam(kit);
const role = (name: string) => kit.roles.find((entry) => entry.role === name)!;

test("every role gets a provider on each harness that has settings for it", () => {
  assert.deepEqual(
    seatPairs(kit).map((pair) => `${pair.role.role}-${pair.harness.id}`).sort(),
    ["lead-claude", "lead-devin", "peer-devin", "scribe-claude", "scribe-devin", "supervisor-claude"],
  );
});

test("a role provider carries its harness base, launcher, env, the model it starts on, and tool limits", () => {
  const entry = desiredProvider(kit, team, role("lead"), kit.harnesses.claude!);
  assert.equal(entry.extends, "claude");
  assert.equal(entry.label, "Lead · Claude Code (crew)");
  assert.deepEqual(entry.command, [`${kit.dir}/bin/seat-room`]);
  assert.equal(entry.env.PASEO_CREW_ROLE, "lead");
  assert.equal(entry.env.PASEO_CREW_KIT, kit.dir);
  // Paseo lists the agent's own models; replacing that list hid every model but the chosen one.
  assert.equal(entry.models, undefined);
  assert.deepEqual(entry.additionalModels, [{ id: "opus", label: "Opus", isDefault: true }]);
  const chosen = desiredProvider(kit, resolveTeam(kit, { roles: { lead: { model: "haiku" } } }), role("lead"), kit.harnesses.claude!);
  assert.deepEqual(chosen.additionalModels, [{ id: "haiku", label: "Haiku", isDefault: true }]);
  assert.deepEqual(desiredProvider(kit, team, role("peer"), kit.harnesses.devin!).paseoTools, { enabled: false });
  assert.deepEqual(desiredProfile(kit, team, role("peer"), kit.harnesses.devin!), { id: "crew-peer-devin", name: "Peer · Devin CLI (crew)", provider: "crew-peer-devin", model: "swe", modeId: "bypass" });
});

test("reconcile adds the role providers and profiles and is idempotent", () => {
  const config = { agents: { providers: { claude: { env: { TOKEN: "keep" } } } }, daemon: { agentProfiles: [{ id: "mine", provider: "claude" }] } };
  const first = reconcile(config, kit, team);
  assert.deepEqual(first.changed.sort(), [
    "profile crew-lead-claude",
    "profile crew-lead-devin",
    "profile crew-peer-devin",
    "profile crew-scribe-claude",
    "profile crew-scribe-devin",
    "profile crew-supervisor-claude",
    "provider crew-lead-claude",
    "provider crew-lead-devin",
    "provider crew-peer-devin",
    "provider crew-scribe-claude",
    "provider crew-scribe-devin",
    "provider crew-supervisor-claude",
  ]);
  assert.equal(first.config.agents.providers.claude.env.TOKEN, "keep");
  assert.equal(first.config.daemon.agentProfiles[0].id, "mine");
  assert.deepEqual(reconcile(first.config, kit, team).changed, []);
});

test("reconcile removes providers the kit no longer defines and keeps a user's own env keys", () => {
  const config = {
    agents: {
      providers: {
        "crew-peer": { extends: "acp" },
        "crew-peer-devin": { extends: "claude", env: { MY_KEY: "x", CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CONFIG_DIR: "/old", PASEO_CREW_SLUG: "old" }, description: "stale", models: [{ id: "swe", label: "SWE" }] },
        peer: { extends: "acp" },
      },
    },
    daemon: { agentProfiles: [{ id: "crew-peer", provider: "crew-peer" }] },
  };
  const { config: next, changed } = reconcile(config, kit, team);
  assert.ok(changed.includes("provider crew-peer removed"));
  assert.ok(changed.includes("profile crew-peer removed"));
  assert.equal("crew-peer" in next.agents.providers, false);
  assert.ok("peer" in next.agents.providers);
  const peer = next.agents.providers["crew-peer-devin"];
  assert.equal(peer.extends, "acp");
  assert.deepEqual(Object.keys(peer.env).sort(), ["MY_KEY", "PASEO_CREW_AGENT_BIN", "PASEO_CREW_HARNESS", "PASEO_CREW_KIT", "PASEO_CREW_ROLE"]);
  assert.equal("description" in peer, false);
  // A list written over Paseo's own hid every model the agent has but the one chosen.
  assert.equal("models" in peer, false);
  assert.deepEqual(peer.additionalModels, [{ id: "swe", label: "SWE", isDefault: true }]);
});
