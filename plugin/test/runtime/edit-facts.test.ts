import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/core/stream.ts";
import { FACTS, factTitle } from "../../server/runtime/watch/facts.ts";
import { again, editCall, fixture, kinds, opening, piRow, play, rules } from "./seat-replay.ts";

test("an edit that takes assertions out of a test, or silences a check, is noticed when it lands", () => {
  const edit = editCall();
  const weakened = again(edit, "e1", 2, (detail) =>
    Object.assign(detail, {
      filePath: "test/strings.test.ts",
      oldString: "assert.equal(a, 1);\nassert.equal(b, 2);",
      newString: "assert.equal(a, 1);",
    }),
  );
  const silenced = again(edit, "e2", 3, (detail) =>
    Object.assign(detail, {
      filePath: "src/a.ts",
      oldString: "const x = f();",
      newString: "// @ts-ignore\nconst x = f();",
    }),
  );
  const facts = play([...opening(), weakened, silenced], rules());
  assert.deepEqual(
    facts.filter((fact) => fact.level === "attend").map((fact) => [fact.kind, fact.quote]),
    [
      ["test-weakened", "test/strings.test.ts: 2 assertions become 1"],
      ["suppressed", "src/a.ts: adds @ts-ignore"],
    ],
  );
});

test("a hand-back that says complete while the last check it ran after its last edit failed is contradicted, and nothing else is", () => {
  const edit = editCall();
  const wrote = again(edit, "w", 2, (detail) => Object.assign(detail, { filePath: "src/a.ts" }));
  const red = again(piRow(11), "g", 3, (detail) => Object.assign(detail, { command: "npm test", exitCode: 1 }));
  const green = again(piRow(11), "g2", 4, (detail) => Object.assign(detail, { command: "npm test", exitCode: 0 }));
  const later = again(edit, "w2", 4, (detail) => Object.assign(detail, { filePath: "src/b.ts" }));
  const start: StreamMessage = { event: { type: "turn_started", turnId: "t" } };
  const end: StreamMessage = { event: { type: "turn_completed", turnId: "t" } };
  const given = rules({ gates: ["npm test"] });
  const claimed = (messages: StreamMessage[], handed?: string) =>
    play([start, fixture("pi")[1]!, ...messages, end], given, handed).filter(
      (fact) => fact.kind === "claim-contradicted",
    );
  assert.deepEqual(
    claimed([wrote, red], "complete").map((fact) => [fact.level, fact.quote]),
    [["attend", "handed back as complete, but `npm test` failed the last time it ran, after the last edit"]],
  );
  assert.deepEqual(claimed([wrote, red], "partial"), [], "a partial hand-back does not say it works");
  assert.deepEqual(claimed([wrote, red]), [], "and a turn that handed nothing back said nothing");
  assert.deepEqual(claimed([wrote, red, green], "complete"), [], "it passed in the end");
  assert.deepEqual(
    claimed([wrote, red, later], "complete"),
    [],
    "an edit after it leaves the claim unchecked, not contradicted",
  );
  assert.equal(FACTS["claim-contradicted"].level, "attend");
  assert.equal(factTitle("claim-contradicted"), "Handed back as complete while its last check failed");
});

test("a turn that reports having written files the gate never saw afterwards is unverified, and one that ran it is not", () => {
  const edit = editCall();
  const wrote = again(edit, "w", 2, (detail) => Object.assign(detail, { filePath: "src/a.ts" }));
  const gate = again(piRow(11), "g", 3, (detail) => Object.assign(detail, { command: "npm test" }));
  const start: StreamMessage = { event: { type: "turn_started", turnId: "t" } };
  const end: StreamMessage = { event: { type: "turn_completed", turnId: "t" } };
  const skipped = play([start, fixture("pi")[1]!, wrote, end], rules({ gates: ["npm test"] }), "complete");
  assert.deepEqual(
    kinds(skipped).filter((kind) => kind === "unverified"),
    ["unverified"],
  );
  assert.deepEqual(
    kinds(play([start, fixture("pi")[1]!, wrote, gate, end], rules({ gates: ["npm test"] }), "complete")).filter(
      (kind) => kind === "unverified",
    ),
    [],
  );
  assert.deepEqual(
    kinds(play([start, fixture("pi")[1]!, wrote, end], rules({ gates: ["npm test"] }))).filter(
      (kind) => kind === "unverified",
    ),
    [],
    "a turn that reported nothing claimed nothing",
  );
  // The runner the gate's script starts is the gate too, on one module's tests as on all of them.
  const own = again(piRow(11), "g", 3, (detail) =>
    Object.assign(detail, { command: 'node --test "test/text/slug.test.js"' }),
  );
  assert.deepEqual(
    kinds(
      play([start, fixture("pi")[1]!, wrote, own, end], rules({ gates: ["npm test", "node --test"] }), "complete"),
    ).filter((kind) => kind === "unverified"),
    [],
  );
});

