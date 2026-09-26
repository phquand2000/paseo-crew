import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { can, loadKit, roleNamed, roleThatCan, rolesThatCan, toolsOf } from "../../server/catalog/kit.ts";
import { renderPrompt } from "../../server/catalog/content.ts";
import { HarnessFile } from "../../server/catalog/schema.ts";
import { tempDir } from "../tempdir.ts";

/** A kit of the test's own, holding the shipped ecosystem, Paseo's tools, the watch's questions and what a seat's PATH refuses: no fixture's to make up. */
function kitDir(prefix: string): string {
  const dir = tempDir(prefix);
  mkdirSync(join(dir, "catalog"), { recursive: true });
  for (const name of ["ecosystem.json", "paseo.json", "checks.json", "refused.json"]) copyFileSync(new URL(`../../catalog/${name}`, import.meta.url), join(dir, "catalog", name));
  return dir;
}

const good = () => ({
  id: "acme",
  label: "Acme CLI",
  baseProvider: "omp",
  configDirEnv: "ACME_CONFIG_DIR",
  profileRoot: "HOME/.acme/seats",
  skillsDir: "skills",
  settings: { file: "config.json", source: "settings.json", roleSource: "settings/ROLE.settings.json" },
  mcp: { file: "mcp.json", delivery: "file", transports: ["stdio"], key: "mcpServers" },
  provider: { profileModeId: "full" },
});

/** Each field a harness file gets wrong, by its path: an unknown field by its own name. */
function wrong(harness: object): string[] {
  const read = HarnessFile.safeParse(harness);
  if (read.success) return [];
  return read.error.issues.flatMap((issue) => (issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".")]));
}

test("a harness is refused for a field no contract knows or a missing one, and one that fills it passes", () => {
  assert.deepEqual(wrong(good()), []);
  assert.deepEqual(wrong({ ...good(), skillDir: "skills" }), ["skillDir"]);
  const { label: _label, ...noLabel } = good();
  assert.deepEqual(wrong(noLabel), ["label"]);
});

test("the way a harness takes its servers and settings is checked, not assumed", () => {
  assert.deepEqual(wrong({ ...good(), mcp: { file: "mcp.json", delivery: "file", transports: ["stdio"] } }), ["mcp.key"]);
  assert.deepEqual(wrong({ ...good(), settings: { file: "config.json", source: "settings.json" } }), ["settings.roleSource"]);
  assert.deepEqual(wrong({ ...good(), projectContextOption: ["additionalDirectories"] }), ["projectContextOption"]);
  assert.deepEqual(wrong({ ...good(), projectContextOption: "" }), ["projectContextOption"]);
  assert.deepEqual(wrong({ ...good(), projectContextOption: "additionalDirectories" }), []);
  assert.deepEqual(wrong({ ...good(), mcpCall: "mcp__team__{tool}" }), ["mcpCall"], "a call name with nowhere for the server's name");
});

test("a role follows one other role that chooses for itself, and takes its defaults", () => {
  const dir = kitDir("sw2-kit-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  const peer = { role: "peer", label: "Peer", defaults: { harness: "acme", model: "m" }, prompt: "prompts/PEER.md", skills: null };
  const roles = (...more: object[]) => writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [peer, ...more] }));
  const follower = (extra: object = {}) => ({ role: "archivist", label: "Archivist", follows: "peer", prompt: "prompts/ARCHIVIST.md", skills: null, ...extra });

  roles(follower());
  assert.deepEqual(roleNamed(loadKit(dir), "archivist")!.defaults, { harness: "acme", model: "m" });
  roles(follower({ defaults: { harness: "acme" } }));
  assert.throws(() => loadKit(dir), /role archivist follows peer and names defaults of its own/);
  roles(follower({ follows: "nobody" }));
  assert.throws(() => loadKit(dir), /role archivist follows nobody, which is no other role/);
  roles(follower({ follows: "archivist" }));
  assert.throws(() => loadKit(dir), /role archivist follows archivist, which is no other role/);
  roles(follower(), { ...follower(), role: "echo", follows: "archivist" });
  assert.throws(() => loadKit(dir), /role echo follows archivist, which follows peer in turn/);
  roles(follower({ extraSkills: ["council"] }));
  assert.throws(() => loadKit(dir), /roles\.json is not as the kit reads it:[^]*is not written set:name[^]*extraSkills/, "an extra skill names its set as well");
});

