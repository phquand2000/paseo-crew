import assert from "node:assert/strict";
import { test } from "node:test";
import { SeatKeys } from "../../server/runtime/keys.ts";
import { harness } from "./harness.ts";

const KEY = "SEATWORKS_DESK_KEY";

test("a seat with tools is given a key as it is created: in its env, and in its team server's where the harness keeps one per seat", () => {
  const h = harness();
  const made = h.runtime.create({ provider: "sw2-lead-claude", cwd: h.root }, { KEPT: "yes" });
  const key = made.env[KEY]!;
  assert.match(key, /^[0-9a-f]{48}$/);
  assert.equal(made.env.KEPT, "yes", "what Paseo passed stays");
  assert.equal((made.config.mcpServers?.team as { env?: Record<string, string> }).env?.[KEY], key);
  const other = h.runtime.create({ provider: "sw2-lead-claude", cwd: h.root }, {});
  assert.notEqual(other.env[KEY], key, "each seat its own");
  const onFile = h.runtime.create({ provider: "sw2-peer-omp", cwd: h.root }, {});
  assert.match(
    onFile.env[KEY]!,
    /^[0-9a-f]{48}$/,
    "a harness reading servers from a file shared by its seats gets the key through the env alone",
  );
  assert.equal(
    h.runtime.create({ provider: "sw2-pager-claude", cwd: h.root }, {}).env[KEY],
    undefined,
    "a seat with no tools has no server to give it to",
  );
});

test("the desk binds a key to its agent as Paseo opens the seat, gives it back each time the seat opens again, and lets it go once archived", async () => {
  const h = harness();
  const keys = new SeatKeys();
  const open = (reason: "create" | "resume", env: Record<string, string> = {}) =>
    h.runtime.sessionOpen({ agentId: "agent-9", reason, provider: "sw2-lead-claude", cwd: h.root, env });
  assert.equal(open("create", { [KEY]: "k9" }).env[KEY], "k9");
  assert.equal(keys.agentOf("k9"), "agent-9");
  assert.equal(open("resume").env[KEY], "k9", "a resumed seat's server starts again with the key it was created with");
  assert.equal(
    h.runtime.sessionOpen({ agentId: "agent-0", reason: "resume", provider: "sw2-lead-claude", cwd: h.root, env: {} })
      .env[KEY],
    undefined,
    "a seat never given one gets none",
  );
  await h.runtime.archived({ id: "agent-9", provider: "sw2-lead-claude", cwd: h.root });
  assert.equal(keys.agentOf("k9"), undefined);
  assert.equal(keys.agentOf(""), undefined, "no key is nobody's");
});
