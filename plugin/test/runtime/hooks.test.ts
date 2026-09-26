import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PaseoHost } from "../../server/adapters/paseo/host.ts";
import { SEAT_KEY } from "../../server/catalog/kit/kit.ts";
import { seatDir } from "../../server/catalog/seat/seats.ts";
import { home } from "../../server/core/paths.ts";
import type { AgentConfig } from "../../server/core/ports.ts";
import { projectOf } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

type Hook = (input: unknown, context: { paseo: unknown }) => unknown;
type Made = { config: AgentConfig; env: Record<string, string> };

/** Paseo's plugin server as far as a host registers on it: each hook called as the daemon calls it, with its API. */
function daemon(host: PaseoHost, h: ReturnType<typeof harness>) {
  const hooks = new Map<string, Hook>();
  const register = (name: string, hook: Hook) => void hooks.set(name, hook);
  host.connect({ before: register, on: register } as unknown as PluginServerContext, h.runtime);
  return (name: string, input: unknown) => hooks.get(name)!(input, { paseo: h.paseo });
}

/** Whether `promise` has settled by the time every job already queued has run. */
const settled = (promise: Promise<unknown>) =>
  Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))]);

test("a seat as Paseo creates, opens and archives it: prompt, key, seat directory, and the daemon handle every hook brings", async () => {
  const h = harness();
  const host = new PaseoHost();
  h.restart(host);
  const hook = daemon(host, h);
  await assert.rejects(host.seats.open(), /has not reached this plugin/, "not listed as nobody seated");
  await assert.rejects(host.workspaces.owned("shop-1a2b"), /has not reached this plugin/);
  assert.equal(await settled(host.reached()), false);

  const create = (provider: string, env: Record<string, string> = {}) =>
    hook("agent.create", { request: { config: { provider, cwd: h.root }, env } }) as Made;
  const made = create("sw2-lead-claude", { KEPT: "yes" });
  assert.equal(await settled(host.reached()), true, "the hook brought Paseo's API");
  const key = made.env[SEAT_KEY]!;
  assert.match(key, /^[0-9a-f]{48}$/);
  assert.equal(made.env.KEPT, "yes", "what Paseo passed stays");
  assert.equal((made.config.mcpServers?.team as { env?: Record<string, string> }).env?.[SEAT_KEY], key);
  assert.notEqual(create("sw2-lead-claude").env[SEAT_KEY], key, "each seat its own");
  assert.match(
    create("sw2-peer-omp").env[SEAT_KEY]!,
    /^[0-9a-f]{48}$/,
    "a harness reading servers from a file shared by its seats gets the key through the env alone",
  );
  assert.equal(create("sw2-pager-claude").env[SEAT_KEY], undefined, "a seat with no tools has no server to give it to");
  const prompt = (provider: string) => create(provider).config.systemPrompt ?? "";
  const onClaude = prompt("sw2-peer-claude");
  assert.match(onClaude, /^# Peer\n/, "created with its role's prompt");
  const delta = readFileSync(join(import.meta.dirname, "..", "..", "harness", "codex", "delta", "peer.md"), "utf-8");
  assert.equal(prompt("sw2-peer-codex"), `${onClaude.trimEnd()}\n\n${delta}`, "then what its harness needs said");

  const open = (agentId: string, reason: string, env: Record<string, string> = {}, cwd = h.root) =>
    (hook("agent.session_open", { request: { agentId, reason, provider: "sw2-lead-claude", cwd, env } }) as Made).env;
  assert.equal(open("agent-9", "create", { [SEAT_KEY]: "k9" })[SEAT_KEY], "k9");
  assert.equal(open("agent-9", "resume")[SEAT_KEY], "k9", "a resumed seat's server starts again with its key");
  assert.equal(open("agent-0", "resume")[SEAT_KEY], undefined, "a seat never given one gets none");

  const { kit } = h.runtime;
  const lead = kit.roles.find((role) => role.role === "lead")!;
  const claude = kit.harnesses.claude!;
  const link = join(seatDir(kit, lead, claude, home(), h.project), "projects");
  assert.throws(() => lstatSync(link), "nothing to link to yet");
  mkdirSync(join(home(), ".claude", "projects"), { recursive: true });
  open("agent-9", "resume");
  assert.equal(lstatSync(link).isSymbolicLink(), true, "a login made after a seat was built reaches it when it opens");

  // A seat's own directory is added, and Claude reads an added directory's CLAUDE.md but never its AGENTS.md.
  const root = tempDir("sw2-supervisor-project-");
  writeFileSync(join(root, "AGENTS.md"), "Use pnpm.\n");
  const file = join(seatDir(kit, lead, claude, home(), projectOf(root)), "CLAUDE.md");
  const rules = () => (existsSync(file) ? readFileSync(file, "utf-8") : "");
  open("agent-7", "create", {}, root);
  assert.match(
    rules(),
    new RegExp(`^@${join(root, "AGENTS.md")}$`, "m"),
    "a Claude seat takes in the project's AGENTS.md, though its path holds a word the Lead must not see",
  );
  writeFileSync(join(root, "CLAUDE.md"), "Use npm.\n");
  open("agent-7", "resume", {}, root);
  assert.doesNotMatch(rules(), /AGENTS\.md/, "and reads the project's CLAUDE.md in its place once there is one");

  await hook("agent.archived", { agent: { id: "agent-9", provider: "sw2-lead-claude", cwd: h.root } });
  assert.equal(open("agent-9", "resume")[SEAT_KEY], undefined, "a seat archived lets its key go");

  const ways: [string, unknown][] = [
    ["agent.create", { request: { config: { provider: "sw2-lead-claude", cwd: h.root }, env: {} } }],
    [
      "agent.session_open",
      { request: { agentId: "agent-8", reason: "resume", provider: "sw2-lead-claude", cwd: h.root, env: {} } },
    ],
    ["agent.turn_started", { agent: { id: "agent-8", provider: "sw2-lead-claude", cwd: h.root } }],
  ];
  for (const [name, input] of ways) {
    const fresh = new PaseoHost();
    const call = daemon(fresh, h);
    assert.equal(await settled(fresh.reached()), false, `nothing has reached the host before ${name}`);
    await call(name, input);
    assert.equal(await settled(fresh.reached()), true, `${name} brings Paseo's API`);
  }
});
