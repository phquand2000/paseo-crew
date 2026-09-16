# Seatworks design

Why the shape is this way. [SPEC.md](SPEC.md) says what the shape is; this file is the reasoning
behind it, for maintainers.

Seatworks runs the SLPW team (Supervisor, Lead, Peer, Watcher) on Paseo as one plugin. The people in
the team are agents; the plugin is the desk they all work through.

## Goal

Seatworks is a Paseo plugin whose job is to make the SLPW way of working hold: the roles and their
authority, lanes, tasks, hand-backs, asks, merges and attention. That concept is the only thing the
code owns.

Everything around the concept is the user's choice and lives in data, never in code:

- which harness (Claude Code, Devin, Pi…), model and thinking option each role runs on;
- which MCP servers, tools, IDE and search backends are on, for which roles, with which rules and
  skills;
- what differs per machine or project: paths, ports, logins.

The test for any change: if picking another agent, model, tool or MCP server would force a code
edit, the code has a defect, and that knowledge moves into the catalog. Code names the concept
(roles, lanes, tasks, the desk); it names no vendor, model, tool or server.

## The concept kept

- **Authority by axis.** The Human owns intent. The Supervisor acts for the Human, decides every
  development question and intervenes; it never implements, validates or accepts. The Lead owns a
  lane: its breakdown, Peers, integration and acceptance. A Peer owns the judgment inside its task.
- **One owner per scope, one writer per branch.** Hand-backs go to the Lead, which accepts.
- **No group chat.** Owners decide who knows what. A Supervisor that touches a Peer tells its Lead.
- **Attention is event-driven.** A cheap watcher reads how turns end and raises attention to
  the Supervisor; the Human gets decisions and digests, not status.
- **Neutral questions, not accusations.** Lane size matches risk; no ceremony; git is the history.

## What the 2026-09-14 OMS run taught

Every failure that cost the day was coordination done in chat by models: finish notifications
cancelling turns, Lead turns nobody heard, asks lost at compaction, many writers on one checkout,
builds competing, a watcher that vanished, refused calls ending turns silently, and three quarters of
the effort spent on docs and tests. The design moves all of that into code.

This section is the evidence base for the principles below. A new rule needs a failure like one of
these behind it; that is why rules here are rewritten rather than appended to.

## Principles

1. **Code decides state; models propose.** Only the plugin writes the ledger, creates seats and
   worktrees, merges and runs the gate.
2. **Every seat talks through typed tools.** The `team` MCP server gives each role a few tools
   (`start_task`, `done`, `ask`, `accept`…). A tool call is a state change the plugin records. Paseo's
   own agent tools are off except reading an agent's activity.
3. **Mail waits for a turn boundary.** Letters are held until the recipient is idle. Nothing steers
   into or interrupts a running turn.
4. **Events route by ledger owner, not by who sent a prompt.** A Peer's hand-back reaches its Lead
   whoever woke the Peer; a Lead's ask reaches the Supervisor.
5. **Every turn ends in a recorded state.** A Peer turn without `done` or `ask` is nudged once, then
   reported to its Lead with the turn's ending. A refused call is named in that report.
6. **A branch and worktree per lane and per task.** The Lead's lane branch is the integration branch;
   each Peer works on a task branch off it. Accepting a task merges it into the lane. The project's
   gate runs once on the whole lane, when its Lead reports it ready and again before it lands, so a
   task never has to build on its own. Landing is a fast-forward or merge the Supervisor asks for;
   pushing stays the Human's.
7. **Watchers are cheap and are put back.** The plugin itself catches what a timer can see: turns
   that end silently, asks going stale, lanes sitting idle. Anything that needs reading goes to a
   cheap seat, which the patrol puts on any project with an open lane. Every turn ending reaches it
   as mail, fenced, with a line saying the contents are data rather than instructions; it answers
   with one label through `raise`, the only tool it has. It holds no working copy and cannot read
   the repository. The run above lost a watcher and nobody noticed, so the answer is not a watcher
   that cannot be lost but one the patrol seats again on the next tick.
8. **Fixed-shape hand-backs, full text on disk.** A letter carries the summary; the full hand-back and
   gate logs live in the project's state directory, named by path.
9. **Plans are for agents, not a human team.** One strong agent finishes most features and foundation
   changes in one sitting, so a lane is usually one task. Work splits only where write sets are
   independent. Unshipped code changes in place with its callers and tests: no compatibility, bridge
   or transition layer between slices, and the watcher and reviewer flag one when it appears.
10. **Acceptance first, code focus.** A task carries its acceptance checks and owned paths. The merge
    report counts source, test and docs lines so ceremony is visible where it is decided.

## Flow

1. The Human talks to a Supervisor started from the `sw2-supervisor-claude` profile.
2. `open_lane` creates the lane branch and worktree and starts a Lead there with the directive.
3. The Lead reads, usually gives the whole lane to one task, and calls `start_task`: the plugin
   creates the task branch and worktree and starts a Peer with a brief built from the call. A second
   task only exists for an independent write set.
4. The Peer commits on its branch and calls `done`. The plugin stores the hand-back and mails the
   Lead when it is idle.
5. The Lead calls `accept`, `rework`, `start_review` or `cut`. `accept` enters the merge queue.
6. Questions: a Peer's `ask` goes to its Lead, a Lead's `ask` to the Supervisor. Each is a ledger
   record, repeated in every letter to the recipient until answered, and escalated when stale.
7. The Lead's `report` ready runs the gate on the whole lane, then goes to the Supervisor.
   `close_lane` reruns the gate, lands the lane on the base branch by fast-forward or merge when
   asked, and archives the lane's seats.

## Why settings and a catalog, rather than code

Nothing machine- or project-specific lives in the plugin. The plugin holds a catalog (roles, harness
adapters, MCP servers) and code that knows none of their names; settings choose from the catalog in
two layers, machine then project, each validated before it is saved. [SPEC.md](SPEC.md) holds the
contracts; the reasoning is here.

- **A harness is an adapter, because agents differ in mechanical ways only.** How an agent takes a
  prompt, where its rules go, where skills link, how servers reach it and over which transports,
  what to clear in its own config so a repository cannot add servers — all of that is a fact about
  that agent, not about the team. Writing it as data means a new agent is a directory, and moving a
  role between agents is a setting.
- **Servers belong to the settings, not to the kit.** A pasted connection snippet is enough to make
  one exist. The three entries under `catalog/mcp/` are templates: they ship switched off and can be
  removed outright. Rules and tool lists are generated per seat from what is enabled, so a role
  prompt never names a tool that may be switched off.
- **A tool a role must not use is left out of its list,** rather than forbidden in prose. Making the
  wrong action absent is enforcement; asking for it is a suggestion with a compliance rate.
- **Every role gets a provider per harness that has settings for it**, so one project's Lead can run
  on Devin while another's runs on Claude. Seat directories are per role, harness and project,
  because rules and servers can differ per project.
- **The plugin serves the catalog, both settings layers, the resolved team, doctor checks, status
  and the live flow over RPC**, so a web app manages it without touching files. Following the flow
  live is itself a setting; a poll that changes nothing is answered with its revision alone, and the
  ledger is parsed again only when the file on disk has moved.
