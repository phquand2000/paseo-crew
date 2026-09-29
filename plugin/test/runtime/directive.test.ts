import assert from "node:assert/strict";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { tempDir } from "../tempdir.ts";
import { harness } from "./harness.ts";

const lane = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  outcome: "x",
  acceptance: ["a"],
  outOfScope: ["anything else in the repository"],
  ...extra,
});

test("a Lead's directive says what its lane writes, depends on and keeps to one writer, how the project gates, and where the Human's concept is", async () => {
  const h = harness();
  const sup = h.add("crew-supervisor-claude/claude-opus-5", h.root, "sup");
  const open = (title: string, extra: Record<string, unknown> = {}) =>
    h.call(sup, "supervisor", "open_lane", lane(title, { isolate: true, ...extra }));
  const directive = (id: string) => h.agents.get(h.ledger().lanes[id]!.lead!)!.prompt ?? "";
  h.commit(h.root, "package.json", JSON.stringify({ scripts: { test: "echo ran" } }));
  assert.match((await h.call(sup, "supervisor", "set_project", { gate: "" })).text, /gate none/);
  assert.match((await open("Off", { writeSet: ["f.txt"] })).text, /Gate: none set, by this project's own choice/);
  assert.match((await h.call(sup, "supervisor", "set_project", {})).text, /gate none/);
  assert.match(
    (await h.call(sup, "supervisor", "set_project", { gate: "npm test" })).text,
    /gate npm test, run per task/,
  );
  await open("Build", { writeSet: ["a.txt", "package-lock.json"], contracts: ["b.txt"] });
  const build = directive("L2");
  assert.match(
    build,
    /^Writes: a\.txt, package-lock\.json\. A change outside these is flagged at hand-back and at landing; if the work needs more, take_paths what no other lane holds, and ask with kind need for what one does\.$/m,
  );
  assert.match(build, /^Depends on: b\.txt, which this lane uses and does not write\.$/m);
  assert.match(
    build,
    /^One writer at a time: package-lock\.json\. A task that writes any of these works in the lane's working copy, not in parallel\.$/m,
  );
  assert.match(
    build,
    /^Gate: npm test runs on every task with the lane brought in, and its verdict reaches the Lead with the hand-back; the lane takes a task red only when its Lead accepts it over the gate with a reason$/m,
  );
  assert.match(
    build,
    /^Lane branch: lane\/l2-build, off main\. Your working copy is on it save while a task works there on a branch of its own; tasks merge into it\.$/m,
  );

  await h.call(sup, "supervisor", "set_project", { gateOn: "lane" });
  await open("Copy", { writeSet: ["c.txt"] });
  assert.match(
    directive("L3"),
    /^Gate: npm test runs on the whole lane when you report it ready; merges are not gated, so the lane branch can break between reports$/m,
  );
  const loose = await open("Loose");
  assert.equal(loose.ok, true, loose.text);
  assert.match(
    loose.text,
    /It declared no write set, so it opened beside lanes that may be writing what only one lane at a time may write: L2 \(package-lock\.json\)\. Its Lead is told to leave those to them; amend_lane can give it a write set\./,
  );
  assert.match(
    directive("L4"),
    /^Writes: not declared, so lanes opened after this one are kept off every path this project keeps to one writer\. Lanes already open may be writing what only one lane at a time may write: L2 \(package-lock\.json\)\. Leave those to them until they land, or ask with kind need\.$/m,
  );
  assert.doesNotMatch(directive("L3"), /Lanes already open/);

  const concept = join(h.project.state, "CONTEXT.md");
  assert.equal(existsSync(concept), false);
  for (const id of ["L1", "L2", "L3", "L4"]) assert.doesNotMatch(directive(id), /CONTEXT\.md/);
  writeFileSync(concept, "# Shop\n\n## Behavior\n\n- A guest may check out.\n");
  await open("Guests", { writeSet: ["d.txt"] });
  const pointed = directive("L5");
  assert.match(
    pointed,
    new RegExp(`is in ${concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Read it before you start`),
  );
  assert.match(pointed, /ask with kind question, and leave the file as it is/);

  await h.call(sup, "supervisor", "set_project", { serialOnly: ["b.txt"] });
  await open("Own list", { writeSet: ["e.txt"] });
  assert.match(
    directive("L6"),
    /^One writer at a time: b\.txt\. A task that writes any of these works in the lane's working copy, not in parallel\.$/m,
  );
  assert.doesNotMatch(directive("L6"), /package-lock/);

  const bin = tempDir("blind-git-");
  const real = h.git(h.root, "--exec-path").trim();
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\ncase " $* " in *" ls-files "*) echo "fatal: index file corrupt" >&2; exit 128;; esac\nexec "${real}/git" "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  await h.call(sup, "supervisor", "set_project", { serialOnly: ["b.txt", "vendor/**"] });
  const path = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${path}`;
  try {
    await open("Blind", { writeSet: ["g.txt"] });
  } finally {
    process.env.PATH = path;
  }
  assert.match(
    directive("L7"),
    /^One writer at a time: b\.txt, vendor\/\*\*\. A task that writes any of these works in the lane's working copy, not in parallel\.$/m,
    "where git cannot list the copy, every one-writer rule counts",
  );
});