test("a test's title saying should is not an assertion", () => {
  const edit = editCall();
  const renamed = again(edit, "e", 2, (detail) =>
    Object.assign(detail, {
      filePath: "test/a.test.ts",
      oldString: 'it("should add", () => { assert.equal(add(1, 1), 2); });',
      newString: 'it("adds", () => { assert.equal(add(1, 1), 2); });',
    }),
  );
  assert.deepEqual(kinds(play([...opening(), renamed], rules())), []);
});

test("an edit that arrives as a unified diff is read for weakened tests too", () => {
  const edit = fixture("codex").find(
    (message) => message.event.item?.name === "apply_patch" && message.event.item?.status === "completed",
  )!;
  const patched = again(edit, "p", 2, (detail) => {
    for (const key of Object.keys(detail)) if (key !== "type") delete detail[key];
    Object.assign(detail, {
      type: "edit",
      filePath: "test/a.test.ts",
      unifiedDiff:
        "--- a/test/a.test.ts\n+++ b/test/a.test.ts\n@@ -1,3 +1,2 @@\n assert.equal(a, 1);\n-assert.equal(b, 2);\n+// later\n",
    });
  });
  assert.deepEqual(kinds(play([...opening(), patched], rules())), ["test-weakened"]);
});

test("a commit message written to the temp directory, or a doc, is not a write the gate has to see", () => {
  const edit = editCall();
  const wrote = again(edit, "w", 2, (detail) => Object.assign(detail, { filePath: "/work/src/a.ts" }));
  const gate = again(piRow(11), "g", 3, (detail) => Object.assign(detail, { command: "npm test" }));
  const message = again(edit, "m", 4, (detail) => Object.assign(detail, { filePath: "/var/folders/xy/T/msg" }));
  const start: StreamMessage = { event: { type: "turn_started", turnId: "t" } };
  const end: StreamMessage = { event: { type: "turn_completed", turnId: "t" } };
  assert.deepEqual(
    kinds(
      play(
        [start, fixture("pi")[1]!, wrote, gate, message, end],
        rules({ gates: ["npm test"], cwd: "/work" }),
        "complete",
      ),
    ).filter((kind) => kind === "unverified"),
    [],
  );
  // A hand-back that only wrote docs after the gate was told it had not run the tests.
  const doc = again(edit, "d", 4, (detail) => Object.assign(detail, { filePath: "/work/docs/cart.md" }));
  assert.deepEqual(
    kinds(
      play([start, fixture("pi")[1]!, wrote, gate, doc, end], rules({ gates: ["npm test"], cwd: "/work" }), "complete"),
    ).filter((kind) => kind === "unverified"),
    [],
  );
});

test("a whole-file rewrite of a test is read against what the seat last read of it, and one with nothing to compare says nothing", () => {
  const read = {
    event: {
      type: "timeline",
      item: {
        type: "tool_call",
        callId: "r",
        name: "Read",
        status: "completed",
        detail: {
          type: "read",
          filePath: "/work/test/a.test.ts",
          content: "assert.equal(a, 1);\nassert.equal(b, 2);\n// eslint-disable-next-line\n",
        },
      },
      turnId: "t",
    },
    seq: 2,
    epoch: fixture("pi")[1]!.epoch,
  } as StreamMessage;
  const write = (seq: number, content: string) =>
    ({
      event: {
        type: "timeline",
        item: {
          type: "tool_call",
          callId: `w${seq}`,
          name: "Write",
          status: "completed",
          detail: { type: "write", filePath: "/work/test/a.test.ts", content },
        },
        turnId: "t",
      },
      seq,
      epoch: fixture("pi")[1]!.epoch,
    }) as StreamMessage;
  const weakened = play([...opening(), read, write(3, "assert.equal(a, 1);\n// eslint-disable-next-line\n")], rules());
  assert.deepEqual(kinds(weakened), ["test-weakened"], "the existing eslint-disable is not a new one");
  assert.deepEqual(
    kinds(play([...opening(), write(3, "assert.equal(a, 1);\n// eslint-disable-next-line\n")], rules())),
    [],
    "a write with no before cannot be said to weaken anything",
  );
});

