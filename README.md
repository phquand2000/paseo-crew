# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way. A
**Supervisor** works with you, a **Lead** owns each line of work, and **Peers** each do one task. A
**Reviewer** reads the work with clean context, and a **Watcher** reads how it is being done.

> **Pre-release.** Nothing has shipped: no releases, no compatibility promises, no migrations.

![SLP: who decides what](docs/images/slp-graph.svg)

## What it does, and what it doesn't

The plugin **runs** the team, but never decides whether the work is right. That is always a seat's
call, or yours.

| It does | It enforces | It never does |
|---|---|---|
| Configures and starts one agent per seat | Lanes may not overlap in what they write | Judge the work |
| Keeps a shared desk of lanes, tasks and questions | One writer per working copy | Pass on to a seat what the watch concluded about it |
| Carries messages, and holds them until a seat can take them | A red gate (your test command) stops a lane from landing | Write your project's concept for you |
| Keeps a durable record outside your repo | Each role's permissions, where the agent allows it | |
| Watches Leads and Peers, and tells whoever answers for them | | |

## How a piece of work goes

1. **You talk to the Supervisor.** Before new work starts, it asks you questions in numbered rounds,
   with its recommended answer to each. What you settle about how the project behaves goes into the
   project's `CONTEXT.md`, outside your repo.
2. **The Supervisor opens a lane** with an outcome and acceptance criteria. The desk seats a Lead for
   it.
3. **The Lead splits the lane into tasks.** It starts a Peer on each task and a Reviewer on each
   change, then accepts or sends the work back.
4. **The Lead reports the lane ready.** The desk runs the gate first.
5. **The Supervisor closes the lane.** The desk merges in your base branch if it moved, runs the
   gate on the result, then fast-forwards the base.

The step-by-step picture is in [A lane, end to end](docs/ARCHITECTURE.md#a-lane).

## The team

| Role | Owns | Default agent |
|---|---|---|
| Supervisor | Your intent, across lanes: opens and closes them, answers Leads | Claude Code · `claude-opus-5` · high |
| Lead | One lane: its tasks, their order, and what is accepted | Claude Code · `claude-opus-5` · medium |
| Peer | One task, and the engineering judgement inside it | Devin CLI · `swe-2-max` |
| Reviewer | A read-only review of one change | Devin CLI · `swe-2-max` |
| Watcher | Reading Leads and Peers as they work. It cannot touch the work | the Peer's agent |

Roles are data in `plugin/roles.json`, not code. Each role's tools are in
[the reference](docs/REFERENCE.md#desk-verbs).

## Supported agents

Any role can sit on any of these four agents. You pick one per role in the panel, plus its model and
thinking level where the agent offers them.

| Agent | Before its first seat | Sandbox | Mail into a running turn |
|---|---|---|---|
| Claude Code | `claude` signed in | yes | yes |
| Codex | `codex login` once. The `codex` CLI must be on the machine that runs the daemon | yes | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once. That adapter is how a Pi seat reaches the desk | no | yes |
| Devin CLI | `devin` signed in | no | no, it waits for the turn to end |

Every seat reads your project's own instructions: Claude reads `CLAUDE.md`, and the others read
`AGENTS.md`. Claude Code, Codex and Devin seats are denied `git push`, `gh`, `paseo` and starting
other agents. A Pi seat is held only by the tools it is given. The shipped Claude settings answer in
Vietnamese: change `language` in `plugin/harness/claude/settings.json` for another language. The details are under
[seat directories](docs/REFERENCE.md#seat-directories) and
[known limits](docs/REFERENCE.md#known-limits).

## Install

You need:

- Paseo `>=0.8.0 <0.9.0`
- Node.js 24 or newer. There is no build step.
- `git` and `jq`
- the CLI of each agent you use, signed in
- optionally `gh`, to open a lane from an issue, and `uv`, for code search

```bash
cd plugin
npm install
paseo plugin install "$PWD"
```

Paseo remembers where the clone is. If you move it, install it again.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. **Add project**, pick the repository, choose an agent for each role, and attach.
3. Open **Health** and choose **Run**.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, and tell it
   what you want.

The desk seats everyone else as the work needs them. The first lane works in your checkout, and each
later one in a working copy of its own.

**Your project's `AGENTS.md`.** The first time a seat opens, the plugin writes the team's shared
rules into your `AGENTS.md`, in a marked `seatworks` block. It replaces that block whole and never
touches your own text. `CLAUDE.md` gets a pointer to `AGENTS.md`. Commit both once, because a lane in
its own working copy sees only what is committed.

The panel has four tabs: **Team** (agents and the watch), **Flow** (lanes, tasks and questions,
live), **MCP** (optional servers per role) and **Health**. Everything the desk keeps lives under
`~/.local/share/seatworks-v2/`.

## The watch

The desk reads the turns of Leads and Peers in code, catching things like a destructive command, the
same failure again and again, or a weakened test. It also reads each lane's record, for example a
task sent back three times. A second reader looks beside the code:

- **A Watcher seat**, the default. It needs no key.
- **Jev**, a model called through OpenRouter. It needs a key, and each reading costs money.

A finding becomes an **incident**. An ordinary one about a Peer goes to its Lead. One about a Lead,
an urgent one (a *page*), or one whose Lead is gone goes to the Supervisor. Whoever gets it marks it
`useful`, `noise` or `unknown`. The watched seat never hears of it.

Out of the box the watch only records and lists. To mail incidents, turn on **Mail incidents** on the
Watcher's chip in the **Team** tab. How it all works is in
[the architecture](docs/ARCHITECTURE.md#the-watch).

## Development

```bash
cd plugin
npm run check
```

This type-checks the code and runs the tests. Don't launch seats to test a change: they are real
agents, with real permissions, and they cost money. The evals that call real models are listed in
[the reference](docs/REFERENCE.md#evals).

## Docs

| Read | When you want |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works inside, in one sitting |
| [REFERENCE.md](docs/REFERENCE.md) | To look something up: verbs, letters, facts, settings, files |
| [ANTIPATTERNS.md](docs/ANTIPATTERNS.md) | How a team of agents goes wrong, and which of those the watch can see |
| [AGENTS.md](AGENTS.md) | The rules this code follows |

## License

MIT, see [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) lists where the shipped skills come from.
