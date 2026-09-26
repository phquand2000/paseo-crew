// First, so this file has a HOME of its own even run alone: what it writes under HOME would otherwise land in the owner's.
import "../setup.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import type { z } from "zod";
import { home } from "../../server/core/paths.ts";
import { contracts } from "../../shared/rpc.ts";
import { tempDir } from "../tempdir.ts";
import { fakeIde } from "./code-fakes.ts";
import { served, which } from "./served.ts";

/** A port nothing listens on: one this machine gave out and took back. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("the doctor over the panel names what this machine lacks for the team, a server at a time", async (t) => {
  const { call } = served();
  const bins = tempDir("sw2-bin-");
  const gitHome = execFileSync("git", ["--exec-path"], { encoding: "utf-8" }).trim();
  const path = process.env.PATH;
  process.env.PATH = [bins, gitHome].join(delimiter);
  t.after(() => void (process.env.PATH = path));
  const install = (...names: string[]) => {
    for (const name of names) {
      writeFileSync(join(bins, name), "#!/bin/sh\nexit 0\n");
      chmodSync(join(bins, name), 0o755);
    }
  };
  const login = join(home(), ".omp", "agent", "agent.db");
  const loggedIn = (yes: boolean) => {
    if (!yes) return rmSync(login, { force: true });
    mkdirSync(join(home(), ".omp", "agent"), { recursive: true });
    writeFileSync(login, "");
  };
  const setUp = async (values: z.input<typeof contracts.settingsWrite.input>["values"]) => {
    const read = which(await call(contracts.settingsRead, {}), "values");
    assert.equal((await call(contracts.settingsWrite, { revision: read.revision, values })).status, "saved");
  };
  const checked = async () => Object.fromEntries((await call(contracts.doctor, {})).map((check) => [check.id, check]));
  const partial = await fakeIde(t, { tools: ["ide_find_references", "ide_open_project"] });
  const full = await fakeIde(t, { tools: ["ide_find_references", "ide_refactor_rename", "ide_open_project"] });
  const nowhere = await closedPort();
  const at = (port: number) => ({ type: "http" as const, url: `http://127.0.0.1:${port}/mcp` });

  install("claude");
  loggedIn(true);
  await setUp({ mcp: { ide: { settings: { port: partial.port } }, docs: { enabled: true, connect: at(nowhere) } } });
  const short = await checked();
  assert.equal(short.settings!.ok, true);
  assert.equal(short["bin:jq"]!.ok, false, "a tool seats need that is not on PATH");
  assert.deepEqual([short["harness:claude"]!.ok, short["harness:omp"]!.ok], [true, false], "an agent a role runs on");
  assert.equal(short["mcp:ide"]!.ok, false);
  assert.match(short["mcp:ide"]!.detail, /ide_refactor_rename/, "the IDE tool a role uses and the IDE does not offer");
  assert.equal(short["mcp:docs"]!.ok, false, "a server that does not answer");

  install("jq", "omp");
  await setUp({ mcp: { ide: { settings: { port: full.port } } } });
  const whole = await call(contracts.doctor, {});
  assert.ok(
    whole.every((check) => check.ok),
    JSON.stringify(whole),
  );
  assert.equal(
    whole.some((check) => check.id === "mcp:docs"),
    false,
    "a server nobody uses is skipped",
  );
  await setUp({ mcp: { ide: { settings: { port: nowhere } } } });
  assert.match((await checked())["mcp:ide"]!.detail, /No IDE server answered/);

  loggedIn(false);
  const unlogged = (await checked())["harness:omp:HOME/.omp/agent/agent.db"]!;
  assert.equal(unlogged.ok, false, "what a harness says its seats need on this machine is checked");
  assert.match(unlogged.detail, /agent\.db for Peer, Scribe\. Log in with omp once/, "and how to get it is said");
  loggedIn(true);
  assert.equal((await checked())["harness:omp:HOME/.omp/agent/agent.db"]!.ok, true);

  // A null in an outside server's tools list once threw out of the report, taking every check with it.
  const hostile = await fakeIde(t, { malformed: true });
  await setUp({ mcp: { ide: { settings: { port: hostile.port } }, docs: { enabled: true, connect: at(full.port) } } });
  const survived = await checked();
  assert.equal(survived["mcp:ide"]!.ok, false, "a server whose list cannot be read costs its own check");
  assert.deepEqual([survived.settings!.ok, survived["mcp:docs"]!.ok], [true, true], "and not the rest of the report");
});
