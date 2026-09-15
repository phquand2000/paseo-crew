# seatworks-v2 plugin

| Path | Holds |
|---|---|
| `index.server.ts` | Wires the runtime |
| `roles.json` | Roles with their default harness, model and thinking; limits; attention timings |
| `harness/<id>/` | Harness manifest (models, prompt, rules, skills and MCP delivery), role settings, `NOTES.md` |
| `catalog/mcp/<id>/` | MCP servers the settings can turn on: `mcp.json`, `rule.md`, `skills/` |
| `mcp/team.mjs`, `mcp/tools.json` | The team tool server each seat runs and its tools per role |
| `mcp/code.mjs` | The proxy that pins IDE and code-search calls to the caller's working copy |
| `content/prompts/` | One prompt per role |
| `content/guides/` | Guides a role reads when needed |
| `content/skills/<set>/` | Skills linked into seats |
| `content/records/` | Files seeded into each project's state directory |
| `server/desk.ts` | Tool handlers: lanes, tasks, asks, merge queue |
| `server/runtime.ts` | Hooks, spool, turn-end rules, watcher, patrol, settings RPC |
| `server/settings.ts`, `server/team.ts` | Settings layers, and resolving catalog plus settings into a team |
| `server/rpc.ts`, `server/doctor.ts` | RPC contracts for a web app, and machine checks |
| `server/*.ts` | Ledger, git, gate, letters, outbox, seats, providers |

`npm run check` typechecks and runs the unit tests.
