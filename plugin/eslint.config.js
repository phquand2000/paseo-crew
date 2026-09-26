import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/** Files not yet clean of these rules. The list only shrinks: a file comes off it once it passes. */
const NOT_YET_CLEAN = [
  "server/adapters/decisions.ts",
  "server/adapters/paseo/host.ts",
  "server/catalog/seat/launch.ts",
  "server/catalog/paseo/providers.ts",
  "server/catalog/seat/seats.ts",
  "server/catalog/seat/servers.ts",
  "server/core/config-file.ts",
  "server/core/gate.ts",
  "server/core/git.ts",
  "server/core/paths.ts",
  "server/desk/checks.ts",
  "server/desk/context.ts",
  "server/desk/notice.ts",
  "server/desk/project.ts",
  "server/desk/roster.ts",
  "server/desk/slots.ts",
  "server/desk/sweep.ts",
  "server/runtime/control.ts",
  "server/runtime/seating.ts",
  "server/runtime/timeline.ts",
  "server/runtime/turns.ts",
  "server/runtime/watch-view.ts",
  "server/upkeep/migrate.ts",
  "test/adapters/decisions.test.ts",
  "test/core/stream.test.ts",
  "test/desk/incidents.test.ts",
  "test/kit.ts",
  "test/mcp/team.test.ts",
  "test/runtime/code-backend.test.ts",
  "test/runtime/code-fakes.ts",
  "test/runtime/code-proxy.test.ts",
  "test/runtime/facts.test.ts",
  "test/runtime/fake-timeline.ts",
  "test/runtime/half-open.test.ts",
  "test/runtime/incident-routing.test.ts",
  "test/runtime/judging.test.ts",
  "test/runtime/kept-lead.test.ts",
  "test/runtime/moments.test.ts",
  "test/runtime/opening.test.ts",
  "test/runtime/own-branch.test.ts",
  "test/runtime/rpc.test.ts",
  "test/runtime/seat-replay.ts",
  "test/runtime/team-socket.test.ts",
  "test/runtime/watcher.test.ts",
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
