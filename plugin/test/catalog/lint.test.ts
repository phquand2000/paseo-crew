import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { skillSources } from "../../server/catalog/content.ts";
import { loadKit } from "../../server/catalog/kit.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const kit = loadKit(PLUGIN);

// The budgets are the prompt research's (E §4.2, §7): words and rule lines per role prompt, words per skill body.
const PROMPT_BUDGET: Record<string, [number, number]> = { supervisor: [700, 25], lead: [750, 28], peer: [400, 12], reviewer: [300, 8], watcher: [300, 8], pager: [60, 0] };
const SKILL_BUDGET: Record<string, number> = {
  grilling: 600, "pre-mortem": 700, "architecture-premise-audit": 800, retrospective: 650, council: 900, "ultra-review": 800,
  "repo-refresh": 650, "planning-lanes": 700, "test-first": 800, "diagnosing-bugs": 650, "security-check": 600, "test-proof-debt-audit": 450,
};

const ACRONYMS = new Set(["API", "CLI", "JSON", "SQL", "URL", "HTTP"]);

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const ruleLines = (text: string) => text.split("\n").filter((line) => /^(- |\d+\. )/.test(line)).length;
const files = (dir: string, ending: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name), ending) : entry.name.endsWith(ending) ? [join(dir, entry.name)] : [])) : [];
const skills = readdirSync(join(PLUGIN, "content", "skills")).flatMap((set) => readdirSync(join(PLUGIN, "content", "skills", set)).map((name) => ({ name, dir: join(PLUGIN, "content", "skills", set, name) })));
const deltas = files(join(PLUGIN, "harness"), ".md").filter((file) => file.includes("/delta/"));
type Schema = { description?: string; properties?: Record<string, Schema>; items?: Schema };
type Hints = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
const tools = JSON.parse(readFileSync(join(PLUGIN, "mcp", "tools.json"), "utf-8")) as Record<string, { name: string; title?: string; description?: string; annotations?: Hints; inputSchema?: Schema }[]>;
/** Every parameter a schema names, with its description: the fields of a list's items too, which a seat reads as closely. */
const params = (schema: Schema | undefined, prefix = ""): [string, string][] =>
  Object.entries(schema?.properties ?? {}).flatMap(([name, field]) => [[`${prefix}${name}`, field.description ?? ""] as [string, string], ...params(field.items, `${prefix}${name}.`)]);
const deskTools = new Set(Object.values(tools).flatMap((set) => set.map((tool) => tool.name)));

test("every role prompt keeps within its budget of words and rule lines", () => {
  for (const role of kit.roles) {
    const budget = PROMPT_BUDGET[role.role];
    assert.ok(budget, `${role.role} has no budget here: give it one`);
    const text = readFileSync(join(PLUGIN, "content", role.prompt), "utf-8");
    assert.ok(words(text) <= budget[0] && ruleLines(text) <= budget[1], `${role.role}: ${words(text)} words and ${ruleLines(text)} rule lines, over ${budget[0]} and ${budget[1]}`);
  }
  for (const file of deltas) assert.ok(words(readFileSync(file, "utf-8")) <= 80, `${file} says more than 80 words against its agent's own instructions`);
});

