import type { TestContext } from "node:test";
import { format } from "node:util";

/** What the code reported through `console.error` during this test, which then does not fail it. */
export function reported(t: TestContext): () => string {
  const mocked = t.mock.method(console, "error", () => {});
  return () => mocked.mock.calls.map((call) => format(...call.arguments)).join("\n");
}
