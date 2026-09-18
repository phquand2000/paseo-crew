# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way: a
**Supervisor** who works with you, **Leads** who each own a line of work, and **Peers** who each do
one task. A **Reviewer** and a **Watcher** complete the team.

Seatworks makes no judgement calls about the work. It configures and starts the agents Paseo runs,
gives them a shared desk of lanes, tasks and questions, carries their messages, and keeps a durable
record of what happened. What it does enforce is mechanical:

- The desk's rules. Lanes that declare write sets may not overlap, a working copy has one writer at a
  time, and a red gate stops a lane from landing unless the Supervisor overrides it.
- Each role's permissions, on the agents that can enforce them. For example, a Claude Code, Codex or
  Devin seat cannot push or start other agents, and the Reviewer gets no editing tools.

![Seatworks inside Paseo](docs/images/overview.svg)

> **Status: pre-release.** Nothing here has shipped. There are no releases and no compatibility
> promises, and breaking changes land without a migration path.

## The team

![SLP: who decides what](docs/images/slp-graph.svg)

SLP is a graph, not a chain of command. Each party has its own kind of authority:

- The Human owns intent.
- The Supervisor reads that intent and may intervene across lanes.
- The Lead owns sequencing and acceptance inside its lane.
- The Peer owns the engineering judgement inside its task.

When a Supervisor messages a Peer directly, the desk tells that Peer's Lead first.

| Role | What it does | Desk tools | Default agent |
|---|---|---|---|
| Supervisor | Works with you, opens and closes lanes, answers Leads | `open_lane` `close_lane` `message` `answer` `set_project` `status` | Claude Code · `claude-opus-5` · high |
| Lead | Owns one lane: splits it into tasks, starts Peers and Reviewers, accepts and integrates | `start_task` `start_review` `accept` `rework` `cut` `message` `answer` `ask` `report` `status` | Claude Code · `claude-opus-5` · medium |
| Peer | Does one task and hands it back | `done` `ask` | Devin CLI · `swe-2-max` |
| Reviewer | A read-only Peer that reviews a change with clean context | `done` `ask` | Devin CLI · `swe-2-max` |
| Watcher | Reads how turns end and raises what needs attention; it cannot touch the work | `raise` | Devin CLI · `swe-2-medium` |

The roles are data, not code. How the preset can be replaced is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#settings).

## Agents

Every role can sit on every agent: Claude Code, Codex, Pi and Devin CLI. You pick the agent, model
and thinking level for each role in the panel.

| Agent | Before its first seat | Mail during a running turn |
|---|---|---|
| Claude Code | `claude` signed in | yes |
| Codex | `codex login`, once for all Codex seats | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once. A Pi seat reaches the desk only through this adapter | yes |
| Devin CLI | `devin` signed in | no, mail waits for the turn to end |

Claude seats read your project's `CLAUDE.md`. Codex, Pi and Devin seats read its `AGENTS.md`. If the
repository has only `AGENTS.md`, add a `CLAUDE.md` that contains the line `@AGENTS.md`.

What each agent's seat is allowed to do, and where each falls short, is covered under
[What each seat gets](docs/ARCHITECTURE.md#what-each-seat-gets) and
[Known limits](docs/ARCHITECTURE.md#known-limits).

## Install

You need Paseo `>=0.8.0 <0.9.0`, Node.js, `git` and `jq`. You also need the CLI of each agent you
use. `gh` is optional; the desk uses it to open a lane from a GitHub issue.

Clone this repository, then from its root:

```bash
cd plugin
npm install
paseo plugin install "$PWD"
```

On start, and after each save of the machine defaults, the plugin writes one Paseo provider and
agent profile per role and agent, for example `sw2-lead-claude`. It reloads the daemon only when one of
them changed.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. Choose **Add project**, pick the repository, choose an agent and model for each role, and attach.
3. Open **Health** and choose **Run**. It checks `git`, `jq` and the settings. For each agent a role
   is on, it checks that agent's CLI, plus the login for Codex and the login and adapter for Pi. It
   also checks every MCP server that is switched on for some role.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, or the
   Supervisor on whichever agent you chose. Tell it what you want.

The desk seats everyone else as the work needs them. The Supervisor opens lanes, and each lane gets a
Lead. Leads start Peers and Reviewers, and the Watcher is seated for the project.

The panel's other tabs are **Team** (the agent, model and thinking level for each role), **Flow**
(lanes, tasks and open questions, live) and **MCP** (optional servers such as a JetBrains IDE index,
code search and Context7, switched on per role).

## Development

```bash
cd plugin
npm run check
```

That type-checks the server and the client, then runs the tests with Node's own test runner. There is
no build step. Don't launch seats to test a change: they are real agents with broad permissions, and
they cost money.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the plugin works inside
- [AGENTS.md](AGENTS.md): the rules this code follows

## License

MIT, see [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) lists where the shipped skills come from.
