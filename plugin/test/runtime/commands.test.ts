import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMessage } from "../../server/core/stream.ts";
import { again, fixture, opening, piRow, play, rules } from "./seat-replay.ts";

/** What the watch pages of one shell command a seat ran: an act that cannot be undone. */
const paged = (command: string) =>
  play([...opening(), again(piRow(11), "c", 2, (detail) => Object.assign(detail, { command }))], rules())
    .filter((fact) => fact.kind === "irreversible")
    .map((fact) => fact.quote);

test("an act that cannot be undone pages the moment it is known, quoted where it acts, and a script only stored is not one", () => {
  const rewritten = fixture("claude").map(
    (message) =>
      JSON.parse(JSON.stringify(message).replaceAll("sleep 4; echo step-one", "git push --force")) as StreamMessage,
  );
  const facts = play(rewritten, rules()).filter((fact) => fact.kind === "irreversible");
  assert.equal(facts.length, 1, "only once");
  assert.equal(
    facts[0]!.seq,
    3,
    "Claude's first row for the call has no command; the second has it, and the call is still running",
  );
  const settledAt = rewritten.find(
    (message) => message.event.item?.status === "completed" && JSON.stringify(message).includes("git push --force"),
  )!.seq!;
  assert.ok(facts[0]!.seq < settledAt, "before the call finishes");

  for (const command of [
    "git -C repo push --force",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    "psql -c 'drop table users'",
    "rm -rf build && git push --force",
    `psql <<'SQL'\ndrop table users;\nSQL`,
    `cat <<'EOF' | sh\ngit push --force\nEOF`,
  ])
    assert.equal(paged(command).length, 1, `what leaves the machine and cannot be undone pages: ${command}`);
  for (const command of [
    "echo 'git push --force'",
    "grep -rn 'git push --force' docs",
    "git push origin main",
    "rm -rf build",
    `cat > "$TMPDIR/down.sql" <<'SQL'\ndrop table users;\nSQL`,
  ])
    assert.deepEqual(paged(command), [], `not in quoted text, a stored script, nor what can be undone: ${command}`);

  // A page once quoted the first 200 characters, cut right where what it named began.
  const long = `cat ${"/long/path/segment".repeat(12)}/wrap.js ${"/long/path/segment".repeat(6)}/wrap.js | xargs git push --force origin`;
  const [quote] = paged(long);
  assert.match(quote ?? "", /git push --force origin$/);
  assert.equal(quote!.length <= 201, true, quote);
});
