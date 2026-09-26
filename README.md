# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way. A
**Supervisor** works with you, a **Lead** owns each line of work, and **Peers** each do one task. A
**Reviewer** reads the work with clean context.

> **Pre-release.** Nothing has shipped: no releases, no compatibility promises.

## This fork

This branch of Paseo Crew is Seatworks `v3` taken whole at
[`8216651`](https://github.com/sting9k/seatworks/commit/8216651), keeping its names (plugin id
`seatworks-v2`, state `~/.local/share/seatworks-v3`, `SEATWORKS_*`, prefix `sw2-`), with these
changes on top. It is not affiliated with or endorsed by the Seatworks author; the
[MIT license](LICENSE) is unchanged.

- Every role defaults to Claude Opus 5.5; a **Backup Peer** runs a Peer's task on Codex
  `gpt-5.6-luna` when the Peer's agent is out of quota, and a **Senior Reviewer** reads complex or
  high-stakes design on Codex `gpt-6-astra`. The Lead never cuts a Peer stopped on a usage limit.
- The Watcher's judge is off by default.
- `project.json` takes `links` (git-ignored files symlinked into a lane's copy) and `writable`
  (extra paths a seat may write); roles that commit may also write the repository's git directory.
- Codex seats turn off the owner's own `~/.agents/skills`.
- Tool values a harness sends as text are read as the type the tool asks for, and a running seat
  is told when its team tools change.

![SLP: who decides what](docs/images/slp-graph.svg)

## What it does, and what it doesn't

The plugin **runs** the team, but never decides whether the work is right. That is always a seat's
call, or yours.

| It does | It enforces | It never does |
|---|---|---|
| Configures and starts one agent per seat | Lanes may not overlap in what they write | Judge the work |
| Keeps a shared desk of lanes, tasks and questions | One writer per working copy | Pass on to a seat what the watch concluded about it |
| Carries messages, each ending with what it asks of its reader, and holds them until a seat can take them | A red gate (your test command) stops a lane from landing, unless the Supervisor lands over it with a reason | Write your project's concept for you |
| Keeps a durable record outside your repo | A landing that touches a path you asked about first waits for you | Write into your project's files |
| Watches Leads and Peers, tells whoever answers for them, and pages you for what cannot be undone | Each role's permissions, where the agent allows it, and git commands only the desk runs | |

## How a piece of work goes

1. **You talk to the Supervisor.** Before new work starts, it asks you questions in numbered rounds,
   with its recommended answer to each. What you settle about how the project behaves goes into the
   project's `CONTEXT.md`, outside your repo, and what you settle for every lane (which paths you want
   to see before they land, where lanes work) becomes a standing order.
2. **The Supervisor opens a lane** with an outcome and acceptance criteria. The desk seats a Lead for
   it.
3. **The Lead splits the lane into tasks.** It starts a Peer on each task, has a Reviewer read each
   big task and then the whole lane, and accepts or sends the work back.
4. **The Lead reports the lane ready.** The desk runs the gate first.
5. **The Supervisor lands the lane.** The desk merges in your base branch if it moved, runs the gate
   on the result, then lands it on your base as one commit (or as your repository lands work). A lane
   that touches a path you asked about waits for you on the **Flow** tab.

While you are away, a decision only you can make waits in your queue on the **Flow** tab, with the
Supervisor's recommendation and what goes ahead meanwhile; the **Report** tab tells your last day.