test("loading a kit refuses a harness that breaks the contract, naming the field", () => {
  const dir = kitDir("sw2-kit-");
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [{ role: "peer", label: "Peer", defaults: { harness: "acme" }, prompt: "prompts/PEER.md", skills: null }] }));
  const write = (harness: Record<string, unknown>) => writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(harness));

  write({ ...good(), skillDir: "skills" });
  assert.throws(() => loadKit(dir), /harness acme is not as the kit reads it:[^]*skillDir/);
  write({ ...good(), id: "other" });
  assert.throws(() => loadKit(dir), /harness acme calls itself other but sits in harness\/acme/);

  write(good());
  assert.deepEqual(Object.keys(loadKit(dir).harnesses), ["acme"]);
});

test("a command refused on a seat's PATH is never the agent a seat starts with or its git, and an owner's own list replaces the kit's", () => {
  const dir = kitDir("sw2-refused-");
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [] }));
  mkdirSync(join(dir, "harness", "acme"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify({ ...good(), provider: { env: { SEATWORKS_AGENT_BIN: "acme" } } }));
  const mine = tempDir("sw2-refused-mine-");
  const refuse = (list: object) => writeFileSync(join(mine, "refused.json"), JSON.stringify(list));
  refuse({ acme: "agents start through the desk" });
  assert.throws(() => loadKit(dir, mine), /refused\.json refuses acme, which every acme seat is started with/);
  refuse({ git: "the desk's" });
  assert.throws(() => loadKit(dir, mine), /refused\.json refuses git, which the kit's git shim runs/);
  refuse({ "hub cli": "the forge's" });
  assert.throws(() => loadKit(dir, mine), /refused\.json is not as the kit reads it:[^]*names what is not a command's name/);
  refuse({ hub: "the forge's" });
  assert.deepEqual(loadKit(dir, mine).refused, { hub: "the forge's" });
});

test("a sensor or a question the watch could not ask by is refused as the kit loads, naming its file", () => {
  const dir = kitDir("sw2-kit-");
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ roles: [] }));
  mkdirSync(join(dir, "catalog", "sensor"), { recursive: true });
  const sensor = { id: "judge", label: "Judge", key: "Judge key", url: "https://judge.example/api", model: "judge-1", terms: "Asked as its vendor's terms say.", timeoutSeconds: 5, retries: 1 };
  const place = (name: string, value: object) => writeFileSync(join(dir, "catalog", "sensor", name), JSON.stringify(value));
  place("judge.json", { ...sensor, url: "http://judge.example/api" });
  assert.throws(() => loadKit(dir), /catalog\/sensor\/judge\.json is not as the kit reads it:[^]*is not an https address/);
  place("judge.json", { ...sensor, id: "other" });
  assert.throws(() => loadKit(dir), /catalog\/sensor\/judge\.json names itself other/);
  place("judge.json", sensor);
  assert.deepEqual(Object.keys(loadKit(dir).sensors), ["judge"]);

  const checks = join(dir, "catalog", "checks.json");
  const shipped = JSON.parse(readFileSync(checks, "utf-8"));
  const question = shipped.review_ran_invariant;
  writeFileSync(checks, JSON.stringify({ ...shipped, review_ran_invariant: { ...question, no: 0.9 } }));
  assert.throws(() => loadKit(dir), /checks\.json is not as the kit reads it:[^]*no must sit below yes/);
  writeFileSync(checks, JSON.stringify({ ...shipped, review_ran_invariant: { ...question, instructions: { invariant: null } } }));
  assert.throws(() => loadKit(dir), /checks\.json is not as the kit reads it:[^]*names no question/);
  writeFileSync(checks, JSON.stringify({ ...shipped, instruction_kind: { ...shipped.instruction_kind, criteria: { other: "Anything." } } }));
  assert.throws(() => loadKit(dir), /checks\.json is not as the kit reads it:[^]*a choice needs two criteria or more/);
  writeFileSync(checks, JSON.stringify({ ...shipped, asked_for: { ...shipped.asked_for, acts: { destructive: "run a command" } } }));
  assert.throws(() => loadKit(dir), /checks\.json is not as the kit reads it:[^]*\{quote\}/);
});

test("the shipped harnesses satisfy their own contract", () => {
  const root = new URL("../../harness", import.meta.url).pathname;
  for (const id of readdirSync(root)) assert.deepEqual(wrong(JSON.parse(readFileSync(join(root, id, "harness.json"), "utf-8"))), [], `harness ${id}`);
});

