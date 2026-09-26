import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadKit } from "../../server/catalog/kit.ts";
import { ASK } from "../../server/domain/ask.ts";
import { LANE } from "../../server/domain/lane.ts";
import { QUESTION } from "../../server/domain/question.ts";
import type { Lifecycle } from "../../server/domain/lifecycle.ts";
import { TASK } from "../../server/domain/task.ts";
import { FACTS } from "../../server/runtime/watch/facts.ts";

const PLUGIN = join(import.meta.dirname, "..", "..");
const REFERENCE = join(PLUGIN, "..", "docs", "REFERENCE.md");
const kit = loadKit(PLUGIN);

const code = (names: string[]) => names.map((name) => `\`${name}\``).join(" ");

/** A lifecycle's statuses in the order its table first reaches them. */
const statuses = (life: Lifecycle<string, string>) => [...new Set(Object.values(life.moves).flatMap((step) => [...step.from, step.to]))].map((status) => `\`${status}\``).join(", ");

/** The reference's tables that the code already holds, each as the code has it now. */
const DRAWN: Record<string, () => string[]> = {
  verbs: () => {
    const rows = new Map<string, { labels: string[]; tools: string[] }>();
    for (const role of kit.roles.filter((entry) => entry.tools)) {
      const tools = Object.keys(kit.toolSets[role.tools!] ?? {});
      const row = rows.get(tools.join(" ")) ?? { labels: [], tools };
      row.labels.push(role.label);
      rows.set(tools.join(" "), row);
    }
    return ["| Role | Tools |", "|---|---|", ...[...rows.values()].map((row) => `| ${row.labels.join(", ")} | ${code(row.tools)} |`)];
  },
  records: () => [
    "| Record | States | Ids |",
    "|---|---|---|",
    `| Lane | ${statuses(LANE)} | \`L<n>\` |`,
    `| Task | ${statuses(TASK)} | \`<lane>-T<n>\` for code, \`<lane>-R<n>\` for review, from one counter per lane |`,
    `| Ask | ${statuses(ASK)} | \`A<n>\` |`,
    `| Question for the Human | ${statuses(QUESTION)} | \`H<n>\` |`,
    "| Incident | open until marked | `I<n>` |",
    "| Slot | a git worktree held by a lane or task | `S<n>`, never reused once released |",
  ],
  attention: () => [
    "| Attention value | Default |",
    "|---|---|",
    ...Object.entries(kit.attention).map(([name, value]) => `| \`${name}\` | ${name in kit.ecosystem.watch ? "a pattern in `catalog/ecosystem.json`" : typeof value === "string" ? `\`${value}\`` : String(value)} |`),
  ],
};

const HOW = "run UPDATE_REFERENCE=1 node --test --import ./test/setup.ts test/docs/reference.test.ts";

const between = (name: string) => [`<!-- drawn from the code: ${name} -->`, "<!-- end -->"] as const;

test("each table the reference draws from the code is the code as it stands", () => {
  let text = readFileSync(REFERENCE, "utf-8");
  for (const [name, draw] of Object.entries(DRAWN)) {
    const [open, close] = between(name);
    const start = text.indexOf(open);
    const end = text.indexOf(close, start);
    assert.ok(start >= 0 && end > start, `docs/REFERENCE.md has no ${open} … ${close} section`);
    const drawn = `${open}\n${draw().join("\n")}\n`;
    if (process.env.UPDATE_REFERENCE) text = text.slice(0, start) + drawn + text.slice(end);
    else assert.equal(text.slice(start, end), drawn, `the ${name} table in docs/REFERENCE.md is not the code's: ${HOW}`);
  }
  if (process.env.UPDATE_REFERENCE) writeFileSync(REFERENCE, text);
});

/** The cells of each row of the reference's table whose header row is `header`. */
function rows(header: string): string[][] {
  const text = readFileSync(REFERENCE, "utf-8");
  assert.ok(text.includes(header), `docs/REFERENCE.md has no table headed ${header}`);
  const lines = text.slice(text.indexOf(header)).split("\n").slice(2);
  return lines.slice(0, lines.findIndex((line) => !line.startsWith("|"))).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

test("every verb a seat can be shown has one row saying what it does, and no row names a verb that is not", () => {
  const shown = [...new Set(Object.values(kit.toolSets).flatMap((set) => Object.keys(set)))].sort();
  assert.deepEqual(rows("| Verb | Effect |").map(([verb]) => verb!.replaceAll("`", "")).sort(), shown);
});

test("every heading a letter or brief starts with is in the letters table, and the table names none that is not", () => {
  const heading = /^[A-Z]{2,}(?: [A-Z]{2,})*/;
  const written = new Set<string>();
  const desk = join(PLUGIN, "server", "desk");
  for (const file of [...readdirSync(desk).filter((name) => name.endsWith("letters.ts")), "briefs.ts", "directive.ts"]) {
    for (const match of readFileSync(join(desk, file), "utf-8").matchAll(/[`"]([A-Z]{2,}(?: [A-Z]{2,})*)(?=[ :]|\$|`|")/g)) written.add(match[1]!);
  }
  const listed = rows("| Kind | Letters |").flatMap(([, letters]) => letters!.split(",").flatMap((entry) => entry.trim().match(heading) ?? []));
  assert.deepEqual([...new Set(listed)].sort(), [...written].sort());
});

test("every fact the watch raises has a row saying when, and no row names one it does not", () => {
  const named = [...rows("| Fact | Level | Fires when |"), ...rows("| Fact | Fires when |")].flatMap(([facts]) => [...facts!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
  assert.deepEqual(named.sort(), Object.keys(FACTS).sort());
});

test("every kind the watch writes to events.log is in its table, and the table names none it does not", () => {
  const declared = [...readFileSync(join(PLUGIN, "server", "desk", "events.ts"), "utf-8").matchAll(/kind: "((?:watch|watcher|incident|page)\.[A-Za-z-]+)"/g)].map((match) => match[1]!);
  const listed = rows("| Group | Kinds |").flatMap(([, kinds]) => [...kinds!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!));
  assert.deepEqual(listed.sort(), declared.sort());
});
