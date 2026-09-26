import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit/kit.ts";
import { watchPatterns } from "../../server/catalog/kit/patterns.ts";
import { onDetail } from "../../server/runtime/watch/commands.ts";
import type { Rules } from "../../server/runtime/watch/facts.ts";

const kit = loadKit(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

const rules = (extra: Partial<Rules> = {}): Rules => ({
  ...watchPatterns(kit, kit.attention),
  gates: [],
  repeatsAt: 3,
  recoverWithin: 10,
  ...extra,
});

test("an irreversible command is quoted where it is irreversible, however long what comes before it", () => {
  // A page once quoted the first 200 characters, cut right where the `rm -rf` target began.
  const command = `cat ${"/long/path/segment".repeat(12)}/wrap.js > ${"/long/path/segment".repeat(6)}/wrap.js && rm -rf /Users/me/stray-copy`;
  const [fact] = onDetail(
    { id: "c", name: "Bash", status: "completed", ended: true, detail: { type: "shell", command } } as never,
    rules(),
  );
  assert.equal(fact?.kind, "destructive");
  assert.match(fact.quote, /rm -rf \/Users\/me\/stray-copy$/);
  assert.equal(fact.quote.length <= 201, true, fact.quote);
});

test("removing only scratch files is not an irreversible command, and anything else in the same line still is", () => {
  // A Lead writing a commit message to $TMPDIR and removing it afterwards was paged as destructive.
  const shell = (command: string) =>
    onDetail(
      { id: "c", name: "Bash", status: "completed", ended: true, detail: { type: "shell", command } } as never,
      rules({ temp: "/var/folders/xy/T" }),
    );
  assert.deepEqual(
    shell(`cat > "$TMPDIR/msg" <<'EOF'\nfix: merge\nEOF\ngit commit -F "$TMPDIR/msg" && rm -f "$TMPDIR/msg"`),
    [],
  );
  assert.deepEqual(shell("rm -rf /tmp/sw2-probe ${TMPDIR}/x /var/folders/xy/T/y"), []);
  const [kept] = shell(`rm -f "$TMPDIR/msg" && rm -rf src`);
  assert.equal(kept?.kind, "destructive");
  assert.match(kept.quote, /rm -rf src/);
  assert.equal(shell("rm -rf /tmp/a src").length, 1, "one real target among scratch ones is enough");
});

test("what a command makes for itself and then removes is scratch, and anything else it removes is not", () => {
  // Three pages were a scratch directory from mktemp, removed at the end of the same command.
  const shell = (command: string) =>
    onDetail(
      { id: "c", name: "Bash", status: "completed", ended: true, detail: { type: "shell", command } } as never,
      rules(),
    );
  assert.deepEqual(shell(`demo=$(mktemp -d) && cd "$demo" && git init -q && npm test; rm -rf "$demo"`), []);
  assert.deepEqual(shell("work=`mktemp -d`; rm -rf ${work}/build"), []);
  assert.deepEqual(shell("mkdir -p out/tmp && node build.js out/tmp && rm -rf out/tmp"), []);
  assert.equal(
    shell(`demo=$(mktemp -d) && rm -rf "$HOME/demo"`)[0]?.kind,
    "destructive",
    "a variable nothing here set from mktemp is not scratch",
  );
  assert.equal(shell("mkdir -p out/tmp && rm -rf out")[0]?.kind, "destructive", "removing more than it made is not");
});
