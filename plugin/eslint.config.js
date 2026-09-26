import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/** Files not yet clean of these rules. The list only shrinks: a file comes off it once it passes. */
const NOT_YET_CLEAN = [
  "server/adapters/decisions.ts",
  "server/adapters/paseo/host.ts",
  "server/core/config-file.ts",
  "server/core/gate.ts",
  "server/core/git.ts",
  "server/runtime/control.ts",
  "server/runtime/seating.ts",
  "server/runtime/timeline.ts",
  "server/runtime/turns.ts",
  "server/runtime/watch-view.ts",
  "server/upkeep/migrate.ts",
  "test/kit.ts",
  "test/runtime/fake-timeline.ts",
];

export default defineConfig(
  {
    ignores: [
      "node_modules",
      "client",
      "index.client.tsx",
      "mcp",
      "bin",
      "content",
      "harness",
      "catalog",
      "test/fixtures",
      ...NOT_YET_CLEAN,
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "suite", "describe", "it"] },
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/require-await": "off",
    },
  },
  { files: ["eslint.config.js"], extends: [tseslint.configs.disableTypeChecked] },
);
