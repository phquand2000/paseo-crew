import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempDir(prefix = "crew-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
