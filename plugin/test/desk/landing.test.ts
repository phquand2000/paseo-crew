import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { type Lane, emptyLedger } from "../../server/desk/ledger.ts";
import { askFirstHits, changeOf } from "../../server/desk/landing.ts";
import { type Project, configFile, loadConfig, saveConfig } from "../../server/desk/project.ts";
import { tempDir } from "../tempdir.ts";

/** A repository whose main holds a test with two assertions, and a lane branch the test writes on. */
function shop() {
  const root = tempDir("sw2-landing-");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@x", ...args], { encoding: "utf-8" });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("src/cart.ts", "export const total = 1;\n");
  write("test/cart.test.ts", "assert.equal(total, 1);\nassert.ok(total);\n");
  write("test/old.test.ts", "assert.ok(true);\n");
  write("package-lock.json", "{}\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "seed");
  git("checkout", "-qb", "lane/l1");
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "work");
  };
  const project: Project = { root, slug: "shop-abc123", state: tempDir("sw2-landing-state-") };
  const lane = {
    id: "L1",
    title: "Cart",
    outcome: "a cart",
    acceptance: [],
    outOfScope: [],
    base: "main",
    branch: "lane/l1",
    writeSet: ["src/**", "test/**"],
    contracts: [],
    opener: "sup",
    status: "open",
    openedAt: 0,
    tasks: 0,
    ready: { at: 0 },
  } as unknown as Lane;
  const ledger = emptyLedger();
  ledger.lanes.L1 = lane;
  const asksFirst = (paths: string[]) => saveConfig(project.state, { ...loadConfig(project.state), askFirst: paths });
  return { root, git, write, commit, project, lane, ledger, asksFirst };
}

test("a landing waits for the Human only where it changes a path they asked to be asked about first", async () => {
  const { write, commit, project, lane, asksFirst } = shop();
  write("src/auth/login.ts", "export const login = 1;\n");
  write("src/authors.ts", "export const authors = [];\n");
  write("db/001.sql", "create table t (id int);\n");
  commit();
  asksFirst(["src/auth", "**/*.sql", "infra/"]);
  assert.deepEqual(
    askFirstHits(project, await changeOf(project, lane)),
    [
      "It changes src/auth/login.ts, under src/auth, which the Human asked to be asked about first.",
      "It changes db/001.sql, under **/*.sql, which the Human asked to be asked about first.",
    ],
    "a plain path covers what is under it, and only on a path boundary",
  );
});

test("standing orders the desk cannot read hold every landing for the Human rather than letting it through", async () => {
  const { write, commit, project, lane } = shop();
  write("src/cart.ts", "export const total = 5;\n");
  commit();
  mkdirSync(project.state, { recursive: true });
  writeFileSync(configFile(project.state), "{ not json");
  assert.match(
    askFirstHits(project, await changeOf(project, lane)).join("\n"),
    /^The Human's standing orders cannot be read \(.*project\.json is there but could not be read.*\), so no landing goes ahead without them\.$/,
  );
});