test("a Codex diff cut short is not read as assertions removed", () => {
  const edit = fixture("codex").find(
    (message) => message.event.item?.name === "apply_patch" && message.event.item?.status === "completed",
  )!;
  const cut = again(edit, "p", 2, (detail) => {
    for (const key of Object.keys(detail)) if (key !== "type") delete detail[key];
    Object.assign(detail, {
      type: "edit",
      filePath: "test/a.test.ts",
      unifiedDiff:
        "--- a/test/a.test.ts\n+++ b/test/a.test.ts\n@@ -1,2 +1,2 @@\n assert.equal(a, 1);\n-assert.equal(b, 2);\n...[truncated 900 chars]",
    });
  });
  assert.deepEqual(kinds(play([...opening(), cut], rules())), []);
});

test("a suppression in prose is not one, and the one quoted is the one added", () => {
  const edit = editCall();
  const prose = again(edit, "d", 2, (detail) =>
    Object.assign(detail, { filePath: "README.md", oldString: "", newString: "Pass it as\nany other value." }),
  );
  const second = again(edit, "e", 3, (detail) =>
    Object.assign(detail, {
      filePath: "src/b.ts",
      oldString: "// eslint-disable-next-line\nf();",
      newString: "// eslint-disable-next-line\nf();\n// @ts-ignore\ng();",
    }),
  );
  const facts = play([...opening(), prose, second], rules());
  assert.deepEqual(
    facts.map((fact) => [fact.kind, fact.quote]),
    [["suppressed", "src/b.ts: adds @ts-ignore"]],
  );
});

test("a write to the temp directory or into a directory of its scope is in scope, one elsewhere outside the copy is not, and a copy in the temp directory is still read by its scope", () => {
  const edit = editCall();
  const temp = again(edit, "m", 2, (detail) => Object.assign(detail, { filePath: "/var/folders/xy/T/msg" })),
    inside = again(edit, "o", 4, (detail) =>
      Object.assign(detail, { filePath: "/var/folders/xy/T/work/src/pricing/rates.ts" }),
    );
  const ssh = again(edit, "k", 3, (detail) => Object.assign(detail, { filePath: "/Users/me/.ssh/config" })),
    stray = again(edit, "s", 5, (detail) => Object.assign(detail, { filePath: "/var/folders/xy/T/work/lib/x.ts" }));
  assert.deepEqual(
    play(
      [...opening(), temp, ssh, inside, stray],
      rules({ cwd: "/var/folders/xy/T/work", temp: "/var/folders/xy/T", scope: ["src/pricing"] }),
    ).map((fact) => [fact.kind, fact.quote]),
    [
      ["outside-scope", "/Users/me/.ssh/config"],
      ["outside-scope", "/var/folders/xy/T/work/lib/x.ts"],
    ],
  );
});

test("the gate named in an unverified fact is masked like any other quote", () => {
  const edit = editCall();
  const wrote = again(edit, "w", 2, (detail) => Object.assign(detail, { filePath: "src/a.ts" }));
  const gate = "GITHUB_TOKEN=ghp_0123456789abcdefghijklmn npm test";
  const facts = play(
    [
      { event: { type: "turn_started", turnId: "t" } },
      fixture("pi")[1]!,
      wrote,
      { event: { type: "turn_completed", turnId: "t" } },
    ],
    rules({ gates: [gate] }),
    "complete",
  );
  assert.doesNotMatch(facts.find((fact) => fact.kind === "unverified")!.quote, /ghp_0123/);
});
