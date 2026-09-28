import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/core/stream.ts";
import { again, editCall, fixture, kinds, opening, piRow, play, rules, watchOver } from "./seat-replay.ts";

/** An edit of `filePath` at `seq`, its detail set as each row needs. */
const edit = (callId: string, seq: number, detail: Record<string, unknown>) =>
  again(editCall(), callId, seq, (given) => Object.assign(given, detail));

/** An edit as Codex records one, a unified diff and nothing else. */
const patch = (unifiedDiff: string) =>
  again(editCall(), "p", 2, (detail) => {
    for (const key of Object.keys(detail)) if (key !== "type") delete detail[key];
    Object.assign(detail, { type: "edit", filePath: "test/a.test.ts", unifiedDiff });
  });

/** A whole-file call on test/a.test.ts, as Claude records a Read or a Write. */
const file = (name: string, seq: number, detail: Record<string, unknown>) =>
  ({
    event: {
      type: "timeline",
      item: {
        type: "tool_call",
        callId: `${name}${seq}`,
        name,
        status: "completed",
        detail: { filePath: "/work/test/a.test.ts", ...detail },
      },
      turnId: "t",
    },
    seq,
    epoch: fixture("pi")[1]!.epoch,
  }) as StreamMessage;

const shell = (callId: string, seq: number, command: string, exitCode?: number) =>
  again(piRow(11), callId, seq, (detail) =>
    Object.assign(detail, { command, ...(exitCode === undefined ? {} : { exitCode }) }),
  );

const turn = (...messages: StreamMessage[]): StreamMessage[] => [
  { event: { type: "turn_started", turnId: "t" } },
  fixture("pi")[1]!,
  ...messages,
  { event: { type: "turn_completed", turnId: "t" } },
];

test("an edit is read for weakened tests, silenced checks and writes outside the seat's scope", () => {
  const weakened = edit("e1", 2, {
    filePath: "test/strings.test.ts",
    oldString: "assert.equal(a, 1);\nassert.equal(b, 2);",
    newString: "assert.equal(a, 1);",
  });
  const silenced = edit("e2", 3, {
    filePath: "src/a.ts",
    oldString: "const x = f();",
    newString: "// @ts-ignore\nconst x = f();",
  });
  assert.deepEqual(
    play([...opening(), weakened, silenced], rules())
      .filter((fact) => fact.level === "attend")
      .map((fact) => [fact.kind, fact.quote]),
    [
      ["test-weakened", "test/strings.test.ts: 2 assertions become 1"],
      ["suppressed", "src/a.ts: adds @ts-ignore"],
    ],
  );
  const renamed = edit("e", 2, {
    filePath: "test/a.test.ts",
    oldString: 'it("should add", () => { assert.equal(add(1, 1), 2); });',
    newString: 'it("adds", () => { assert.equal(add(1, 1), 2); });',
  });
  assert.deepEqual(kinds(play([...opening(), renamed], rules())), [], "a test's title saying should is no assertion");

  const header = "--- a/test/a.test.ts\n+++ b/test/a.test.ts\n";
  const unified = `${header}@@ -1,3 +1,2 @@\n assert.equal(a, 1);\n-assert.equal(b, 2);\n+// later\n`;
  assert.deepEqual(kinds(play([...opening(), patch(unified)], rules())), ["test-weakened"]);
  const cut = `${header}@@ -1,2 +1,2 @@\n assert.equal(a, 1);\n-assert.equal(b, 2);\n...[truncated 900 chars]`;
  assert.deepEqual(
    kinds(play([...opening(), patch(cut)], rules())),
    [],
    "a Codex diff cut short is not read as assertions removed",
  );

  const read = file("Read", 2, {
    type: "read",
    content: "assert.equal(a, 1);\nassert.equal(b, 2);\n// eslint-disable-next-line\n",
  });
  const rewrite = file("Write", 3, { type: "write", content: "assert.equal(a, 1);\n// eslint-disable-next-line\n" });
  assert.deepEqual(
    kinds(play([...opening(), read, rewrite], rules())),
    ["test-weakened"],
    "a whole-file rewrite is read against what the seat last read, and the eslint-disable it had is not new",
  );
  assert.deepEqual(kinds(play([...opening(), rewrite], rules())), [], "a write with no before weakens nothing");

  const prose = edit("d", 2, { filePath: "README.md", oldString: "", newString: "Add // @ts-ignore above it." });
  const second = edit("e", 3, {
    filePath: "src/b.ts",
    oldString: "// eslint-disable-next-line\nf();",
    newString: "// eslint-disable-next-line\nf();\n// Pass it as any other value.\n// @ts-ignore\ng();",
  });
  assert.deepEqual(
    play([...opening(), prose, second], rules()).map((fact) => [fact.kind, fact.quote]),
    [["suppressed", "src/b.ts: adds @ts-ignore"]],
    "a suppression in prose is not one, and the one quoted is the one added",
  );

  const scoped = rules({ cwd: "/var/folders/xy/T/work", temp: "/var/folders/xy/T", scope: ["src/pricing"] });
  const writes = [
    edit("m", 2, { filePath: "/var/folders/xy/T/msg" }),
    edit("k", 3, { filePath: "/Users/me/.ssh/config" }),
    edit("o", 4, { filePath: "/var/folders/xy/T/work/src/pricing/rates.ts" }),
    edit("s", 5, { filePath: "/var/folders/xy/T/work/lib/x.ts" }),
  ];
  assert.deepEqual(
    play([...opening(), ...writes], scoped).map((fact) => [fact.kind, fact.quote]),
    [
      ["outside-scope", "/Users/me/.ssh/config"],
      ["outside-scope", "/var/folders/xy/T/work/lib/x.ts"],
    ],
    "temp scratch and a directory of its scope are in; elsewhere, and a copy lying in temp outside its scope, are out",
  );

  // A Peer's first turn starts before start_task places it, so an empty first read must not be kept.
  let placed = false;
  const told = watchOver(() => ({
    rules: rules({ cwd: "/work", scope: placed ? ["src/a.ts"] : undefined }),
    handedBack: () => undefined,
    placed,
  }));
  assert.deepEqual(kinds(told([...opening(), edit("b1", 2, { filePath: "/work/src/b.ts" })])), []);
  placed = true;
  assert.deepEqual(
    told([edit("b2", 3, { filePath: "/work/src/b.ts" })]).map((fact) => [fact.kind, fact.quote]),
    [["outside-scope", "/work/src/b.ts"]],
    "what a seat is watched against is read again until the ledger has placed it",
  );
});

