import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import { applyModels } from "../../server/catalog/paseo/models.ts";
import { applyReconcile } from "../../server/catalog/paseo/providers.ts";
import { resolveTeam } from "../../server/catalog/team/team.ts";
import { paseoConfigPath } from "../../server/core/paths.ts";
import { makeKit } from "../kit.ts";

type Provider = {
  extends?: string;
  label?: string;
  command?: string[];
  env?: Record<string, string>;
  description?: string;
  models?: unknown;
  additionalModels?: unknown;
  paseoTools?: unknown;
};
type Config = { agents: { providers: Record<string, Provider> }; daemon: { agentProfiles: { id: string }[] } };
const written = () => JSON.parse(readFileSync(paseoConfigPath(), "utf-8")) as Config;
const SEATS = ["lead-claude", "lead-omp", "peer-omp", "scribe-claude", "scribe-omp", "supervisor-claude"];

test("the plugin writes one provider and profile per seat into Paseo's config, keeps what is the owner's, drops what the kit no longer defines, and a second pass changes nothing", () => {
  const kit = makeKit();
  mkdirSync(dirname(paseoConfigPath()), { recursive: true });
  const owners: Config = {
    agents: {
      providers: {
        claude: { env: { TOKEN: "keep" } },
        peer: { extends: "acp" },
        "sw2-peer": { extends: "acp" },
        "sw2-peer-omp": {
          extends: "claude",
          env: { MY_KEY: "x", CLAUDE_CODE_DISABLE_CRON: "1", CLAUDE_CONFIG_DIR: "/old", SEATWORKS_SLUG: "old" },
          description: "stale",
          models: [{ id: "glm", label: "GLM" }],
        },
      },
    },
    daemon: { agentProfiles: [{ id: "mine" }, { id: "sw2-peer" }] },
  };
  writeFileSync(paseoConfigPath(), JSON.stringify(owners), { mode: 0o600 });

  const changed = applyReconcile(kit, resolveTeam(kit));
  assert.deepEqual(
    changed.sort(),
    [
      ...SEATS.flatMap((seat) => [`profile sw2-${seat}`, `provider sw2-${seat}`]),
      "profile sw2-peer removed",
      "provider sw2-peer removed",
    ].sort(),
  );
  assert.equal(statSync(paseoConfigPath()).mode & 0o777, 0o600, "a private config is not widened");
  const { agents, daemon } = written();
  assert.deepEqual(
    [agents.providers.claude, agents.providers.peer],
    [{ env: { TOKEN: "keep" } }, { extends: "acp" }],
    "the owner's own are kept",
  );
  assert.equal("sw2-peer" in agents.providers, false);
  const lead = agents.providers["sw2-lead-claude"]!;
  assert.deepEqual(
    [lead.extends, lead.label, lead.command, lead.env?.SEATWORKS_ROLE, lead.env?.SEATWORKS_KIT],
    ["claude", "Lead · Claude Code (sw2)", [`${kit.dir}/bin/seat-room`], "lead", kit.dir],
  );
  assert.equal(
    lead.models,
    undefined,
    "Paseo lists the agent's own models: replacing that list hid every model but the chosen one",
  );
  assert.deepEqual(lead.additionalModels, [{ id: "opus", label: "Opus", isDefault: true }]);
  const peer = agents.providers["sw2-peer-omp"]!;
  assert.equal(peer.extends, "omp");
  assert.deepEqual(
    Object.keys(peer.env ?? {}).sort(),
    ["MY_KEY", "SEATWORKS_AGENT_BIN", "SEATWORKS_HARNESS", "SEATWORKS_KIT", "SEATWORKS_ROLE"],
    "what the kit manages is its own to drop, and the owner's keys stay",
  );
  assert.deepEqual(
    [peer.description, peer.models, peer.additionalModels],
    [undefined, undefined, [{ id: "glm", label: "GLM", isDefault: true }]],
  );
  assert.deepEqual(peer.paseoTools, { enabled: false });
  assert.deepEqual(daemon.agentProfiles[0], { id: "mine" });
  assert.deepEqual(
    daemon.agentProfiles.find((profile) => profile.id === "sw2-peer-omp"),
    {
      id: "sw2-peer-omp",
      name: "Peer · Oh My Pi (sw2)",
      provider: "sw2-peer-omp",
      model: "glm",
      modeId: "full",
    },
  );
  const held = readFileSync(paseoConfigPath(), "utf-8");
  assert.deepEqual(applyReconcile(kit, resolveTeam(kit)), []);
  assert.equal(readFileSync(paseoConfigPath(), "utf-8"), held, "a second pass writes nothing");

  assert.deepEqual(applyReconcile(kit, resolveTeam(kit, { roles: { lead: { model: "haiku" } } })).sort(), [
    "profile sw2-lead-claude",
    "provider sw2-lead-claude",
  ]);
  assert.deepEqual(
    written().agents.providers["sw2-lead-claude"]!.additionalModels,
    [{ id: "haiku", label: "Haiku", isDefault: true }],
    "the model it starts on is the one chosen",
  );
  const listed = makeKit();
  applyModels(listed, {
    omp: {
      at: "",
      error: null,
      models: [
        { id: "claude-in-omp", label: "Claude in omp" },
        { id: "glm", label: "GLM" },
      ],
    },
  });
  applyReconcile(listed, resolveTeam(listed));
  assert.deepEqual(
    written().agents.providers["sw2-lead-omp"]!.additionalModels,
    [{ id: "glm", label: "GLM", isDefault: true }],
    "a role on an agent its preset does not name starts on another role's preset there, not the first listed",
  );
});
