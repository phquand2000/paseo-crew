# seatworks-v2 plugin

| Path | Holds |
|---|---|
| `index.server.ts` | Wires the runtime |
| `roles.json` | Roles, harness per role, models, limits, attention timings |
| `harness/<id>/` | Harness manifest, role settings, `NOTES.md` with verified behavior |
| `mcp/team.mjs`, `mcp/tools.json` | The team tool server each seat runs and its tools per role |
| `content/prompts/` | One prompt per role |
| `content/guides/` | Guides a role reads when needed |
| `content/skills/<set>/` | Skills linked into seats |
| `content/records/` | Files seeded into each project's state directory |
| `server/desk.ts` | Tool handlers: lanes, tasks, asks, merge queue |
| `server/runtime.ts` | Hooks, spool, turn-end rules, watcher, patrol |
| `server/*.ts` | Ledger, git, gate, letters, outbox, seats, providers |

`npm run check` typechecks and runs the unit tests.