test("several seats can supervise one project, each for its own concern, declared as data", () => {
  const dir = kitDir("sw2-concerns-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ supervisor: [{ name: "open_lane" }, { name: "answer" }], lead: [{ name: "report" }] }));

  const role = (name: string, can: string[], tools: string, concern?: string) => {
    writeFileSync(join(dir, "harness", "acme", "settings", `${name}.settings.json`), "{}");
    return { role: name, label: name, can, tools, ...(concern ? { concern } : {}), defaults: { harness: "acme" }, prompt: `prompts/${name}.md`, skills: null };
  };
  writeFileSync(
    join(dir, "roles.json"),
    JSON.stringify({
      providerPrefix: "sw2-",
      roles: [
        role("architecture", ["supervise"], "supervisor", "architecture"),
        role("safety", ["supervise"], "supervisor", "safety"),
        role("lead", ["lead"], "lead"),
      ],
    }),
  );

  const kit = loadKit(dir);
  const supervising = rolesThatCan(kit, "supervise");
  assert.deepEqual(
    supervising.map((entry) => [entry.role, entry.concern]),
    [
      ["architecture", "architecture"],
      ["safety", "safety"],
    ],
    "a project is not limited to one supervising seat, and each carries what it specialises in",
  );
  assert.deepEqual(toolsOf(kit, supervising[0]), ["open_lane", "answer"]);
  assert.deepEqual(toolsOf(kit, supervising[1]), ["open_lane", "answer"]);
  assert.deepEqual(toolsOf(kit, roleThatCan(kit, "lead")), ["report"]);
  assert.equal(can(supervising[0], "lead"), false);
});

test("a roles file of one's own replaces the kit's preset, and may name its files anywhere", () => {
  const dir = kitDir("sw2-preset-kit-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings", "lead.settings.json"), "{}");
  writeFileSync(join(dir, "harness", "acme", "settings", "driver.settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ lead: [{ name: "report" }] }));
  const shipped = { role: "lead", label: "Lead", can: ["lead"], tools: "lead", defaults: { harness: "acme" }, prompt: "prompts/LEAD.md", skills: null };
  writeFileSync(join(dir, "roles.json"), JSON.stringify({ providerPrefix: "sw2-", roles: [shipped] }));
  assert.deepEqual(loadKit(dir).roles.map((role) => role.role), ["lead"], "with nothing of the owner's, the kit runs what it ships");

  const mine = tempDir("sw2-preset-mine-");
  const ownPrompt = join(mine, "DRIVER.md");
  writeFileSync(ownPrompt, "# Driver\n\nYou drive.\n");
  writeFileSync(
    join(mine, "roles.json"),
    JSON.stringify({ providerPrefix: "sw2-", roles: [{ role: "driver", label: "Driver", can: ["lead"], tools: "lead", defaults: { harness: "acme" }, prompt: ownPrompt, skills: null }] }),
  );

  const kit = loadKit(dir, mine);
  assert.deepEqual(kit.roles.map((role) => role.role), ["driver"], "and that arrangement is the one that runs");
  assert.match(renderPrompt(kit, kit.roles[0]!, "claude", { guides: "/g", state: "/s" }), /You drive\./, "its prompt is read from where it says, not from inside the package");
});

test("a capability several roles hold can name which of them, and a stored name is asked what it can do", () => {
  const dir = kitDir("sw2-several-");
  mkdirSync(join(dir, "harness", "acme", "settings"), { recursive: true });
  writeFileSync(join(dir, "harness", "acme", "harness.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "harness", "acme", "settings.json"), "{}");
  mkdirSync(join(dir, "mcp"), { recursive: true });
  writeFileSync(join(dir, "mcp", "tools.json"), JSON.stringify({ lead: [{ name: "report" }], reviewer: [{ name: "done" }] }));
  const role = (name: string, can: string[], tools: string) => {
    writeFileSync(join(dir, "harness", "acme", "settings", `${name}.settings.json`), "{}");
    return { role: name, label: name, can, tools, defaults: { harness: "acme" }, prompt: `prompts/${name}.md`, skills: null };
  };
  writeFileSync(
    join(dir, "roles.json"),
    JSON.stringify({
      providerPrefix: "sw2-",
      roles: [role("careful", ["review"], "reviewer"), role("adversary", ["review"], "reviewer"), role("lead", ["lead"], "lead"), role("arch-lead", ["lead"], "lead")],
    }),
  );
  const kit = loadKit(dir);

  // Two lenses are only evidence if they are not one reader twice, so the caller may say which.
  assert.equal(roleThatCan(kit, "review")?.role, "careful", "unnamed, the preset's first");
  assert.equal(roleThatCan(kit, "review", "adversary")?.role, "adversary", "named, the one asked for");
  assert.equal(roleThatCan(kit, "review", "lead"), undefined, "a role that cannot do it is not a stand-in for one that can");
  assert.equal(roleThatCan(kit, "review", "nobody"), undefined);

  // A name comparison once called only a role literally named "lead" a lead, escalating other leads' asks.
  assert.equal(can(roleNamed(kit, "arch-lead"), "lead"), true);
  assert.equal(can(roleNamed(kit, "careful"), "lead"), false, "and a reviewer still has someone above it");
  assert.equal(can(roleNamed(kit, "a role this kit lost"), "lead"), false, "a name the kit no longer has can do nothing, so its ask still escalates");
});
