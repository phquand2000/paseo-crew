# Seatworks v2 Paseo plugin

Seatworks runs a Supervisor, Leads, Peers, Reviewers and a Watcher as Paseo agents. In v2 the whole
kit is this plugin: it writes one Paseo provider and profile per role, builds each role's seat
directory, gives every new agent its role prompt, and carries messages between seats itself.

## What it does

| Area | Behaviour |
|---|---|
| Roles | `roles.json` names each role's harness, models, skills, MCP servers and Paseo tool limits. On load the plugin writes a provider and an agent profile per role (`providerPrefix` + role) into `~/.paseo/config.json` and reloads the daemon when anything changed. |
| Harnesses | `harness/<id>/harness.json` says how a harness takes a role: Claude gets the prompt as a system prompt and its hand-made `settings/<role>.settings.json` linked into the seat; Devin gets a real `devin/AGENTS.md`, merged `devin/config.json`, `mcp_config.json` and linked skills. `bin/seat-room` forces launch flags such as `--setting-sources user`. |
| Launch | Before an agent is created the plugin sets the role's model (any unknown model becomes the role default), mode, thinking level and prompt. A seat that its parent's `mayStart` does not name is archived and the parent is told why. |
| Delivery | Seats start children with finish notifications off. When a turn ends, the plugin reads it: a Lead's `REPORT` / `NEED` / `BLOCKED` / `QUESTION (concept)` blocks go to its parent, a Peer's or Reviewer's reply goes to its Lead as a hand-back, and failed turns, turns stopped by a refused call and pending permissions are reported. Letters wait in an outbox until the recipient is idle and go out together. |
| Open requests | `NEED`, `BLOCKED` and `QUESTION` stay open until a later turn of that Lead no longer raises them; every letter to the entry role lists them, and they are re-sent when they sit unanswered. |
| Stalls | A Lead idle past `attention.leadIdleMinutes` with no running seat under it and no open request is reported once per idle period. |
| Records | Per project, outside the repository, in `~/.local/share/seatworks-v2/projects/<slug>/`: `status.md`, `asks.json`, `attention.log`, and the seeded `notebook.md`, `protocol.md`, `lessons.md`. |

## Layout

| Path | Holds |
|---|---|
| `index.server.ts` | Loads the kit and starts the runtime |
| `roles.json` | Role specs, shared MCP servers, provider prefix, attention settings |
| `harness/` | Harness manifests, hand-made role settings, harness notes |
| `bin/seat-room` | The launcher every role provider runs |
| `content/prompts/` | Role prompts with `{{guides}}` and `{{state}}` placeholders |
| `content/guides/`, `content/skills/`, `content/records/` | Guides linked at `~/.local/share/seatworks-v2/guides`, skills linked into seats, record templates |
| `server/kit.ts`, `content.ts` | Reading the kit, rendering prompts, finding skills |
| `server/providers.ts`, `seats.ts` | Provider and profile reconcile; seat directories and records |
| `server/launch.ts` | Role config at create, seat env at session open, `mayStart` |
| `server/decide.ts`, `markers.ts`, `timeline.ts` | What a finished turn sends and to whom |
| `server/outbox.ts`, `asks.ts`, `stall.ts` | Delivery when idle, open requests, stalls and the status file |
| `server/runtime.ts` | Wiring hooks and the timer |

## Develop

```bash
npm run check
```

Tests run with `node --test` on the TypeScript sources; `server/kit.real.test.ts` builds every role's
seat from the shipped kit in a temporary home.
