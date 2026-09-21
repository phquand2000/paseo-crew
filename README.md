# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way. A
**Supervisor** works with you, **Leads** each own a line of work, and **Peers** each do one task. A
**Reviewer** reads what they wrote with clean context.

![Seatworks inside Paseo](docs/images/overview.svg)

> **Status: pre-release.** Nothing here has shipped. There are no releases and no compatibility
> promises, and breaking changes land without a migration path.

## What it does

Seatworks never decides whether the work is right. It:

- **configures and starts** the agents Paseo runs, one seat per role
- **keeps a shared desk** of lanes, tasks and questions that every seat works through
- **carries the messages** between seats, and holds them until a seat can take them
- **keeps a durable record** of what happened, outside your repository
- **watches Leads and Peers** as they work, and tells the Supervisor what it saw

What it does enforce is mechanical:

- **The desk's rules.**
  - Lanes that declare write sets may not overlap.
  - No two lanes may reach a path the project keeps to one writer.
  - A working copy has one writer at a time.
  - A red gate stops a lane from landing unless the Supervisor overrides it. A gate is the project's
    own proof command, `npm test` or whatever proves it works. The first lane detects one, and
    `set_project` changes it.
- **Each role's permissions**, on the agents that can enforce them.
  - A Claude Code, Codex or Devin seat is denied `git push`, `gh`, `paseo` and the commands that
    start other agents.
  - The Reviewer gets no editing tools.
  - Pi ships no command rules, so a Pi seat is held only by the tools it is given.
  - Where the matching falls short is in [Known limits](docs/ARCHITECTURE.md#known-limits).

## The team

![SLP: who decides what](docs/images/slp-graph.svg)

SLP is a graph, not a chain of command. Each party has its own kind of authority:

- **The Human** owns intent.
- **The Supervisor** reads that intent and may intervene across lanes.
- **The Lead** owns sequencing and acceptance inside its lane.
- **The Peer** owns the engineering judgement inside its task.

When a Supervisor messages a Peer directly, the desk tells that Peer's Lead first.

| Role | What it does | Desk tools | Default agent |
|---|---|---|---|
| Supervisor | Works with you, opens and closes lanes, and answers Leads, or their Peers when a Lead is gone. Marks what the watch raises | `open_lane` `close_lane` `message` `answer` `set_project` `status` `incidents` `ack` | Claude Code · `claude-opus-5` · high |
| Lead | Owns one lane: splits it into tasks, starts Peers and Reviewers, accepts and integrates | `start_task` `start_review` `accept` `rework` `cut` `message` `answer` `ask` `report` `status` | Claude Code · `claude-opus-5` · medium |
| Peer | Does one task and hands it back with `done` | `done` `ask` | Devin CLI · `swe-2-max` |
| Reviewer | A read-only Peer that reviews a change with clean context | `done` `ask` | Devin CLI · `swe-2-max` |
| Watcher | Reads Leads and Peers as they work, when the watch is by a Watcher seat, and reports what it sees. It cannot touch the work | `raise` `judge` | the Peer's agent and model, until it is given its own |

The roles are data, not code. Five roles on four agents give the twenty providers this plugin
writes. A role can `follow` another: until a layer gives it its own, it takes that role's agent, model
and thinking in force. `open_lane`, `start_task` and `start_review` take a `role`, so a kit with two review lenses or
two kinds of Peer needs no code change. How to replace the preset is under
[Settings](docs/ARCHITECTURE.md#settings).

## Agents

A seat is one agent process. The plugin writes its configuration, and Paseo runs it. Every role can
sit on any of the four agents. You pick the agent for each role in the panel, and its model and
thinking level where the agent offers them. Claude Code ships one model here, and Devin has no
thinking levels.

| Agent | Before its first seat | Mail during a running turn |
|---|---|---|
| Claude Code | `claude` signed in | yes |
| Codex | `codex login`, once for all Codex seats. The `codex` CLI must be on the machine running the daemon, because building a seat asks it for its model list | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once. A Pi seat reaches the desk only through this adapter | yes |
| Devin CLI | `devin` signed in | no, mail waits for the turn to end |

Health checks the Codex and Pi logins. For Claude Code and Devin it checks only that the CLI is on
`PATH`, so a signed-out seat fails when it launches rather than in the report.

Every seat reads your project's own instructions:

- A Claude seat reads `CLAUDE.md`. The plugin passes it the working directory to make that happen.
- Codex, Pi and Devin seats read `AGENTS.md` from the working directory.
- If the repository has only `AGENTS.md`, add a `CLAUDE.md` with the line `@AGENTS.md`.

The shipped Claude settings answer in Vietnamese (`"language": "vietnamese"` in
`plugin/harness/claude/settings.json`). Change that file for another language.

What each agent's seat may do is covered in
[What each seat gets](docs/ARCHITECTURE.md#what-each-seat-gets).

## The watch

![What the watch sees](docs/images/watch.svg)

While the Leads and Peers work, the desk follows them. It reads two kinds of evidence:

- **Their turns, in code.** It looks for a destructive command, the same failure attacked over and
  over, a test that lost its assertions, and a hand-back that never ran the gate.
- **Each lane's record.** It looks for the shapes no single turn can show: a task sent back again and
  again, a lane patching several tasks at once, reviews piling up with nothing accepted, a review told
  to report only what it is sure of, and a brief that writes the work out instead of setting an
  outcome.

Beside the code, one of two readers takes a second look, chosen by `attention.by` (below):

- **A Watcher seat**, the default. One Watcher sits in the project while a lane is open. The desk
  mails it what each Lead and Peer did, said and thought, as they work: only the steps it has not
  been shown, in batches, and never into the middle of its own turn. A fresh Watcher replaces it
  after a set number of readings. It reports with `raise`, naming a kind from
  `catalog/watcher/watcher.json` and the ref of the step that shows it, and the incident quotes that
  step, never the Watcher's words. It judges the facts the code raises there with `judge`, and a
  vetoed one is held back.
- **Jev**, a model outside the seat. The turn is split into four views, and each view shows Jev only
  what its questions need. When Jev finds something, it is asked which step it meant, and the
  incident quotes that step.

Each finding becomes an **incident**:

- A fact the code read raises one on its own.
- The Watcher or Jev can raise one of its own, back one the code raised, or hold that one back when
  it disagrees.

The Supervisor lists incidents with `incidents`, checks the agent's own record, and marks each one
with `ack`:

- `useful` and `noise` are what the thresholds are tuned from.
- `unknown` only closes the incident.

Nothing the watch concludes ever reaches the seat it watched.

**`attention.by` says what reads the seats.**

- **`seat`, the default.** The watch always runs, with no key: seats are followed and their turns
  and lanes are read in code. Jev is never asked, even when a key is set.
- **`jev`.** Jev reads beside the code, and the OpenRouter key is the switch. With a key the watch
  runs. Without one it does not run at all: no seat is followed, and no turn or lane record is read.
- The key is on the panel's **Team** tab, under **Watch**, on **Machine defaults**. It is kept on the
  machine and used for every project. The panel only says a key is set and never reads it back, and
  saving anything else leaves the key alone.
- Change `by`, or take the key away, and the next patrol round follows suit, with no reload.

**Mailing is a second, separate switch.** Out of the box a running watch is quiet: incidents are
recorded and listed, but none is mailed. Turn on *Mail incidents to the Supervisor* on Machine
defaults or on one project.

You can also write both switches by hand. The next patrol round picks up the file with no reload:

```json
{ "attention": { "watch": true, "by": "jev" }, "sensor": { "key": "sk-or-…" } }
```

**By Jev, a key starts paid calls.** Jev reads a watched seat:

- five seconds after the seat goes quiet
- at least every thirty seconds while it works
- at once when a turn ends, a call or the gate fails, something irreversible is seen, or a permission
  is asked

Each reading costs one request for each view that has something to show, so up to four, plus one
more for each finding it pinpoints. Running with the key and the mail switch off is how you collect a
record to calibrate against before letting the watch speak.

The project's **Flow** tab shows what the watch is doing:

- the seats it follows, grouped by lane, with what each has cost and the highest signal read on it
- the incidents that need the Supervisor or were marked useful, with the rest one tap away
- any tool call that never reached the desk
- a sensor that stopped answering, which is also written to the project's `events.log` as
  `sensor.degraded`

Once there is a record, `cd plugin && node bin/calibrate.ts <project>` reports how well each of
Jev's questions separated what you marked useful from what you marked noise. The whole design is in
[Watching Leads and Peers](docs/ARCHITECTURE.md#watching-leads-and-peers).

## Install

You need:

- Paseo `>=0.8.0 <0.9.0`
- Node.js 24 or newer. The plugin is TypeScript that node runs directly, with no build step.
- `git` and `jq`
- the CLI of each agent you use
- optionally `gh`, which the desk uses to open a lane from a GitHub issue
- optionally `uv`, only for the code-search MCP server

Clone this repository, then from its root:

```bash
cd plugin
npm install
paseo plugin install "$PWD"
```

That installs the plugin by directory. Paseo records where the clone is, so if you move it, install
it again from the new path.

On start, and after each save of the machine defaults, the plugin writes one Paseo provider and one
agent profile per role and agent. The shipped kit makes twenty of each, for example `sw2-lead-claude`.
It removes its own entries the kit no longer produces, keeps env keys you added, and reloads the
daemon only when something changed.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. Choose **Add project**, pick the repository, choose an agent for each role, read the summary under
   **Check**, and attach. A project can be any directory. For a git repository, the project is its
   root.
3. Open **Health** and choose **Run**. It checks `git`, `jq` and the settings, the CLI of each agent a
   role is on, the Codex and Pi logins, and every MCP server some role uses. It does not check the
   watch or the key.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, or the
   Supervisor on whichever agent you chose. Tell it what you want.

The desk seats everyone else as the work needs them. The Supervisor can open any number of lanes at
once, and each lane gets a Lead. The first lane works in your own checkout, and each later one in a
working copy of its own. Leads start Peers and Reviewers.

The panel has four tabs, and Machine defaults opens the same four:

| Tab | What it holds |
|---|---|
| **Team** | The agent for each role, its model and thinking level where the agent offers them, and the watch |
| **Flow** | Lanes, tasks, open questions and what the watch is doing, live |
| **MCP** | Optional servers such as a JetBrains IDE index, code search and Context7, switched on per role |
| **Health** | The machine's checks and, on a project, the status of its lanes |

Everything the desk keeps lives outside your repository, under `~/.local/share/seatworks-v2/`. That
covers the settings, the ledger, the letters still waiting, and one folder per project.

## Development

```bash
cd plugin
npm run check
```

That type-checks the server and the client, then runs the tests with Node's own test runner. Don't
launch seats to test a change: they are real agents with broad permissions, and they cost money.

Three more commands call real models, so none of them is part of `npm run check`:

| Command | What it does |
|---|---|
| `npm run eval:triggers -- --agent "claude -p"` | Asks a real agent whether each shipped skill opens on the briefs it should |
| `npm run eval:sensor` | Puts thirty-six turns to Jev and fails when a question reads one the wrong way |
| `node bin/calibrate.ts <project>` | Reports on the watch's questions from a real project's kept readings. Reading them is free; only `--ask` calls Jev |

Further reading:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the plugin works inside
- [docs/ANTIPATTERNS.md](docs/ANTIPATTERNS.md): the ways a team of agents goes wrong, what gives each
  one away, and which of them this plugin can see
- [AGENTS.md](AGENTS.md): the rules this code follows

## License

MIT, see [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) lists where the shipped skills come from.