test("every skill keeps within its budget, and its description says what it does, when to use it and what it is not for, in 450 characters", () => {
  for (const { name, dir } of skills) {
    const [, head = "", body = ""] = readFileSync(join(dir, "SKILL.md"), "utf-8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    const description = head.match(/^description:\s*"?(.*?)"?$/m)?.[1] ?? "";
    assert.ok(SKILL_BUDGET[name], `skill ${name} has no budget here: give it one`);
    assert.ok(words(body) <= SKILL_BUDGET[name], `skill ${name}: ${words(body)} words, over ${SKILL_BUDGET[name]}`);
    assert.ok(description.length <= 450 && /Use when/.test(description) && /not for/i.test(description), `skill ${name}'s description: ${description.length} characters, and it needs "Use when" and "not for"`);
  }
});

test("every tool says when to call it and what it does in 60 words, and each of its parameters in 25", () => {
  assert.deepEqual(params({ properties: { tasks: { items: { properties: { key: { description: "k" } } } } } }), [["tasks", ""], ["tasks.key", "k"]], "the fields of a list's items are counted too");
  for (const [set, list] of Object.entries(tools)) {
    for (const tool of list) {
      assert.ok(words(tool.description ?? "") <= 60, `${set} ${tool.name}: ${words(tool.description ?? "")} words`);
      for (const [param, description] of params(tool.inputSchema)) assert.ok(words(description) <= 25, `${set} ${tool.name}.${param}: ${words(description)} words`);
    }
  }
});

test("every tool has a title, says what it changes and describes each field within what harnesses take, and each set's server says what it is for", () => {
  const told = JSON.parse(readFileSync(join(PLUGIN, "mcp", "instructions.json"), "utf-8")) as Record<string, string>;
  for (const [set, list] of Object.entries(tools)) {
    assert.ok(told[set] && told[set].length <= 300, `${set}: its server says what it is for, in 300 characters`);
    for (const tool of list) {
      assert.match(tool.name, /^[a-z_]{1,64}$/);
      assert.ok(tool.title, `${set} ${tool.name} has no title`);
      const hints = tool.annotations ?? {};
      assert.deepEqual([typeof hints.readOnlyHint, typeof hints.openWorldHint], ["boolean", "boolean"], `${set} ${tool.name} says whether it writes and whether it reaches outside`);
      // Whether a call destroys or repeats safely means something only for a tool that writes.
      const writing = hints.readOnlyHint ? ["undefined", "undefined"] : ["boolean", "boolean"];
      assert.deepEqual([typeof hints.destructiveHint, typeof hints.idempotentHint], writing, `${set} ${tool.name}`);
      // Codex refuses a schema over 5,000 bytes and Claude cuts a description at 2,048 characters.
      assert.ok(JSON.stringify(tool.inputSchema).length < 5000 && (tool.description ?? "").length < 2048, `${set} ${tool.name} is too large for a harness`);
      for (const [param, description] of params(tool.inputSchema)) assert.ok(description, `${set} ${tool.name}.${param} says nothing of what it takes`);
    }
  }
});

test("seat text shouts nothing, never says mail waits for a running turn to end, and never makes one task a lane's norm", () => {
  const texts = [...files(join(PLUGIN, "content"), ".md"), ...deltas].map((file) => [file, readFileSync(file, "utf-8")] as const);
  texts.push(["mcp/tools.json", Object.values(tools).flat().map((tool) => tool.description ?? "").join("\n")]);
  for (const [file, text] of texts) {
    assert.deepEqual(text.match(/\b(IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS|DO NOT)\b/g), null, `${file} shouts`);
    // Mail steers into a running turn on the agents that take that: a text saying otherwise was believed.
    assert.deepEqual(text.match(/between (your|its|their) turns|never interrupt|if in doubt/gi), null, `${file}`);
    // A lane splits the way its work divides: a text calling one task usual put whole lanes into one, beside the Lead's rule.
    assert.deepEqual(text.match(/usually (just )?one task|one task (per|to a|for the whole) lane/gi), null, `${file} makes one task a lane's norm`);
  }
});

test("a skill or delta names only tools its roles can call, links only files that are there, and a prompt names only letters the desk sends", () => {
  for (const role of kit.roles) {
    const own = new Set((tools[role.tools ?? ""] ?? []).map((tool) => tool.name));
    const given = [...skillSources(kit, role).values()].map((dir) => [dir, readFileSync(join(dir, "SKILL.md"), "utf-8")] as const);
    const delta = deltas.filter((file) => file.endsWith(`/${role.role}.md`)).map((file) => [file, readFileSync(file, "utf-8")] as const);
    for (const [where, text] of [...given, ...delta]) {
      for (const [, name] of text.matchAll(/`([a-z][a-z_]{2,})`/g)) {
        if (deskTools.has(name!)) assert.ok(own.has(name!), `${where} tells the ${role.role} to call ${name}, which is not in its tool set`);
      }
    }
  }
  for (const { dir } of skills) {
    for (const file of files(dir, ".md")) {
      const text = readFileSync(file, "utf-8");
      for (const [, link] of text.matchAll(/\]\((references\/[^)#]+)\)/g)) assert.ok(existsSync(join(dir, link!)), `${file} links ${link}, which is not there`);
      for (const [, path] of text.matchAll(/\$SEATWORKS_KIT\/([\w./-]+[\w-])/g)) assert.ok(existsSync(join(PLUGIN, path!)), `${file} names $SEATWORKS_KIT/${path}, which is not there`);
    }
  }
  const letters = new Set<string>();
  for (const file of readdirSync(join(PLUGIN, "server", "desk")).filter((name) => /letters\.ts$|^briefs\.ts$|^directive\.ts$/.test(name))) {
    for (const match of readFileSync(join(PLUGIN, "server", "desk", file), "utf-8").matchAll(/[`"]([A-Z]{2,}(?: [A-Z]{2,})*)(?=[ :]|\$|`|")/g)) letters.add(match[1]!);
  }
  for (const role of kit.roles) {
    const text = readFileSync(join(PLUGIN, "content", role.prompt), "utf-8");
    for (const [, guide] of text.matchAll(/\{\{guides\}\}\/([\w.-]+)/g)) assert.ok(existsSync(join(PLUGIN, "content", "guides", guide!)), `${role.role} names the guide ${guide}, which is not there`);
    // A word in capitals that is not an acronym, a file's name or a variable is a letter's heading, and the desk must send it.
    for (const [, heading] of text.matchAll(/(?<![$\w])([A-Z]{3,}(?: [A-Z]{3,})*)(?![\w.])/g)) {
      if (!ACRONYMS.has(heading!)) assert.ok(letters.has(heading!), `${role.role}'s prompt names ${heading}, a letter the desk does not send`);
    }
  }
});
