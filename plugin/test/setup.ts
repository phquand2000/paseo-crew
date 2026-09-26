import { afterEach, beforeEach } from "node:test";
import { format } from "node:util";
import { tempDir } from "./tempdir.ts";

/** A HOME of its own for every test, set before any test file loads, so none reads the owner's state or another test's. */
const freshHome = () => {
  process.env.HOME = tempDir("sw2-home-");
  delete process.env.PASEO_HOME;
};
freshHome();
beforeEach(freshHome);

const said: string[] = [];
const original = console.error.bind(console);
console.error = (...args: unknown[]) => {
  said.push(format(...args));
};

/** A test that expects an error says so by mocking `console.error`; anything else it prints fails it. */
afterEach(() => {
  const found = said.splice(0);
  if (found.length > 0) throw new Error(`console.error was called and the test did not expect it (one that does reads it with reported(t) from test/console.ts):\n${found.join("\n")}`);
});

process.on("exit", () => {
  if (said.length === 0) return;
  original(`console.error was called after the tests ended:\n${said.join("\n")}`);
  process.exitCode = 1;
});
