# Seatworks

Seatworks runs an SLPW agent team (Supervisor, Lead, Peer, Watcher) on [Paseo](https://getpaseo.com)
as one plugin. You talk to the Supervisor. It opens a lane per outcome, each Lead splits its lane into
tasks, each Peer works on its own branch, and the plugin merges accepted work through a gated queue.

- **Supervisor** decides everything short of the project's concept for you, and steps in when a lane
  goes wrong.
- **Lead** owns one lane: tasks, Peers, reviews, acceptance and integration.
- **Peer** does one task on its own branch and hands it back. A **Reviewer** is a read-only Peer.
- **Watcher** is a cheap model the plugin runs on flagged turn endings; it raises attention.

Coordination is code, not chat: every hand-back, ask, merge and report is a tool call the plugin
records, mail waits until the recipient's turn ends, and silence is detected. See
[DESIGN.md](DESIGN.md) for how and why.

## Install

You need Paseo 0.8, Node 22 or later, git, jq, and the coding agents your settings choose (by default
Claude Code for the Supervisor and Lead, Devin CLI for the Peer, Reviewer and Watcher), logged in.

```bash
cd plugin && npm install && npm run check
```

```bash
paseo plugin install ./plugin
```

The plugin writes one Paseo provider and profile for each role on each harness that has settings for
it (`sw2-supervisor-claude`, `sw2-lead-claude`, `sw2-peer-devin`, `sw2-reviewer-devin`) and builds
each role's seat directory per project the first time an agent of that role starts there. After
editing server code, run `paseo plugin reload seatworks-v2`.

The same plugin runs on any machine: nothing in it names a path, port or login of this one. Choices
that differ per machine or per project live in settings, not in the plugin.

## Use

Start an agent from the `sw2-supervisor-claude` profile in your repository and tell it what you
want. Project state (ledger, status, hand-backs, gate logs, notebook, project settings) lives in
`~/.local/share/seatworks-v2/projects/<repo>-<hash>/`, never in your repository; `status.md` there is
the one-screen view. Lanes land on your base branch when the Supervisor closes them; pushing is yours.

## Settings

Settings come in two layers over the catalog defaults: the machine layer in
`~/.local/share/seatworks-v2/settings.json`, and a project layer in each project's state directory.
A project value overrides the machine value, which overrides the catalog.

```json
{
  "roles": { "peer": { "harness": "devin", "model": "swe-2-max" } },
  "mcp": { "context7": { "enabled": false }, "intellij-index": { "settings": { "port": 29170 } } },
  "limits": { "slots": 3 },
  "rules": "Use pnpm."
}
```

- `roles.<role>`: the harness, model and thinking option. The harness needs settings for that role
  under `plugin/harness/<id>/settings/`.
- `mcp.<id>`: turn a catalog server on or off, narrow the roles that get it, or set its settings.
  Turning one on also adds its rule to the seats' `CLAUDE.md` or `AGENTS.md` and links its skills.
- `limits`, `attention` (machine only) and `rules`, free text appended to every seat's rules.

A web app manages them through the plugin's RPC, called with the Paseo client's
`invokePluginRpc("seatworks-v2", method, input)`:

| Method | Input | Returns |
|---|---|---|
| `seatworks.catalog.read` | | roles, harnesses with models, MCP servers with their settings |
| `seatworks.projects.list` | | projects seen on this machine |
| `seatworks.settings.read` | `project?` | `ready` with `revision` and `values`, or `invalid` |
| `seatworks.settings.write` | `project?`, `revision`, `values` | `saved`, `conflict` or `invalid` with the reason |
| `seatworks.settings.reset` | `project?`, `revision` | as write |
| `seatworks.team.read` | `project?` | each role's harness, provider, model, servers, tools, skills and rules, plus errors |
| `seatworks.doctor.run` | `project?` | checks: agents, jq, git, proxied servers and their tools, reachable servers |
| `seatworks.status.read` | `project` | the project's status text |

A write that leaves a role without a working harness, model or server is refused with the reason.
New agents pick changes up; running agents keep what they started with.

## Add a harness or an MCP server

- **Harness:** a directory under `plugin/harness/<id>/` with `harness.json` (how it takes a prompt,
  rules, skills and MCP servers, its models and launcher), `settings.json` shared by its roles, and
  `settings/<role>.settings.json` with what each role it can run adds (`{}` for nothing). A file
  ending in `.toml`, in the kit or in a seat, is read and written as TOML; any other as JSON.
- **MCP server:** a directory under `plugin/catalog/mcp/<id>/` with `mcp.json`, an optional
  `rule.md` and `skills/`. It shows up in the catalog and can be turned on from settings.
