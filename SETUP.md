# Setting Seatworks up

## What you need

- **Paseo 0.8** running, with its daemon started.
- **Node 22 or later** and **git**.
- **jq** — `bin/seat-room` reads each harness's launch flags with it.
- The coding agents your settings choose, logged in. By default that is **Claude Code** for the
  Supervisor and Lead and **Devin CLI** for the Peer, Reviewer and Watcher.

## Install

```bash
cd plugin && npm install && npm run check
```

```bash
paseo plugin install ./plugin
```

Paseo then shows a **Seatworks** item in its sidebar.

## Log the agents in

Credentials never live in this repository, and the kit never reads one.

- **Claude Code:** make a token with `claude setup-token` and set `CLAUDE_CODE_OAUTH_TOKEN` on
  Paseo's base `claude` provider. Every seat inherits it through `extends`.
- **Devin CLI:** `devin auth login`. The token lands in `~/.local/share/devin/credentials.toml`,
  outside every seat directory, so all seats share it.

A server that signs in with OAuth is per config directory, so it needs
`CLAUDE_CONFIG_DIR=<seat dir> claude mcp login <name>` once per seat.

## Attach a project

The **Add project** tab walks a repository Paseo knows, each role's agent and model, and the servers
to switch on, then attaches Seatworks to it. It offers only repositories worth offering: lane and
task worktrees are left out, so are directories that no longer exist and projects already set up.

Inside a project tab, the team is split by role and the servers by server. Each line says whether
the value is set here, inherited from the machine layer, or the catalog default, and a line set here
gets a button to clear it. The same screen runs the doctor, reads the project's status, and detaches
a project whose lanes are all closed.

## Use it

Start an agent from the `sw2-supervisor-claude` profile in your repository and tell it what you want.

Lanes land on your base branch when the Supervisor closes them. **Pushing stays yours.**

## Where things live

Nothing Seatworks writes goes into your repository.

```
~/.local/share/seatworks-v2/
  settings.json                   the machine layer
  guides/                         link to the kit's guides
  spool/requests, spool/replies   tool calls between team.mjs and the plugin
  outbox.json                     letters waiting for an idle recipient
  projects/<repo>-<hash>/
    project.json                  base branch, gate command, limits
    ledger.json                   lanes, tasks, asks, agents
    events.log                    one JSON line per event
    status.md                     the one-screen view
    handbacks/, gates/            full hand-backs and gate logs
    notebook.md                   the Supervisor's pattern notebook
    plans/                        lane plans for high-risk work
```

## Settings

Two layers over the catalog defaults: the machine layer above, and a project layer in each project's
state directory. A project value beats the machine value, which beats the catalog.

```json
{
  "roles": { "peer": { "harness": "devin", "model": "swe-2-max" } },
  "mcp": { "context7": { "enabled": false }, "intellij-index": { "settings": { "port": 29170 } } },
  "limits": { "slots": 3 },
  "rules": "Use pnpm."
}
```

- `roles.<role>` — harness, model, thinking option. The harness needs a
  `harness/<id>/settings/<role>.settings.json` for that role.
- `mcp.<id>` — paste a connection snippet and the server exists; `enabled`, `roles`, `tools`,
  `label` and `rule` are chosen afterwards. `removed: true` drops one, the shipped three included.
- `limits`, `attention` (machine only), and `rules`, free text appended to every seat's rules.

A write that leaves a role without a working harness, model or server is refused with the reason.
**New agents pick changes up; running agents keep what they started with.**

## After changing the code

```bash
cd plugin && npm run check
```

```bash
paseo plugin reload seatworks-v2
```

Reload **before** restarting the Paseo app, or the app keeps serving the bundle it already has.
`paseo plugin logs seatworks-v2` shows the plugin's own output, which is where `Plugin ready`
appears; `paseo daemon status` names the live daemon log on its `Logs` row.

## When something is wrong

Run the doctor from a project tab. It checks the agents, jq, git, the proxied servers and their
tools, and whether each server answers.

- **A seat has no tools** — the team server reaches the desk through a file spool; check
  `~/.local/share/seatworks-v2/spool/`.
- **A seat can't open the working copy** — the IntelliJ proxy needs the IDE running with its Index
  MCP Server plugin on, at the port in settings.
- **A role is missing from a harness** — that harness has no `settings/<role>.settings.json`, and a
  role is only offered where that file exists.
