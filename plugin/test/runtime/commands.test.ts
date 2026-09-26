import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/core/stream.ts";
import type { Rules } from "../../server/runtime/watch/facts.ts";
import { again, fixture, opening, piRow, play, rules } from "./seat-replay.ts";

/** What the watch pages of one shell command a seat ran, as its quotes. */
const paged = (command: string, given: Rules = rules()) =>
  play([...opening(), again(piRow(11), "c", 2, (detail) => Object.assign(detail, { command }))], given)
    .filter((fact) => fact.kind === "destructive")
    .map((fact) => fact.quote);

test("an irreversible command is paged the moment it is known, quoted where it is irreversible, and scratch clean-up is not one", () => {
  const rewritten = fixture("claude").map(
    (message) =>
      JSON.parse(JSON.stringify(message).replaceAll("sleep 4; echo step-one", "rm -rf build")) as StreamMessage,
  );
  const facts = play(rewritten, rules()).filter((fact) => fact.kind === "destructive");
  assert.equal(facts.length, 1, "only once");
  assert.equal(facts[0]!.level, "page");
  assert.equal(
    facts[0]!.seq,
    3,
    "Claude's first row for the call has no command; the second has it, and the call is still running",
  );
  const settledAt = rewritten.find(
    (message) => message.event.item?.status === "completed" && JSON.stringify(message).includes("rm -rf build"),
  )!.seq!;
  assert.ok(facts[0]!.seq < settledAt, "before the call finishes");

  for (const command of [
    "rm -r -f build",
    "sudo rm -rf /",
    "cd x && rm -fr dist",
    "find . -exec rm -f {} ;",
    'bash -c "rm -rf tmp"',
    "git -C repo push --force",
    "git branch -df feat",
    "git branch -d -f feat",
    "git branch --delete --force x",
  ])
    assert.equal(paged(command).length, 1, `caught where a command starts, in any flag order: ${command}`);
  for (const command of [
    "echo 'rm -rf /'",
    "grep -rn 'git reset --hard' docs",
    "terraform -chdir=x plan",
    "git branch -d feat",
    "git branch -f feat HEAD",
    "rm -i a",
  ])
    assert.deepEqual(paged(command), [], `not in quoted text, nor a command that can be undone: ${command}`);

  // A page once quoted the first 200 characters, cut right where the `rm -rf` target began.
  const long = `cat ${"/long/path/segment".repeat(12)}/wrap.js ${"/long/path/segment".repeat(6)}/wrap.js | xargs rm -rf /Users/me/stray-copy`;
  const [quote] = paged(long);
  assert.match(quote ?? "", /rm -rf \/Users\/me\/stray-copy$/);
  assert.equal(quote!.length <= 201, true, quote);

  // A Lead writing a commit message to $TMPDIR and removing it afterwards was paged as destructive.
  const temp = rules({ temp: "/var/folders/xy/T" });
  assert.deepEqual(
    paged(`cat > "$TMPDIR/msg" <<'EOF'\nfix: merge\nEOF\ngit commit -F "$TMPDIR/msg" && rm -f "$TMPDIR/msg"`, temp),
    [],
  );
  assert.deepEqual(paged("rm -rf /tmp/sw2-probe ${TMPDIR}/x /var/folders/xy/T/y", temp), []);
  assert.match(
    paged(`rm -f "$TMPDIR/msg" && rm -rf src`, temp).join(),
    /rm -rf src/,
    "anything else in the line still is",
  );
  assert.equal(paged("rm -rf /tmp/a src", temp).length, 1, "one real target among scratch ones is enough");

  // Three pages were a scratch directory from mktemp, removed at the end of the same command.
  assert.deepEqual(paged(`demo=$(mktemp -d) && cd "$demo" && git init -q && npm test; rm -rf "$demo"`), []);
  assert.deepEqual(paged("work=`mktemp -d`; rm -rf ${work}/build"), []);
  assert.deepEqual(paged("mkdir -p out/tmp && node build.js out/tmp && rm -rf out/tmp"), []);
  assert.equal(
    paged(`demo=$(mktemp -d) && rm -rf "$HOME/demo"`).length,
    1,
    "a variable nothing here set from mktemp is not scratch",
  );
  assert.equal(paged("mkdir -p out/tmp && rm -rf out").length, 1, "removing more than it made is not");
});