test("a hand-back is read against what the turn ran after its last edit", () => {
  const wrote = edit("w", 2, { filePath: "src/a.ts" });
  const gated = rules({ gates: ["npm test"] });
  const claimed = (messages: StreamMessage[], handed?: string) =>
    play(turn(...messages), gated, handed)
      .filter((fact) => fact.kind === "claim-contradicted")
      .map((fact) => [fact.level, fact.quote]);
  const red = shell("g", 3, "npm test", 1);
  assert.deepEqual(claimed([wrote, red], "complete"), [
    ["attend", "handed back as complete, but `npm test` failed the last time it ran, after the last edit"],
  ]);
  assert.deepEqual(claimed([wrote, red], "partial"), [], "a partial hand-back does not say it works");
  assert.deepEqual(claimed([wrote, red]), [], "and a turn that handed nothing back said nothing");
  assert.deepEqual(claimed([wrote, red, shell("g2", 4, "npm test", 0)], "complete"), [], "it passed in the end");
  assert.deepEqual(
    claimed([wrote, red, edit("w2", 4, { filePath: "src/b.ts" })], "complete"),
    [],
    "an edit after it leaves the claim unchecked, not contradicted",
  );

  assert.deepEqual(
    kinds(play(turn(wrote), gated, "complete")).filter((kind) => kind !== "edit-before-look"),
    [],
    "the gate is the desk's to run, per task or per lane as the Human set it: a Peer that did not run it is not held to it",
  );

  const inCopy = rules({ gates: ["npm test"], cwd: "/work" });
  const contradictedIn = (after: StreamMessage) =>
    play(
      turn(edit("w", 2, { filePath: "/work/src/a.ts" }), shell("g", 3, "npm test", 1), after),
      inCopy,
      "complete",
    ).filter((fact) => fact.kind === "claim-contradicted").length;
  assert.equal(
    contradictedIn(edit("m", 4, { filePath: "/var/folders/xy/T/msg" })),
    1,
    "a commit message written to the temp directory is not a write the gate has to see",
  );
  assert.equal(contradictedIn(edit("d", 4, { filePath: "/work/docs/cart.md" })), 1, "nor is prose");

  const secret = "GITHUB_TOKEN=ghp_0123456789abcdefghijklmn npm test";
  const masked = play(turn(wrote, shell("g", 3, secret, 1)), rules({ gates: [secret] }), "complete").find(
    (fact) => fact.kind === "claim-contradicted",
  );
  assert.doesNotMatch(masked!.quote, /ghp_0123/, "the gate named in the fact is masked like any other quote");
});
