import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/core/stream.ts";
import type { Rules } from "../../server/runtime/watch/facts.ts";
import { again, fixture, opening, piRow, play, rules } from "./seat-replay.ts";

/** What the watch raises of one shell command a seat ran: a deletion, or an act that cannot be undone. */
const raised = (command: string, given: Rules = rules()) =>
  play([...opening(), again(piRow(11), "c", 2, (detail) => Object.assign(detail, { command }))], given).filter(
    (fact) => fact.kind === "destructive" || fact.kind === "irreversible",
  );
const paged = (command: string, given: Rules = rules()) => raised(command, given).map((fact) => fact.quote);

test("a deletion is raised the moment it is known, quoted where it deletes, and scratch clean-up is not one", () => {
  const rewritten = fixture("claude").map(
    (message) =>
      JSON.parse(JSON.stringify(message).replaceAll("sleep 4; echo step-one", "rm -rf build")) as StreamMessage,
  );
  const facts = play(rewritten, rules()).filter((fact) => fact.kind === "destructive");
  assert.equal(facts.length, 1, "only once");
  assert.equal(facts[0]!.level, "attend", "a deletion stays on this machine: the Supervisor may hold it, no phone");
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
    "git reset --hard HEAD~1",
    "git branch -df feat",
    "git branch -d -f feat",
    "git branch --delete --force x",
  ])
    assert.deepEqual(
      raised(command).map((fact) => fact.level),
      ["attend"],
      `caught where a command starts, in any flag order: ${command}`,
    );
  for (const command of [
    "git -C repo push --force",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    "psql -c 'drop table users'",
    "rm -rf build && git push --force",
  ])
    assert.equal(
      raised(command).find((fact) => fact.kind === "irreversible")?.level,
      "page",
      `what leaves the machine and cannot be undone still pages: ${command}`,
    );
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

  // Twenty-one pages reached the Human for scratch work the watch misread; each row is one's shape.
  const granted = rules({ temp: "/var/folders/xy/T", outside: ["/srv/dev cache"] });
  for (const command of [
    'rm -rf "/srv/dev cache/lane/red-wt"',
    'D="/srv/dev cache/lane"; C=14010cd; rm -f "$D/smoke-$C" && docker run --rm -v "$D:/h" img',
    'rm -rf "$TMPDIR"/v17-p7-1 "${TMPDIR:-/tmp}/marked"',
    `export S="$TMPDIR/$lane-secrets"\nrm -rf "$S"`,
    `{ T="$TMPDIR/l3-merged"; git worktree add "$T" main; }\nrm -rf "$T"`,
    `M=$(mktemp -d -t probe); for i in 1 2; do rm -rf $M; done`,
    `T=$(mktemp -d); v() { rm -rf "$T"; }; v`,
    `cat > "$H/smoke.sh" <<'EOF'\nif true; then rm -f "$DATA"; fi\nEOF\nsh "$H/smoke.sh"`,
    `t=$(mktemp); cat > "$t" <<'PERL'\n  rm -rf "$SU/src"\n  f() << op.payload;\nPERL\nrm -rf "$t"`,
  ])
    assert.deepEqual(paged(command, granted), [], `scratch, as the command itself shows: ${command}`);
  for (const command of [
    `cat <<'EOF' | sh\nrm -rf src\nEOF`,
    `psql <<'SQL'\ndrop table users;\nSQL`,
    `echo "a << EOF"\nrm -rf src\nEOF`,
    `if [ -n "$X" ]; then T="$TMPDIR/a"; else T=src; fi; rm -rf "$T"`,
    "rm -rf /tmp/../etc",
    'rm -rf "/srv/dev cache"',
    'rm -rf "/srv/dev cache/../cache2"',
  ])
    assert.equal(
      paged(command, granted).length,
      1,
      `a body a program runs, or a target not surely scratch: ${command}`,
    );
});