The step-by-step picture is in [A lane, end to end](docs/ARCHITECTURE.md#a-lane).

## The team

| Role | Owns | Default agent |
|---|---|---|
| Supervisor | Your intent, across lanes: opens and closes them, answers Leads | Claude Code · `claude-opus-5` · high |
| Lead | One lane: its tasks, their order, and what is accepted | Claude Code · `claude-opus-5` · medium |
| Peer | One task, and the engineering judgement inside it | Claude Code · `claude-opus-5` · medium |
| Reviewer | A read-only review of one change | Claude Code · `claude-opus-5` · medium |
| Watcher | When the watch is answered by a seat: the watch's questions about one moment of the work at a time | The Peer's, until you set its own |
| Pager | Says a page back, word for word, so Paseo pushes it to your phone | Claude Code · `claude-opus-5` · low |

Roles are data in `plugin/roles.json`, not code. Each role's tools are in
[the reference](docs/REFERENCE.md#desk-verbs).

## Supported agents

Any role can sit on any of these five agents. You pick one per role in the panel, plus its model and
thinking level where the agent offers them.

| Agent | Before its first seat | Sandbox | Mail into a running turn |
|---|---|---|---|
| Claude Code | `claude` signed in | yes | yes |
| Codex | `codex login` once. The `codex` CLI must be on the machine that runs the daemon | yes | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once. That adapter is how a Pi seat reaches the desk | no | yes |
| Oh My Pi | `omp` signed in once, outside any seat (`/login`) | no | no, it waits for the turn to end |
| OpenCode | `opencode auth login` once, outside any seat | no | yes |

Every seat reads your project's own instructions: Claude reads `CLAUDE.md`, or `AGENTS.md` when
the project has no `CLAUDE.md`, and the others read `AGENTS.md`. Claude Code, Codex, Oh My Pi and OpenCode seats are denied `git push`, `gh`, `paseo`
and starting other agents. A Pi seat is held only by the tools it is given. The shipped Claude settings answer in
Vietnamese: change `language` in `plugin/harness/claude/settings.json` for another language. The details are under
[seat directories](docs/REFERENCE.md#seat-directories) and
[known limits](docs/REFERENCE.md#known-limits).

## Install

You need:

- Paseo `>=0.9.1 <0.10.0`
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

**Keeping it current.** The **Plugin** tab shows the version that runs and, once checked, the one
the clone's branch has. **Update** moves forward only, runs `npm install` when the packages changed,
and reloads the plugin. It waits until no seat runs in any project, because every project moves to
the new version at once. Below the version, one row for each thing that needs you:

- A changed **prompt** or **skill**: **Use new**, or **Keep mine** to go on with the
  version you had. Yours is copied to `~/.local/share/seatworks-v3/own/` for you to edit by hand, and
  you are still told when the original changes.
- Changed **guides** and **records**: named only, for you to read in git.
- Settings this version cannot read, and seats still on an older version.

**Clean up** lists seat folders, working copies and copies nobody uses any more, and removes only
what you pick.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. **Add project**, pick the repository, choose an agent for each role, and attach.
3. Open **Health** and choose **Run**.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, and tell it
   what you want.

The desk seats everyone else as the work needs them. The first lane works in your checkout, and each
later one in a working copy of its own.

**Your project's `AGENTS.md` stays yours.** The plugin writes nothing into your project's files: the
team's shared rules are in each role's own prompt.

A project's panel has **Team** (agents and the watch), **Flow** (lanes, tasks, your questions and
landings, live), **Report** (the last day), **Orders** (your standing orders and the concept), **MCP**
(optional servers per role) and **Health**, and the **Plugin** tab keeps the plugin current.
Everything the desk keeps lives under `~/.local/share/seatworks-v3/`.

## The watch

The desk reads the turns of Leads and Peers in code, catching things like a destructive command, the
same failure again and again, or a weakened test. It also reads each lane's record, for example a
task sent back three times.

A finding becomes an **incident**. An ordinary one about a Peer goes to its Lead. One about a Lead,
an urgent one (a *page*), or one whose Lead is gone goes to the Supervisor. Whoever gets it marks it
`useful`, `noise` or `unknown`. The watched seat never hears of it. Each lane gets two ordinary ones a
day; a kind whose last ten marks were mostly noise is held back, and goes if seen again once the marks
turn; a page goes unless nobody is there to tell.

What code cannot read, the watch asks as one question at a time, at the moment it matters: was this
destructive command asked for, does a complete hand-back's summary admit a gap, did a review that
accepts a migration say it ran the invariant. You pick who answers on the Watcher's chip in **Team**:
Jev (a small model asked over OpenRouter, with your key, kept on this machine and never shown
again), the **Watcher** seat, or nobody. Every question ships in shadow: its answers are kept in the
project's `assessments.log` for you to label, and no seat is sent them. **Flow** says who is
answering and how that stands.

Out of the box the watch records and lists ordinary incidents without mailing them, while a page
still goes to the Supervisor and to your phone. To mail the rest, turn on **Mail incidents** on the
Supervisor's chip in the **Team** tab. How it all works is in
[the architecture](docs/ARCHITECTURE.md#the-watch).

## Known Paseo behaviour

- **Opening an archived seat's history starts its agent again, and leaves it running.** Paseo
  resumes an archived agent to show its history, from the app or `paseo logs`, and never closes it.
  A Pi seat leaves a `pi` process, an Oh My Pi seat an `omp` one, an OpenCode seat an
  `opencode serve`. The plugin never reads an archived seat itself. To be rid of them:
  `pkill -f "pi --mode rpc"`, `pkill -f "omp --mode rpc-ui"` or `pkill -f "opencode serve"`, with no
  seat of yours running.
- **An agent gets only the provider keys Paseo's daemon has.** A key set in your shell, such as
  `NVIDIA_API_KEY` for Pi, does not reach the daemon, so those models are neither listed nor usable.
  Put the key where the agent keeps its own (`~/.pi/agent/auth.json` for Pi).
- **Paseo keeps a project for a folder you have deleted.** List them with `paseo project ls` and
  remove one with `paseo project delete <id>`.

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
