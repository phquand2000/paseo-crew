import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeAgent, fakePaseo } from "./fakes.ts";
import type { Kit } from "./kit.ts";
import { Runtime } from "./runtime.ts";

const kit: Kit = {
  seats: [{ role: "supervisor", harness: "claude", entry: true }, { role: "peer", harness: "omp" }],
  profiles: [],
  providers: {},
  harnesses: {},
};

function setup(entry: Kit = kit) {
  const root = mkdtempSync(join(tmpdir(), "seatworks-runtime-"));
  mkdirSync(join(root, ".seatworks"));
  const lines: string[] = [];
  const runtime = new Runtime({ kit: () => entry, log: (_, line) => lines.push(line), outbox: join(root, "outbox.json") });
  return { root, lines, runtime };
}

test("raise sends to an idle Supervisor and logs it", async () => {
  const { root, lines, runtime } = setup();
  const { paseo, sent } = fakePaseo([fakeAgent("s1", "supervisor", root)]);
  assert.equal(await runtime.raise(paseo, root, "ATTENTION: x", "a1 (peer)  x"), "sent");
  assert.deepEqual(sent, [{ id: "s1", text: "ATTENTION: x" }]);
  assert.deepEqual(lines, ["a1 (peer)  x  -> sent"]);
});

test("raise only logs when no Supervisor runs, and keeps nothing for later", async () => {
  const { root, lines, runtime } = setup();
  const { paseo } = fakePaseo([]);
  assert.equal(await runtime.raise(paseo, root, "ATTENTION: x", "a1 (peer)  x"), "logged");
  assert.deepEqual(runtime.letters(), []);
  assert.deepEqual(lines, ["a1 (peer)  x  -> logged"]);
});

test("an urgent event reaches a Supervisor mid-turn, but not one waiting on a permission request of its own", async () => {
  const { root, runtime } = setup();
  const supervisor = fakeAgent("s1", "supervisor", root, { status: "running" });
  const { paseo, sent } = fakePaseo([supervisor]);
  assert.equal(await runtime.raise(paseo, root, "ATTENTION (urgent): y", "a1 (peer)  y", true), "sent");
  supervisor.status = "idle";
  supervisor.pendingPermissions = [{ id: "own" }];
  assert.equal(await runtime.raise(paseo, root, "ATTENTION (urgent): z", "a1 (peer)  z", true), "held");
  assert.deepEqual(sent.map((entry) => entry.text), ["ATTENTION (urgent): y"]);
});

test("sendNow refuses a busy agent and treats a message just sent as a turn in progress", async () => {
  const { root, runtime } = setup();
  const watcher = fakeAgent("w1", "watcher", root, { status: "running" });
  const { paseo, sent } = fakePaseo([watcher]);
  assert.equal(await runtime.sendNow(paseo, "w1", "SWEEP one"), false);
  watcher.status = "idle";
  assert.equal(await runtime.sendNow(paseo, "w1", "SWEEP two"), true);
  assert.equal(await runtime.sendNow(paseo, "w1", "SWEEP three"), false);
  assert.deepEqual(sent.map((entry) => entry.text), ["SWEEP two"]);
});

test("dispose cancels pending timers", async () => {
  const { runtime } = setup();
  let ran = false;
  runtime.later("t", 10, async () => {
    ran = true;
  });
  runtime.dispose();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(ran, false);
});
