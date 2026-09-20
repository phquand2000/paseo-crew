# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way: a
**Supervisor** who works with you, **Leads** who each own a line of work, and **Peers** who each do
one task. A **Reviewer** completes the team.

Seatworks never decides whether the work is right. It configures and starts the agents Paseo runs,
gives them a shared desk of lanes, tasks and questions, carries their messages, and keeps a durable
record of what happened. What it does enforce is mechanical:

- The desk's rules. Lanes that declare write sets may not overlap, no two lanes may reach the paths
  the project keeps to one writer, a working copy has one writer at a time, and a red gate stops a
  lane from landing unless the Supervisor overrides it. A gate is the project's own proof command,
  `npm test` or whatever proves it works, set once with `set_project`.
- Each role's permissions, on the agents that can enforce them. A Claude Code, Codex or Devin seat is
  denied `git push`, `gh`, `paseo` and the commands that start other agents, and the Reviewer gets no
  editing tools. Where that matching falls short is in
  [Known limits](docs/ARCHITECTURE.md#known-limits). Pi ships no command rules, so a Pi seat is held
  only by the tools it is given.

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

When a Supervisor messages a Peer directly, the desk tells that Peer's Lead.

| Role | What it does | Desk tools | Default agent |
|---|---|---|---|
| Supervisor | Works with you, opens and closes lanes, answers Leads — and their Peers when a Lead is gone — and marks what the desk notices | `open_lane` `close_lane` `message` `answer` `set_project` `status` `incidents` `ack` | Claude Code · `claude-opus-5` · high |
| Lead | Owns one lane: splits it into tasks, starts Peers and Reviewers, accepts and integrates | `start_task` `start_review` `accept` `rework` `cut` `message` `answer` `ask` `report` `status` | Claude Code · `claude-opus-5` · medium |
| Peer | Does one task and hands it back with `done` | `done` `ask` | Devin CLI · `swe-2-max` |
| Reviewer | A read-only Peer that reviews a change with clean context | `done` `ask` | Devin CLI · `swe-2-max` |

The roles are data, not code: four roles on four agents make the sixteen providers this plugin
writes. `open_lane`, `start_task` and `start_review` take a `role`, so a kit with two review lenses
or two kinds of Peer needs no code change. How the preset can be replaced is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#settings).

## Agents

A seat is one agent process: the plugin writes its configuration, and Paseo runs it. Every role can
sit on every agent: Claude Code, Codex, Pi and Devin CLI. You pick the agent for each role in the
panel, and its model and thinking level where that agent offers them — Claude Code ships
one model here, and Devin has no thinking levels.

| Agent | Before its first seat | Mail during a running turn |
|---|---|---|
| Claude Code | `claude` signed in | yes |
| Codex | `codex login`, once for all Codex seats. Building a Codex seat asks `codex` for its model list, so the CLI must be on the machine running the daemon | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once. A Pi seat reaches the desk only through this adapter | yes |
| Devin CLI | `devin` signed in | no, mail waits for the turn to end |

Health checks the Codex and Pi logins. For Claude Code and Devin it checks only that the CLI is on
PATH, so a signed-out seat fails when it launches rather than in the report.

Claude seats read your project's `CLAUDE.md`, which the plugin arranges by passing the working
directory to the seat. Codex, Pi and Devin seats read its `AGENTS.md` from the working directory as
they normally do. If the repository has only `AGENTS.md`, add a `CLAUDE.md` that contains the line
`@AGENTS.md`.

The shipped Claude settings answer in Vietnamese (`"language": "vietnamese"` in
`plugin/harness/claude/settings.json`). Change that file if you want another language.

What each agent's seat is allowed to do, and where each falls short, is covered under
[What each seat gets](docs/ARCHITECTURE.md#what-each-seat-gets) and
[Known limits](docs/ARCHITECTURE.md#known-limits).

## The watch

The desk also follows the Leads and Peers while they work, through their timelines. It reads their
turns in code — a destructive command, the same failure attacked over and over, a test that lost its
assertions, a hand-back that never ran the gate. With an OpenRouter key it can also put the same
steps to a sensor for a second opinion.

Each of those becomes an **incident**. A fact the code read raises one on its own; the sensor can
raise one of its own, back one the code raised, or hold that one back when it disagrees. The
Supervisor lists them with `incidents`, looks at the agent's own record, and marks each `useful`,
`noise` or `unknown` with `ack`. `useful` and `noise` are what the thresholds are tuned from;
`unknown` only closes the incident. Nothing the watch concludes ever reaches the seat it watched.

Out of the box the watch is quiet: incidents are recorded and listed, and none is mailed. Both
controls are on the panel's **Team** tab, under **Watch**. *Tell the Supervisor* is the switch, on
Machine defaults or one project. The key is kept on the machine and used for every project, so it is
on Machine defaults only; the panel never reads a saved key back, it only says one is set, and
saving anything else leaves it alone. Either can be hand-written instead — the next patrol round
picks up the file with no reload:

```json
{ "attention": { "watch": true }, "sensor": { "key": "sk-or-…" } }
```

A key alone starts paid calls: one per watched seat five seconds after it goes quiet, at least one
every thirty seconds while it works, and one at once when a turn ends, a call or the gate fails,
something irreversible is seen, or a permission is asked — which is how you collect a record to
calibrate against before letting the watch speak. Whether the sensor is answering shows up only in that project's
`events.log`, as `sensor.off` or `sensor.degraded`. Once there is a record,
`cd plugin && node bin/calibrate.ts <project>` reports how well each of the sensor's questions
separated what you marked useful from what you marked noise.

The whole of it is in [Watching Leads and Peers](docs/ARCHITECTURE.md#watching-leads-and-peers).

## Install

You need Paseo `>=0.8.0 <0.9.0`, Node.js 24 or newer (the plugin is TypeScript that node runs
directly; there is no build step), `git` and `jq`. You also need the CLI of each agent you use. `gh`
is optional; the desk uses it to open a lane from a GitHub issue. `uv` is optional too, and only for
the code-search MCP server.

Clone this repository, then from its root:

```bash
cd plugin
npm install
paseo plugin install "$PWD"
```

That installs the plugin by directory: Paseo records where the clone is, so if you move it, install
it again from its new path.

On start, and after each save of the machine defaults, the plugin writes one Paseo provider and
agent profile per role and agent — sixteen of each in the shipped kit, for example `sw2-lead-claude`.
It removes its own entries the kit no longer produces, keeps env keys you added, and reloads the
daemon only when something changed.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. Choose **Add project**, pick the repository, choose an agent for each role, read the summary under
   **Check**, and attach. A project can be any directory; with a git repository the project is its
   root.
3. Open **Health** and choose **Run**. It checks `git`, `jq` and the settings. For each agent a role
   is on, it checks that agent's CLI, plus the logins Codex and Pi declare. It also checks every MCP
   server some role actually uses. It does not check the watch or the sensor.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, or the
   Supervisor on whichever agent you chose. Tell it what you want.

The desk seats everyone else as the work needs them. The Supervisor opens lanes — any number at once:
the first works in your own checkout, each later one in a working copy of its own — and each lane
gets a Lead. Leads start Peers and Reviewers.

Everything the desk keeps lives outside your repository, under `~/.local/share/seatworks-v2/`: the
settings, the ledger, the letters still waiting, and one folder per project.

The panel's other tabs are **Team** (the agent for each role, its model and thinking level where the
agent offers them, and the watch), **Flow** (lanes, tasks and open questions, live) and **MCP**
(optional servers such as a JetBrains IDE index, code search and Context7, switched on per role).
Machine defaults open the same four tabs.

## Development

```bash
cd plugin
npm run check
```

That type-checks the server and the client, then runs the tests with Node's own test runner. There is
no build step. Don't launch seats to test a change: they are real agents with broad permissions, and
they cost money.

Two more, neither part of `npm run check` because both call real models:
`npm run eval:triggers -- --agent "claude -p"` asks a real agent whether each shipped skill opens on
the briefs it should, and `node bin/calibrate.ts <project>` reports on the watch's questions from a
real project's kept assessments — reading them costs nothing, and only `--ask` calls the sensor.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the plugin works inside
- [AGENTS.md](AGENTS.md): the rules this code follows

## License

MIT, see [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) lists where the shipped skills come from.
