# Seatworks

> **Warning:** this project is 100% vibe-coded and supported by nobody — if you need something from
> it, fork it.

Seatworks runs an SLPW agent team — Supervisor, Lead, Peer, Watcher — on
[Paseo](https://paseo.sh) as one plugin.

You talk to the Supervisor. It opens a lane per outcome. Each Lead splits its lane into tasks, each
Peer works on its own branch, and the plugin merges accepted work through a gated queue.

- **Supervisor** decides everything short of the project's concept for you, and steps in when a lane
  goes wrong.
- **Lead** owns one lane: tasks, Peers, reviews, acceptance and integration.
- **Peer** does one task on its own branch and hands it back. A **Reviewer** is a read-only Peer.
- **Watcher** is a cheap model the plugin runs on flagged turn endings; it raises attention.

## The idea

**Coordination is code, not chat.**

Every hand-back, ask, merge and report is a tool call the plugin records. Mail waits until the
recipient's turn ends, so nothing interrupts a running turn. Silence is detected rather than hoped
against. Two tasks can never hold overlapping write sets, because the desk refuses.

The second idea follows from the first: **the code owns only the concept.** Which agent, model, tool
or MCP server a role runs on is data. Moving a Lead from Claude Code to Devin is a setting. Adding a
coding agent is a directory. Neither touches code.

<!-- Screenshots go here. Drop them in docs/images/ and link them:
     ![The team tab](docs/images/team.png)
     ![A lane in flight](docs/images/flow.png) -->

## Start here

| | |
|---|---|
| **[SETUP.md](SETUP.md)** | Install it, log the agents in, attach a project, and what to do when something is wrong |
| **[SPEC.md](SPEC.md)** | The contract: what a fork may change, how to add an agent or a server, and what the machine checks |
| **[DESIGN.md](DESIGN.md)** | Why the shape is this way, and what the run that caused it taught |
| **[NOTICE.md](NOTICE.md)** | Where the skills came from, with their licences |

## Quick install

```bash
cd plugin && npm install && npm run check
```

```bash
paseo plugin install ./plugin
```

Then start an agent from the `sw2-supervisor-claude` profile in your repository and tell it what you
want. Lanes land on your base branch when the Supervisor closes them; pushing stays yours.

Nothing Seatworks writes goes into your repository — the ledger, hand-backs, gate logs and notebook
live in `~/.local/share/seatworks-v2/`.

## Licence

MIT, see [LICENSE](LICENSE). Third-party material is attributed in [NOTICE.md](NOTICE.md).
