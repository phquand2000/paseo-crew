import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SEAT_KEY } from "../../server/catalog/kit/kit.ts";
import { tempDir } from "../tempdir.ts";
import { laneWith } from "./landable.ts";

test("a lane's seats and gates share a cache the desk removes once the lane is closed and no gate of it runs", async () => {
  const dir = tempDir("crew-cache-");
  const [runs, hold, reached, go] = ["runs", "hold", "reached", "go"].map((name) => join(dir, name)) as [
    string,
    string,
    string,
    string,
  ];
  const wait = `if [ -f '${hold}' ]; then touch '${reached}'; while [ ! -f '${go}' ]; do sleep 0.05; done; fi`;
  const gate = `${wait}; echo "$CREW_CACHE $CREW_SCRATCH $TMPDIR" >> '${runs}'; touch "$CREW_CACHE/kept"`;
  const { h, sup, lane, work } = await laneWith({ "a.txt": "a\n" }, [], true, gate);
  const [cache, scratch, tmp] = readFileSync(runs, "utf-8").trim().split(" ") as [string, string, string];
  assert.equal(scratch, tmp, "a gate's scratch is the temp directory of its run");
  assert.ok(existsSync(join(cache, "kept")));
  const env = h.runtime.sessionOpen({
    agentId: "agent-x",
    reason: "create",
    purpose: "interactive",
    provider: "crew-peer-codex",
    cwd: lane.worktree!,
    env: { [SEAT_KEY]: "kx" },
  }).env;
  assert.deepEqual(
    [env.CREW_CACHE, env.CREW_SCRATCH],
    [cache, env.TMPDIR],
    "a seat in the lane's copy shares its cache",
  );

  writeFileSync(hold, "");
  work({ "a.txt": "b\n" });
  const ready = h.call(lane.lead!, "lead", "report", { summary: "again", ready: true });
  while (!existsSync(reached)) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await h.call(sup, "supervisor", "drop_lane", { lane: "L1", reason: "not wanted" })).ok, true);
  await h.tick();
  assert.ok(existsSync(cache), "not while a gate of the lane still runs");
  writeFileSync(go, "");
  await ready;
  await h.tick();
  assert.equal(existsSync(cache), false, "gone once the lane is closed and its gate has ended");
});
