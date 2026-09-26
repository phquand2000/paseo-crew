import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadKit } from "../../server/catalog/kit/kit.ts";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS = join(PLUGIN, "harness");

test("a role that shares another's prompt gets that role's harness files, differing only in its name", () => {
  const kit = loadKit(PLUGIN);
  const twins = kit.roles.flatMap((twin) => {
    const base = kit.roles.find((role) => role.prompt === twin.prompt)!;
    return base === twin ? [] : [{ base, twin }];
  });
  assert.deepEqual(twins.map(({ base, twin }) => `${twin.role}:${base.role}`).sort(), [
    "backup-peer:peer",
    "senior-reviewer:reviewer",
  ]);
  for (const harness of readdirSync(HARNESS))
    for (const kind of ["delta", "settings", "rules"]) {
      const dir = join(HARNESS, harness, kind);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir);
      for (const { base, twin } of twins)
        for (const file of files.filter((name) => name.startsWith(`${base.role}.`))) {
          const own = file.replace(base.role, twin.role);
          const where = `${harness}/${kind}/${own}`;
          assert.ok(files.includes(own), `${where} is missing beside ${file}`);
          const text = readFileSync(join(dir, file), "utf-8");
          const renamed = text.replaceAll(`The ${base.label} `, `The ${twin.label} `);
          assert.ok(
            [text, renamed].includes(readFileSync(join(dir, own), "utf-8")),
            `${where} has drifted from ${file}`,
          );
        }
    }
});
