# Seatworks

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents on your project the **SLP** way.
You tell a **Supervisor** what you want. It splits the work into lanes; a **Lead** owns each lane and
splits it into tasks; each task gets a **Peer** of its own. The plugin carries the work, the mail and
the evidence between them, and brings you in for what only you can decide.

> **Pre-release.** Nothing has shipped: no releases, no compatibility promises.

## This fork

This branch of Paseo Crew is Seatworks `v3` taken whole at
[`4c35563`](https://github.com/sting9k/seatworks/commit/4c35563), keeping its names (plugin id
`seatworks-v2`, state `~/.local/share/seatworks-v3`, `SEATWORKS_*`, prefix `sw2-`), with these
changes on top. It is not affiliated with or endorsed by the Seatworks author; the
[MIT license](LICENSE) is unchanged.

- Every role defaults to Claude Opus 5.5; a **Backup Peer** runs a Peer's task on Codex
  `gpt-5.6-luna` when the Peer's agent is out of quota, and a **Senior Reviewer** reads complex or
  high-stakes design on Codex `gpt-6-astra`. The Lead never cuts a Peer stopped on a usage limit.
- The Watcher's judge is off by default.
- `project.json` takes `links` (git-ignored files symlinked into a lane's copy) and `writable`
  (extra paths a seat may write), and `writableOutside` (absolute paths outside the project a Peer
  may write); roles that commit may also write the repository's git directory.
- Codex seats turn off the owner's own `~/.agents/skills`.
- Claude seats run on the owner's one Claude Code login, never a login of their own.
- Branches the desk starts track nothing, so a first push cannot land on the base's upstream.
- The Paseo home is `PASEO_HOME` when set, else `~/.paseo`.
- Tool values a harness sends as text are read as the type the tool asks for, and a running seat
  is told when its team tools change.

![How a piece of work goes](docs/images/workflow.svg)

## How a piece of work goes

1. **You set the intent.** Start the Supervisor in your project and say what you want. Before new work
   starts, it asks you questions in numbered rounds, each with the answer it recommends, and writes
   what you settle about the project into its `CONTEXT.md`, which lives outside your repo. Then it
   reads the plan back: the lanes, what each must deliver, and what will wake you. What you settle for
   every lane becomes a standing order: the paths you want to see before they land, and where lanes
   work.
2. **The team works, and you may leave.** The Supervisor opens each lane with an outcome and
   acceptance criteria, and the plugin starts its Lead. The Lead splits the lane into tasks, each
   done by a Peer of its own on a branch of its own, has Reviewers read the work, and accepts it,
   sends it back or cuts it. A Lead with a question asks the Supervisor and carries on with its
   default meanwhile; a Peer asks its Lead, with its best guess. A decision only you can make goes
   on your question queue, with the Supervisor's recommendation and what goes ahead while you are
   silent. A command that cannot be undone is paged to your phone, and the Supervisor is told, to
   hold the lane if it must.
3. **Lanes land on your base.** When a Lead reports its lane ready, the plugin runs your test
   command (the gate), and the rehearsal of each risk rule the lane's change reaches, where the rule
   has one. The Supervisor lands the lane: the plugin merges in your base if it moved, runs the gate
   on the result, and lands the lane on your local base branch. A lane that touches a path you asked
   to see first waits for your approval.
4. **You come back to a report.** The panel's **Report** tab tells the last day from the record: what
   needs you, what went ahead on a recommendation, what landed. Pushing and releasing are yours:
   every seat's `git` refuses to push.

## What it does, and what it doesn't

The plugin runs the team and keeps its record. Whether the work is right is always a seat's call, or
yours.

| It does | It enforces | It never does |
|---|---|---|
| Starts one agent per seat, set up for its role | Lanes may not overlap in what they declare they write | Judge the work |
| Keeps a shared record of lanes, tasks, questions and incidents | One writer per working copy | Tell a seat what the watch concluded about it |
| Carries mail between seats, each letter ending with what it asks of its reader, and holds it until its reader can take it, for up to 7 days | A red gate stops a task merging into its lane, unless its Lead accepts it over the gate with a reason, and a lane landing, unless the Supervisor lands it over the gate with a reason | Write your project's concept for you |
| Keeps a durable record outside your repo | A landing that touches a path you asked to see first waits for you | Write into your project's files |
| Watches Leads and Peers, tells whoever answers for them, and pages you for what cannot be undone | Each role's permissions, where its agent allows it, and git commands only the desk runs | Push or release |

## The team

![SLP: who decides what](docs/images/slp-graph.svg)

| Role | Owns | Starts and ends | Default agent |
|---|---|---|---|
| Supervisor | Your intent, across lanes: opens, lands and drops them, answers Leads, and is the only seat that asks you anything | You start it | Claude Code · `claude-opus-5` · high |
| Lead | One lane: its tasks, their order, and what is accepted | Started with its lane; stays after the lane closes until the Supervisor releases it | Claude Code · `claude-opus-5` · medium |
| Peer | One task, and the engineering judgement inside it | Started with its task; stays after the task is accepted until its Lead releases it or the lane closes, and never takes another | Claude Code · `claude-opus-5` · medium |
| Reviewer | A read-only review of one change | Started with its review; ends when its Lead cuts the review or the lane closes | Claude Code · `claude-opus-5` · medium |
| Watcher | The watch's questions, one case at a time, when you choose a seat to answer them | Started when a case first needs it; let go once no lane is open | The Peer's, until you set its own |
| Pager | One page, said back word for word so Paseo pushes it to your phone | Started for its page | Claude Code · `claude-opus-5` · low |

Roles are data in `plugin/roles.json`, not code, and each has the tools listed in
[the reference](docs/REFERENCE.md#desk-verbs).

## Supported agents

Any role can sit on any of these five agents. You pick one per role in the panel, with its model and
thinking level where the agent offers them.

| Agent | Before its first seat | Sandbox | Mail into a running turn |
|---|---|---|---|
| Claude Code | `claude` signed in | yes | yes |
| Codex | `codex login` once; the `codex` CLI must be on the machine that runs the daemon | yes | yes |
| Pi | `pi` signed in, and `pi install npm:pi-mcp-adapter` once: the adapter is how a Pi seat reaches the desk | no | yes |
| Oh My Pi | `omp` signed in once, outside any seat (`/login`) | no | no, it waits for the turn to end |
| OpenCode | `opencode auth login` once, outside any seat | no | yes |

Every seat reads your project's own instructions: Claude Code reads `CLAUDE.md`, or `AGENTS.md` when
the project has no `CLAUDE.md`, and the others read `AGENTS.md`. Every seat's `PATH` refuses the
desk's git commands, `gh` and `paseo`. Claude Code, Codex, Oh My Pi and OpenCode seats are also
denied `git push`, `gh`, `paseo` and starting other agents by their own rules. Pi has no command
rules, so a Pi seat can start another agent: its `PATH` cannot refuse one, since its own agent
starts through that same `PATH`. The shipped Claude Code settings answer in Vietnamese: change
`language` in `plugin/harness/claude/settings.json` for another language. The details are under
[seat directories](docs/REFERENCE.md#seat-directories) and [known
limits](docs/REFERENCE.md#known-limits).

## Install

You need:

- Paseo `>=0.9.1 <0.10.0`
- Node.js 24 or newer; there is no build step
- `git` and `jq`
- the CLI of each agent you use, signed in
- optionally `gh`, to open a lane from an issue, and `uv`, for code search

```bash
cd plugin
npm install
paseo plugin install "$PWD"
```

Paseo remembers where the clone is. If you move it, install it again.

**Keeping it current.** The **Plugin** tab shows the version that runs and, once checked, the one on
the clone's branch. **Update** only moves forward, runs `npm install` when the packages changed, and
reloads the plugin. It is offered only once no seat is left in any project, idle ones included,
because every project moves to the new version at once. Below the version is one row for each thing
that needs you:

- A changed **prompt** or **skill**: **Use new**, or **Keep mine** to go on with the version you had.
  Yours is copied to `~/.local/share/seatworks-v3/own/` for you to edit by hand, and you are still
  told when the original changes.
- Changed **guides** and **records**: named only, for you to read in git.
- Settings this version cannot read, and seats still on an older version.

**Clean up** lists seat folders, working copies and copies nothing uses any more, and removes only
what you pick.

## First run

1. In Paseo, open **Seatworks** in the sidebar.
2. **Add project**, pick the repository, choose an agent for each role, and attach.
3. Open **Health** and choose **Run**.
4. Start an agent in that project with the provider **Supervisor · Claude Code (sw2)**, and tell it
   what you want.

The plugin starts everyone else as the work needs them. A lane works in your checkout on a new
branch, unless the Supervisor or your standing order (`laneHome`) keeps it on the branch you are on or
gives it a working copy of its own. Your checkout holds one lane at a time, so a lane opened meanwhile
takes a copy of its own or waits its turn. When neither has said, and your checkout has uncommitted
work or is on a branch other than the base, you are asked first.

**Your project's files stay yours.** The plugin writes nothing into them: what the team shares is in
each role's own prompt, and everything the plugin keeps lives under `~/.local/share/seatworks-v3/`.

## When the team needs you

A project's panel has seven tabs: **Team** (an agent per role, and the watch), **Flow**, **Report**,
**Orders**, **MCP** (optional servers per role), **Health**, and **Plugin**, which keeps the plugin
current. Three of them are where you meet the work:

- **Flow**, with **Follow the team live** on, starts with what waits for you. Each question shows
  its choices, the Supervisor's recommendation and what goes ahead while you are silent: a question
  that can be undone goes on with the recommendation at once, a costly one until its lane reports
  ready, and one that cannot be undone holds its lane now. Answer with a choice or decline it, with
  a note if you like. A landing held for you shows the desk's evidence; approve it and it lands,
  send it back and your note goes to the Lead. Below that are the lanes and tasks, live.
- **Report** is the last day, read from the record and written by no agent: what needs you, what went
  ahead on a recommendation, what landed, what could not be undone, and the counts.
- **Orders** shows what you settled, read only: the paths you see first, the risk rules, where lanes
  work, and `CONTEXT.md`. You change them by telling the Supervisor.

You can also answer a question in the Supervisor's chat, and it records your answer in your own words.
You may type into any seat's chat: what you write to a Lead or a Peer is passed on to the Supervisor.
A page reaches your phone as two lines from a Pager seat, and the Supervisor can stop a lane at once
with a hold, until it resumes the lane. The Supervisor asks you at most three questions a day
across all projects (`questionsPerDay`).

## The watch

The plugin reads the turns of Leads and Peers in code, for things like a destructive command, the
same failure again and again, or a weakened test, and each lane's record, for things like a task sent
back three times. A finding becomes an **incident**: an ordinary one about a Peer goes to its Lead, and
one about a Lead, an urgent one (a *page*), or one whose Lead is gone goes to the Supervisor. The seat
it is about never hears of it. Whoever gets it marks it `useful`, `noise` or `unknown`.

Out of the box, ordinary incidents are recorded and listed but not mailed, while a page still goes to
the Supervisor and to your phone. To mail the rest, turn on **Mail incidents** on the Supervisor's chip
in the **Team** tab.

What code cannot read, the watch asks a model, one question at a time, at the moment it matters: was
this destructive command asked for, does a complete hand-back's summary admit a gap, did a review that
accepts a migration say it ran the invariant. On the Watcher's chip in **Team** you pick who answers:
Jev, a small model asked over OpenRouter with your key, which stays on this machine and is never shown
again; the Watcher seat; or nobody. Every question ships in shadow: its answers are kept in the
project's `assessments.log` for you to label, and no seat is sent them. How the watch works is in
[the architecture](docs/ARCHITECTURE.md#the-watch).

## Known Paseo behaviour

- **Opening an archived seat's history starts its agent again, and leaves it running.** Paseo resumes
  an archived agent to show its history, from the app or `paseo logs`, and never closes it. A Pi seat
  leaves a `pi` process, an Oh My Pi seat an `omp` one, an OpenCode seat an `opencode serve`. The
  plugin never reads an archived seat itself. To be rid of them, with no seat of yours running:
  `pkill -f "pi --mode rpc"`, `pkill -f "omp --mode rpc-ui"` or `pkill -f "opencode serve"`.
- **An agent gets only the provider keys Paseo's daemon has.** A key set in your shell, such as
  `NVIDIA_API_KEY` for Pi, does not reach the daemon, so those models are neither listed nor usable.
  Put the key where the agent keeps its own (`~/.pi/agent/auth.json` for Pi).
- **Paseo keeps a project for a folder you have deleted.** List them with `paseo project ls` and remove
  one with `paseo project delete <id>`.

## Development

```bash
cd plugin
npm run check
```

This type-checks the code and runs every test. Don't launch seats to test a change: they are real
agents, with real permissions, and they cost money. The evals that call a real model are in
[the reference](docs/REFERENCE.md#evals).

## Docs

| Read | When you want |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works inside, in one sitting |
| [REFERENCE.md](docs/REFERENCE.md) | To look something up: verbs, letters, facts, settings, files |
| [ANTIPATTERNS.md](docs/ANTIPATTERNS.md) | How a team of agents goes wrong, and which of those the watch can see |
| [AGENTS.md](AGENTS.md) | The rules this code follows, before you change it |

## License

MIT, see [LICENSE](LICENSE). [NOTICE.md](NOTICE.md) lists where the shipped skills come from.
