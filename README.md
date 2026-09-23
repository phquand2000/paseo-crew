# Paseo Crew

A [Paseo](https://paseo.sh) plugin that runs a team of coding agents the **SLP** way. A
**Supervisor** works with you, a **Lead** owns each line of work, and **Peers** each do one task. A
**Reviewer** reads the work with clean context, a **Hunter** hunts a whole scope for bugs, and a
**Watcher** reads how it is being done.

> **Pre-release.** Nothing has shipped: no releases, no compatibility promises.

## Origin

Paseo Crew is a clone of [Seatworks](https://github.com/sting9k/seatworks) by long7400, taken from
branch `v2` at commit
[`efd0da0`](https://github.com/sting9k/seatworks/commit/efd0da00e5a7eea08579652a4e110b606e0e8161)
(version 2.0.3), and customized from there. It is an independent copy, not a GitHub fork, and is not
affiliated with or endorsed by the Seatworks author. The full upstream history is kept, the
[MIT license](LICENSE) is unchanged, and [NOTICE.md](NOTICE.md) still describes where the bundled
skills come from.

Changes from upstream so far:

- Renamed so both can be installed side by side: plugin id `seatworks-v2` → `paseo-crew`, provider
  prefix `sw2-` → `crew-`, state directory `~/.local/share/seatworks-v2` → `~/.local/share/paseo-crew`,
  environment variables `SEATWORKS_*` → `PASEO_CREW_*`, RPC and label namespace `seatworks.` →
  `paseo-crew.`, and the `AGENTS.md` block markers `seatworks:begin`/`seatworks:end` →
  `paseo-crew:begin`/`paseo-crew:end`.
- Version raised to 2.1.0. Behaviour is otherwise the same as upstream.
- 2.1.1: accepts Paseo `>=0.8.0 <0.10.0` and is built and tested against the 0.9.1 SDK; tests
  resolve their own paths with `fileURLToPath`, so the suite passes in a directory whose path has
  spaces.
- 2.2.0: `links`, `writable` and `claudePointer` in a project's `project.json`, for a project that
  keeps its agent instructions and plans out of git. See
  [Local files](docs/REFERENCE.md#local-files). State format 2 adds these values to each existing
  `project.json`, with defaults that keep 2.1 behaviour. An older Paseo Crew refuses state format 2.
- 2.3.0: a repository that keeps its own workflow in `docs/WORKFLOW.md` (as a Harness install does)
  owns plans, decisions, rules for code and the Human's word in `docs/product/`; the team keeps
  lanes, tasks, reviews, mail and landing. Prompts and guides point at the project's own files;
  nothing from Harness is shipped here. A repository without `docs/WORKFLOW.md` works as before.
- 3.0.0: Pi and Devin CLI are gone; OpenCode and Antigravity (`agy`) take their place. A project
  that still names `pi` or `devin` shows "unknown harness" in Health until you pick another agent.
  Peer and Reviewer default to Codex `gpt-5.5`. A new **Hunter** role runs the Lead's ultra-review
  hunt: one seat, ten scouts of its own, one hand-back, where the Lead used to start ten Reviewers.
  Peers get `repo-refresh`. An OpenCode seat loads only its role's skills.

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
3. **The Lead splits the lane into tasks.** It starts a Peer on each task, has a Reviewer read each
   big task and then the whole lane, and accepts or sends the work back.
4. **The Lead reports the lane ready.** The desk runs the gate first.
5. **The Supervisor closes the lane.** The desk merges in your base branch if it moved, runs the
   gate on the result, then fast-forwards the base.

The step-by-step picture is in [A lane, end to end](docs/ARCHITECTURE.md#a-lane).

## The team

| Role | Owns | Default agent |
|---|---|---|
| Supervisor | Your intent, across lanes: opens and closes them, answers Leads | Claude Code · `claude-opus-5-5` · high |
| Lead | One lane: its tasks, their order, and what is accepted | Claude Code · `claude-opus-5-5` · high |
| Peer | One task, and the engineering judgement inside it | Codex · `gpt-5.5` |
| Reviewer | A read-only review of one change | Codex · `gpt-5.5` |
| Hunter | A read-only bug hunt across one scope, with ten scouts of its own | Antigravity · `gemini-3.8-flash-high` |
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
| OpenCode | `opencode auth login` once | no | no, it waits for the turn to end |
| Antigravity | `agy` signed in once, and `agy-acp` on the `PATH` of the daemon | no | no, it waits for the turn to end |

Every seat reads your project's own instructions: Claude reads `CLAUDE.md`, and the others read
`AGENTS.md`. Claude Code, Codex and OpenCode seats are denied `git push`, `gh`, `paseo` and starting
other agents. An Antigravity seat has no sandbox and no path or command rules: it runs with
`--dangerously-skip-permissions` and is held only by its prompt, so give it roles you would trust
unsupervised. Only the Hunter may start subagents, on the agents that have them. No seat reads your
own global instructions (`~/.claude/CLAUDE.md`, `~/.config/opencode`, `~/.gemini/GEMINI.md`). The shipped Claude settings answer in
Vietnamese: change `language` in `plugin/harness/claude/settings.json` for another language. The details are under
[seat directories](docs/REFERENCE.md#seat-directories) and
[known limits](docs/REFERENCE.md#known-limits).

## Install

You need:

- Paseo `>=0.8.0 <0.10.0`
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

- A changed **prompt**, **skill** or **team block**: **Use new**, or **Keep mine** to go on with the
  version you had. Yours is copied to `~/.local/share/paseo-crew/own/` for you to edit by hand, and
  you are still told when the original changes.
- Changed **guides** and **records**: named only, for you to read in git.
- Settings this version cannot read, a stale `AGENTS.md` block, seats still on an older version.

**Clean up** lists seat folders, working copies and copies nobody uses any more, and removes only
what you pick.

## First run

1. In Paseo, open **Paseo Crew** in the sidebar.
2. **Add project**, pick the repository, choose an agent for each role, and attach.
3. Open **Health** and choose **Run**.
4. Start an agent in that project with the provider **Supervisor · Claude Code (crew)**, and tell it
   what you want.

The desk seats everyone else as the work needs them. The first lane works in your checkout, and each
later one in a working copy of its own.

**Your project's `AGENTS.md`.** The first time a seat opens, the plugin writes the team's shared
rules into your `AGENTS.md`, in a marked `paseo-crew` block. It replaces that block whole and never
touches your own text. `CLAUDE.md` gets a pointer to `AGENTS.md`. Commit both once, because a lane in
its own working copy sees only what is committed. To keep them out of git instead, see
[Local files](docs/REFERENCE.md#local-files).

The panel has four tabs: **Team** (agents and the watch), **Flow** (lanes, tasks and questions,
live), **MCP** (optional servers per role) and **Health**. Everything the desk keeps lives under
`~/.local/share/paseo-crew/`.

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

## Known Paseo behaviour

- **Opening an archived seat's history starts its agent again, and leaves it running.** Paseo
  resumes an archived agent to show its history, from the app or `paseo logs`, and never closes it.
  The plugin never reads an archived seat itself. To be rid of a leftover Antigravity seat:
  `pkill -f agy-acp`, with no seat of yours running.
- **An agent gets only the provider keys Paseo's daemon has.** A key set in your shell, such as
  a provider key for OpenCode, does not reach the daemon, so those models are neither listed nor
  usable. Put the key where the agent keeps its own (`opencode auth login` for OpenCode).
- **An Antigravity seat hears mail only between turns.** `agy-acp` runs `agy` in print mode, one
  prompt per turn with a 45-minute limit, so mail waits for the turn to end.
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
