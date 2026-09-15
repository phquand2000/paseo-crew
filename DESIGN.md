# Seatworks design

Seatworks runs the SLPW team (Supervisor, Lead, Peer, Watcher) on Paseo as one plugin. The people in
the team are agents; the plugin is the desk they all work through. This file is for maintainers.

## Goal

Seatworks is a Paseo plugin whose job is to make the SLPW way of working hold: the roles and their
authority, lanes, tasks, hand-backs, asks, merges and attention. That concept is the only thing the
code owns.

Everything around the concept is the user's choice and lives in data, never in code:

- which harness (Claude Code, Devin, Pi…), model and thinking option the Supervisor, Lead, Peer,
  Reviewer and Watcher each run on;
- which MCP servers, tools, IDE and search backends are on, for which roles, with which rules and
  skills;
- what differs per machine or project: paths, ports, logins.

Settings choose these, in a machine and a project layer a web app manages over RPC, from a catalog
of files: `roles.json` defaults, `harness/<id>/` and `catalog/mcp/<id>/`. Switching a role's agent or
model, or turning a server or tool on or off, is a settings change. Supporting a new harness or
server is a new catalog directory. Neither needs an edit under `server/` or `mcp/`.

The test for any change: if picking another agent, model, tool or MCP server would force a code
edit, the code has a defect, and that knowledge moves into the catalog. Code names the concept
(roles, lanes, tasks, the desk); it names no vendor, model, tool or server.

## The concept kept

- **Authority by axis.** The Human owns intent. The Supervisor acts for the Human, decides every
  development question and intervenes; it never implements, validates or accepts. The Lead owns a
  lane: its breakdown, Peers, integration and acceptance. A Peer owns the judgment inside its task.
- **One owner per scope, one writer per branch.** Hand-backs go to the Lead, which accepts.
- **No group chat.** Owners decide who knows what. A Supervisor that touches a Peer tells its Lead.
- **Attention is event-driven.** A cheap watcher reads flagged turn endings and raises attention to
  the Supervisor; the Human gets decisions and digests, not status.
- **Neutral questions, not accusations.** Lane size matches risk; no ceremony; git is the history.

## What the 2026-09-14 OMS run taught

Every failure that cost the day was coordination done in chat by models: finish notifications
cancelling turns, Lead turns nobody heard, asks lost at compaction, many writers on one checkout,
builds competing, a watcher that vanished, refused calls ending turns silently, and three quarters of
the effort spent on docs and tests. The design moves all of that into code.

## Principles

1. **Code decides state; models propose.** Only the plugin writes the ledger, creates seats and
   worktrees, merges and runs the gate (Symphony, Gas Town).
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
7. **Watchers are cheap and cannot disappear.** Tier 0 is plugin code (timers, silent ends, stale
   asks, idle lanes). Tier 1 is a headless run of a cheap model the plugin launches on flagged turn
   endings; it answers one label per ending. There is no watcher seat to lose.
8. **Fixed-shape hand-backs, full text on disk.** A letter carries the summary; the full hand-back and
   gate logs live in the project's state directory, named by path.
9. **Plans are for agents, not a human team.** One strong agent finishes most features and foundation
   changes in one sitting, so a lane is usually one task. Work splits only where write sets are
   independent. Unshipped code changes in place with its callers and tests: no compatibility, bridge
   or transition layer between slices, and the watcher and reviewer flag one when it appears.
10. **Acceptance first, code focus.** A task carries its acceptance checks and owned paths. The merge
   report counts source, test and docs lines so ceremony is visible where it is decided.

## Layout

```
plugin/
  index.server.ts        wires Runtime
  roles.json             roles: default harness and model, prompt, skills, limits
  harness/<id>/          harness manifest (models, delivery), role settings, NOTES.md
  catalog/mcp/<id>/      MCP servers settings can enable: mcp.json, rule.md, skills/
  content/prompts/       one prompt per role
  content/guides/        guides a role reads on demand
  content/skills/<set>/  skills linked into seats
  mcp/team.mjs           the team MCP server, no dependencies
  bin/seat-room          launcher that forces harness flags
  server/                plugin code
```

State lives outside every repository, in `~/.local/share/seatworks-v2/`:

```
guides/                         link to content/guides
spool/requests, spool/replies   tool calls between team.mjs and the plugin
outbox.json                     letters waiting for an idle recipient
projects/<slug>/
  project.json                  base branch, gate command, limits
  ledger.json                   lanes, tasks, asks, agents
  events.log                    one JSON line per event
  status.md                     generated view for the Supervisor and the Human
  handbacks/, gates/            full hand-backs and gate logs
  notebook.md                   the Supervisor's pattern notebook
```

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

## Settings, catalog and harness adapters

Nothing machine- or project-specific lives in the plugin. The plugin holds a catalog (roles,
harness adapters, MCP servers) and code that knows none of their names; settings choose from the
catalog in two layers, machine then project, each validated before it is saved.

- A harness adapter says how that agent takes a prompt (launch config or a file), where its rules go
  (`CLAUDE.md`, the end of `AGENTS.md`), where skills link, how MCP servers reach it (launch config
  or a JSON file) and over which transports, whether it must list a server's tools before calling,
  its models and its headless command. Moving a role to another harness is a setting; adding a
  harness is a directory.
- An MCP entry says what the server is (a plain stdio/http server, or a backend the proxy pins to
  each seat's working copy: its http or stdio backend, pinned argument, the tools that open, wait for
  and sync a working copy, error guidance and tool descriptions), its settings with defaults, which roles it serves and with which tools, its rule and its
  skills. Rules and tool lists are generated per seat from the enabled entries, so role prompts
  never name a tool that may be switched off.
- Every role gets a provider per harness that has settings for it (`sw2-<role>-<harness>`), so one
  project's Lead can run on Devin while another's runs on Claude. Seat directories are per role,
  harness and project, because rules and servers can differ per project.
- The plugin serves the catalog, both settings layers, the resolved team, doctor checks and status
  over RPC, so a web app manages it without touching files.
