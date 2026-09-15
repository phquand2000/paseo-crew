# seatworks-v2 plugin

| Path | Holds |
|---|---|
| `index.server.ts` | Wires the runtime |
| `roles.json` | Roles with their default harness, model and thinking; limits; attention timings |
| `harness/<id>/` | Harness manifest (models, prompt, rules, skills and MCP delivery), role settings, `NOTES.md` |
| `catalog/mcp/<id>/` | MCP servers the settings can turn on: `mcp.json`, `rule.md`, `skills/` |
| `mcp/team.mjs`, `mcp/tools.json` | The team tool server each seat runs and its tools per role |
| `mcp/code.mjs` | The generic proxy that pins a catalog server's calls to the caller's working copy, following the entry's `proxy` spec |
| `content/prompts/`, `content/guides/`, `content/skills/<set>/`, `content/records/` | Role prompts, guides, skills, and files seeded into project state |
| `server/core/` | Leaf helpers with no plugin knowledge: git, gate, scope, paths, JSON store, JSON-RPC client, Paseo types |
| `server/catalog/` | Loading the catalog, settings layers, resolving a team, providers, seat directories, launch config |
| `server/desk/` | The team desk: `desk.ts` routes tool calls; `context.ts` owns ledger, events and mail; `slots.ts`, `agents.ts`, `merge.ts`, `gates.ts`; `tools/` holds each role's tools |
| `server/runtime/` | `runtime.ts` wires hooks; `team-source.ts`, `seating.ts`, `turns.ts`, `watch-queue.ts`, `patrol.ts`, `control.ts` and `rpc.ts` do the work; outbox, spool, `code-index.ts` (opens a new working copy in indexed proxies), doctor |

Tests sit next to the module they cover. Dependencies point one way: `runtime` uses `desk`,
`catalog` and `core`; `desk` uses `catalog` and `core` and declares the code index and mailer it
needs; `catalog` uses `core`; `core` uses nothing of the plugin. Tests follow the same direction.

No code under `server/` or `mcp/` names a harness, model, tool or MCP server: those live in `roles.json`,
`harness/<id>/` and `catalog/mcp/<id>/`, and a proxied server's backend, pinned argument, open, wait and
sync hooks, error guidance and tool descriptions are its `mcp.json` `proxy` spec.

`npm run check` typechecks and runs the unit tests.
