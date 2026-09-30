import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STATE_VERSION } from "../../server/core/state-version.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHAPES = join(PLUGIN, "test", "fixtures", "state", "shapes.json");

const KEPT: [string, string[]][] = [
  ["server/domain/amendment.ts", ["Amendment"]],
  ["server/domain/ask.ts", ["AskStatus", "AskKind", "Ask"]],
  ["server/domain/lane.ts", ["LaneStatus", "Restoring", "HumanLine", "Lane"]],
  ["server/domain/task.ts", ["TaskStatus", "Handback", "Task"]],
  ["server/domain/question.ts", ["QuestionStatus", "QuestionClass", "Question"]],
  ["server/domain/ledger.ts", ["Releasing", "Slot", "AgentRef", "Ledger"]],
  ["server/domain/incident.ts", ["Held", "Level", "Finding", "Delivered"]],
  ["server/desk/store/incidents.ts", ["Incident", "Incidents"]],
  ["server/desk/project/project.ts", ["GateOn", "LANE_HOMES", "ProjectConfig", "SshHost"]],
  ["server/core/git.ts", ["LandAs"]],
  ["server/catalog/kit/schema/ecosystem.ts", ["RiskRule"]],
  ["server/runtime/mail/outbox.ts", ["Letter"]],
  ["server/upkeep/content.ts", ["Taken"]],
  ["server/runtime/seat/keys.ts", ["Bound"]],
  ["server/desk/store/intents.ts", ["Promised", "Kept"]],
  [
    "shared/settings.ts",
    [
      "Scalar",
      "RoleChoice",
      "Connect",
      "McpChoice",
      "Pattern",
      "AttentionChoice",
      "SensorChoice",
      "FlowChoice",
      "LayerSchema",
    ],
  ],
];

const bare = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** One `type` or `const` declaration, up to the semicolon that ends it at the top level. */
function declaration(source: string, file: string, name: string): string {
  const start = new RegExp(`^(?:export )?(?:type|const) ${name}\\b`, "m").exec(source)?.index;
  assert.ok(
    start !== undefined,
    `${file} no longer declares ${name}; update the list in this test along with STATE_VERSION`,
  );
  let depth = 0;
  for (let at = start; at < source.length; at++) {
    const char = source[at]!;
    if ("{([".includes(char)) depth++;
    else if ("})]".includes(char)) depth--;
    else if (char === ";" && depth === 0) return bare(source.slice(start, at + 1));
  }
  throw new Error(`${name} in ${file} does not end`);
}

function shape(): string {
  const hash = createHash("sha256");
  for (const [file, names] of KEPT) {
    const source = readFileSync(join(PLUGIN, file), "utf-8");
    for (const name of names) hash.update(`${file}#${declaration(source, file, name)}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

test("the shape of every kept file is the one recorded for this STATE_VERSION", () => {
  const recorded = JSON.parse(readFileSync(SHAPES, "utf-8")) as Record<string, string>;
  const now = shape();
  assert.ok(
    Object.keys(recorded).every((version) => Number(version) <= STATE_VERSION),
    "shapes.json records a state newer than STATE_VERSION",
  );
  assert.equal(
    recorded[String(STATE_VERSION)],
    now,
    [
      `The shape of a kept file changed (now ${now}), and STATE_VERSION is still ${STATE_VERSION}.`,
      `Raise STATE_VERSION in server/core/state-version.ts to ${STATE_VERSION + 1}, add its step in server/upkeep/state-upgrade.ts,`,
      `add test/fixtures/state/v${STATE_VERSION + 1} in the new format, and record "${STATE_VERSION + 1}": "${now}" in test/fixtures/state/shapes.json.`,
      "The shape recorded for an earlier state is never changed.",
    ].join("\n"),
  );
});
