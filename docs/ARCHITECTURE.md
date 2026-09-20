# Architecture

How Seatworks works inside. The [README](../README.md) explains what it is, the team and how to
install it. [AGENTS.md](../AGENTS.md) explains the rules the code follows. The one rule that shapes
everything here: the plugin serves SLP and never constrains it. Its authority stops at session
lifecycle, transport, routing, notification, durable state and provenance.

- [The parts](#the-parts)
- [Code map](#code-map)
- [Boot](#boot)
- [From data to a running seat](#from-data-to-a-running-seat)
- [The desk](#the-desk)
- [Tool calls in, letters out](#tool-calls-in-letters-out)
- [Reading turns](#reading-turns)
- [Watching Leads and Peers](#watching-leads-and-peers)
- [The patrol](#the-patrol)
- [Settings](#settings)
- [MCP servers](#mcp-servers)
- [The panel](#the-panel)
- [State on disk](#state-on-disk)
- [Testing](#testing)
- [Known limits](#known-limits)

## The parts

The picture at the top of the README shows the whole. Four kinds of process are involved:

| Process | What it is | Seatworks code in it |
|---|---|---|
| Paseo daemon | Runs agents and loads plugins | `plugin/server/**`, entered through `index.server.ts` |
| Paseo app | The UI | `plugin/client/**`, entered through `index.client.tsx` |
| A seat | An agent process Paseo started from a `sw2-<role>-<agent>` provider | For Claude Code and Devin, `plugin/bin/seat-room` checks the launch and then `exec`s the agent. Otherwise nothing, just the seat directory the plugin wrote |
| A seat's MCP servers | Child processes of the seat | `plugin/mcp/team.mjs`, plus `plugin/mcp/code.mjs` for proxied catalog servers |

The daemon side and the seats share no memory. Seats reach the plugin through files, the spool.
The plugin reaches seats through Paseo, with `agents.ref(id).send`.

## Code map

| Path | Responsibility |
|---|---|
| `plugin/server/core/` | Ports (`Seats`, `Workspaces`), the Paseo adapter, the timeline stream reader, atomic JSON and TOML stores, `git`, the gate runner, paths |
| `plugin/server/catalog/` | Data to seats: the kit loader and harness contract, team resolution, providers, seat directories, launch config, content rendering |
| `plugin/server/desk/` | The ledger and the verbs seats call: lanes, tasks, asks, working copies, merge queue, gates, incidents, letters |
| `plugin/server/runtime/` | The composition root and loops: hooks, spool, outbox, patrol, turn reading, RPC, health checks |
| `plugin/server/runtime/watch/` | The window over a seat's timeline, the facts read from it, the sensor, and how its answers are weighed |
| `plugin/client/` | The Seatworks panel |
| `plugin/shared/rpc.ts` | The typed RPC contracts between the panel and the server |
| `plugin/mcp/` | `team.mjs` (desk tools over stdio), `code.mjs` (proxy for catalog servers), `tools.json` (tool sets) |
| `plugin/bin/` | `seat-room`, the launcher for Claude and Devin seats; `calibrate.ts`, the report over what the watch kept |
| `plugin/roles.json` | The SLP preset: the provider prefix, the attention values, and each role's capabilities, tool set, prompt, skills and default agent |
| `plugin/harness/<agent>/` | How each agent is set up: `harness.json`, plus base and per-role settings |
| `plugin/catalog/mcp/<id>/` | Optional MCP servers |
| `plugin/catalog/sensor/<id>/` | The sensor: where it is asked, which model, and the questions it asks |
| `plugin/content/` | Runtime content seats read: role prompts, skills, guides, the notebook, page templates. This is not documentation. |

Only `server/core/paseo-adapter.ts` calls the daemon's agent and workspace API (`context.paseo`). The
runtime just registers hooks, events and RPC handlers with the SDK. The desk, the outbox, the patrol
and the settings control depend on the `Seats` and `Workspaces` ports, so the tests drive them with
fakes. The API handle is never kept from boot: it is taken fresh from every hook, event and RPC call.
Until the first of those arrives the patrol skips its ticks and the spool is not drained, so after a
daemon reload it is whatever comes first — opening the panel, or starting a seat — that brings both
back.

## Boot

1. Paseo calls `contribute(server)` in `index.server.ts`.
2. The plugin finds its directory from `SEATWORKS_PLUGIN_DIR`, or from `plugins["seatworks-v2"]` in
   `~/.paseo/config.json` when that entry is a directory install. Without one, it logs and stays
   inert.
3. `loadKit` reads `roles.json`, preferring a copy in `~/.local/share/seatworks-v2/`, and takes the
   attention values that file sets. It also reads every `harness/<agent>/harness.json`, the MCP
   catalog, `mcp/tools.json`, the page templates and the sensor in `catalog/sensor/`. A `harness.json`
   or a `sensor.json` with an unknown field, or a required field missing, fails the load with the
   field named, and a kit that fails to load leaves the whole plugin inert; the MCP catalog, the tool
   sets, the templates and the roles themselves are taken much as written.
4. `Runtime.prepare` creates the state root and the spool, links `guides/` to `content/guides`, and
   prints every settings error. It then reconciles the providers.
5. `Runtime.register` sets up the rest:
   - the RPC handlers
   - two hooks that run before a start, on `agent.create` and `agent.session_open`
   - five lifecycle events
   - a 500 ms spool poll
   - a patrol timer that re-arms itself, reading the cadence again each round and never going below
     5 s, so a change in settings takes hold without a reload

Unloading the plugin stops both timers and lets go of every watch.

| Hook or event | What the plugin does |
|---|---|
| before `agent.create` | For a `sw2-` provider, builds the seat directory and shapes the launch config. A seat that cannot be built refuses the launch, with the reason. |
| before `agent.session_open` | Seeds the project's records, rebuilds the seat directory if needed, and points the agent's config directory at it |
| `agent.created` | Starts following the seat's timeline, if its role can be `watched` |
| `agent.turn_started` | Records when the turn started, for turn reading and for the outbox's steer rule |
| `agent.turn_ended` | Finishes a deferred archive or working-copy teardown, reads the turn unless the seat is being put away, and pumps the seat's mail whatever the reading ran into |
| `agent.permission_requested` | Mails the request to the seat's owner, or logs it (see [Permission requests](#permission-requests)) |
| `agent.archived` | Forgets the seat's turn and send timing, lets go of its timeline watch, and closes its open incidents. Letters already held for it stay in the outbox until they age out. |

## From data to a running seat

![From data to a running seat](images/seat-build.svg)

### Providers

The plugin makes a Paseo provider for every role and agent pair where that role has a settings file
for that agent, and every source that harness's `files` names exists. The provider is
`<prefix><role>-<agent>` (the prefix is `sw2-`), with a matching agent profile, and its label reads
like **Lead · Claude Code (sw2)**. Each provider:

- extends the agent's Paseo base provider
- carries the agent's environment, launch command and models
- carries the Paseo tools the role may use (the role's `paseoTools.allow` becomes a `disabledTools`
  list)

Reconciling runs at plugin start and after a machine-layer settings save. When the wanted providers
or profiles differ from `~/.paseo/config.json`, it rewrites `agents.providers` and
`daemon.agentProfiles` atomically and keeps the file's mode. It deletes `sw2-` entries the kit no
longer produces, keeps env keys the user added, and runs `paseo daemon reload`. When nothing
differs, it leaves the file and the daemon alone. The shipped kit makes 16 providers: four roles on
four agents.

### The harness contract

`plugin/harness/<agent>/harness.json` describes how one agent is set up. `id`, `label`,
`baseProvider`, `configDirEnv`, `profileRoot`, `skillsDir`, `settings`, `mcp` and `provider` are
required; the rest are optional.

| Field | Drives |
|---|---|
| `id`, `label` | The harness's own name, and the half of a provider's label that names the agent |
| `baseProvider` | The Paseo provider this one extends: `claude`, `codex`, `pi` or `acp` |
| `configDirEnv`, `profileRoot` | The variable that points the agent at its seat directory, and where those directories live |
| `systemPrompt`, `promptFile` | Whether the prompt goes in the launch config (`config`) or into a file (`file`) |
| `contextFile` | A file in the seat directory that gets the working rules, when there are any |
| `skillsDir` | Where skills are linked in the seat directory |
| `settings` | The base settings, the per-role overlay (`settings/<role>.settings.*`) and, optionally, the paths the plugin owns in an existing file |
| `mcp` | The MCP file, how servers are delivered (`launch` or `file`), transports, seed and clear rules |
| `links`, `files` | Files linked from the user's own setup (logins, project history), and files composed per role |
| `modelCatalog` | A command whose model list is patched and written as the agent's catalog |
| `stateWrites` | Where the seat's writable state paths go, and whether at launch or in the settings file |
| `projectContextOption` | A provider option that receives the working directory, so the agent reads the project's instructions |
| `steers` | Whether mail may be steered into a running turn |
| `exitPattern` | How this agent writes a failed exit in its output, so the watch can tell a failure from a result |
| `refused` | How this agent says a call was refused, read when a silent turn is judged. No shipped harness sets it, so all four use the default pattern |
| `modes` | The modes Paseo can list without launching the agent. An `acp` harness must give them, and `provider.profileModeId` must name one |
| `checks` | Files the Health tab looks for, with a hint |
| `models`, `hasThinking` | The models offered in the panel, and their thinking levels |
| `provider` | Env, launch command, `forceFlags`, and the mode a seat starts in |

Only the Claude harness sets `projectContextOption`; only Devin sets `exitPattern` and `modes`; only
Claude and Codex declare `stateWrites`; only Codex has `files`.

### What each seat gets

At `agent.create`, `Seating.ensure` builds the seat directory
`<profileRoot>/sw2-<role>-<agent>-<slug>`, unless it was already built at the current settings
revision, its settings file is still there, and every link whose target exists is present — so a
login made after the seat was built causes a rebuild. Nothing is written unless the whole seat can be
built. Then `applyRole` shapes the launch:

- **Model and thinking:** the chosen model, or the catalog default, with a valid thinking level.
- **Mode:** the harness's `provider.profileModeId`, where it declares one.
- **System prompt:** the rendered role prompt, for agents that take it in config.
- **MCP servers:** the role's servers, for agents that take them at launch.
- **Provider options:** the sandbox's writable state paths for agents that take them at launch,
  which is Claude Code only. Codex gets them in `config.toml` when the seat is built. Pi and Devin
  have no sandbox, so nothing limits what they write. For Claude the working directory also goes in,
  at `projectContextOption`.

At `agent.session_open`, `seatEnv` sets the config-directory variable to the seat directory, plus
`SEATWORKS_ROLE`, `SEATWORKS_PROJECT` and `SEATWORKS_STATE`.

| Agent | Seat directory | Written there | How it launches |
|---|---|---|---|
| Claude Code | `~/.claude/profiles/…` | `settings.json` (deny rules, sandbox), `.claude.json` (its own MCP servers cleared), `skills/`, a `projects` link, and `CLAUDE.md` when there are working rules | Through `bin/seat-room`, which forces `--setting-sources user`, so the project's settings, hooks and skills stay out |
| Codex | `~/.codex/seats/…` | `config.toml` (`workspace-write` with network access, or `read-only` for the Reviewer, `approval_policy = "never"`, Codex's own subagents and bundled skills off, `model_catalog_json`), `model-catalog.json`, `rules/seatworks.rules`, `skills/`, an `auth.json` link, and `AGENTS.md` when there are working rules | Paseo's Codex provider, which starts a `codex app-server` for each seat |
| Pi | `~/.pi/seats/…` | `settings.json` (the `pi-mcp-adapter` package, project trust off, and a tool list for the Reviewer), `mcp.json`, `skills/`, links to the login, model store and npm folder, and `AGENTS.md` when there are working rules | Paseo's Pi provider. MCP reaches Pi only through `pi-mcp-adapter` |
| Devin CLI | `~/.devin/seats/…` | `devin/config.json` (permissions, command denials, Devin's own subagents off, and reading Claude, Cursor and Windsurf config switched off), `devin/AGENTS.md` (prompt and rules), `devin/mcp_config.json`, `devin/skills/`, and a link to your own git config | Through `bin/seat-room acp`, over Paseo's ACP provider |

Building a Codex seat asks `codex debug models --bundled` for its model list, so a machine without
the Codex CLI cannot build one at all.

Devin's config-directory variable is `XDG_CONFIG_HOME`, so pointing it at the seat directory moves
everything that reads it. The `git` link is what keeps your own git identity inside a Devin seat; a
machine with no `~/.config/git` gets no link, and that seat commits as whoever it resolves to.

A Claude seat still reads the project's `CLAUDE.md` and `.claude/rules`. The working directory is
passed in the `additionalDirectories` option, and `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`
makes Claude read `CLAUDE.md` from added directories.

`bin/seat-room` refuses a launch when `SEATWORKS_AGENT_BIN` is unset, `jq` is missing, the harness
file cannot be read, or the config-directory variable is empty. It checks only that the variable is
set, so a value the daemon inherited from its own environment would get through. A Claude seat exits
with the reason; a Devin seat instead gets a stand-in ACP server built from the harness's own modes,
which answers the handshake and returns the reason for every other call, so it is readable in the
session rather than a dead launch. `seat-room` also forces the harness's `forceFlags` onto the
command line, replacing any value already there. For Claude that flag is `--setting-sources user`.
Paseo fixes Claude's setting sources itself and drops extra arguments from a provider's command, so a
launcher is the only way to set it. Codex and Pi seats do not go through `seat-room`; they rely on
`agent.session_open` to set the variable.

### Content

Role prompts and working rules may use two placeholders, `{{guides}}` and `{{state}}`. Any other
placeholder fails the seat build. So does a word from the role's `hidesWords`, which is looked for in
the prompt, in the whole working-rules text — your own rules included — and in every markdown file of
every skill the seat is given: the Peer's prompt, for example, may not say "seat". A skill is linked
as it is written, so a skill holding any placeholder is refused; skills refer to `$SEATWORKS_STATE`
instead. This is also why an ordinary line in your own `rules` can be refused at the settings screen.

On Claude Code and Codex, the sandbox lets a seat's shell write under the project's state only where
its prompt, skills and rules say `{{state}}/…` or `$SEATWORKS_STATE/…`. A role that can `lead` also
gets `docs/`, for the project pages, and the desk's own files are never granted. In the shipped kit
that comes to three folders and `notebook.md` for the Supervisor, and five folders for the Lead; a
Peer or Reviewer names none, so its shell writes nothing under the state at all. This binds only the
shell. Claude's file tools are kept off the desk's files by deny rules. Pi and Devin seats have no
such limit.

## The desk

![A lane, end to end](images/lane-lifecycle.svg)

### The ledger

Each project has one `ledger.json`, at version 1, holding `lanes`, `tasks`, `asks`, `agents`, `slots`
and the counters ids come from. Every change goes through a per-project lock that loads, applies and
saves. A ledger that cannot be read, or has the wrong version, is refused rather than treated as
empty. Incidents live beside it in `incidents.json`, under the same discipline and its own lock.

| Record | States | Ids |
|---|---|---|
| Lane | `open`, `closed` | `L<n>` |
| Task | `running`, `done`, `rework`, `queued`, `merging`, `merged`, `failed`, `cut`, `stalled` | `<lane>-T<n>` (code), `<lane>-R<n>` (review), both from one counter per lane: a review started after `L1-T1` is `L1-R2` |
| Ask | `open`, `answered` | `A<n>` |
| Incident | open until it is marked | `I<n>` |
| Slot | A git worktree held by a lane or task | `S<n>`. A released id is never reused; a slot left free by a failed setup is handed out again under its id |

### Verbs

A seat's call runs only if its Paseo provider maps to a role whose tool set in `mcp/tools.json` holds
the verb, and the role its bridge names is that same role. Inside the verbs, behaviour depends on
what the role **can** do, never on its name. The capabilities are `supervise`, `lead`, `work`,
`write`, `review` and `watched`, in `roles.json`. `open_lane`, `start_task` and `start_review` each
take an optional `role`, which picks between roles holding the same capability.

| Verb | Held by | Effect |
|---|---|---|
| `open_lane` | Supervisor | Records the lane, takes a working copy and seats a Lead with an owner directive; taking the project's own copy needs it clean of uncommitted and untracked files. It can read a GitHub issue, and one it cannot read is a note in the reply rather than a refusal. It refuses a lane whose declared write set overlaps an open lane's, or reaches a path the project keeps to one writer that an open lane could also write. A lane that declares nothing is not checked — and counts as writing every such path |
| `close_lane` | Supervisor | Waits for every merge the project has queued. With `land`, it runs the lane gate and lands the branch; it refuses instead of closing when the lane worked in the project's own copy, the base has moved on and a seat is still mid-turn there. It then cuts leftover tasks, archives their seats and the Lead, and puts the copy away |
| `set_project` | Supervisor | Sets, in the project's own `project.json`, the base branch and the gate command, its timeout (30 minutes by default) and whether it runs per lane or per task, plus the serial-only paths and the template pages to place. An empty gate is an answer, and the desk never detects one over it |
| `start_task` | Lead | Seats a writing role on a task. In lane mode, the default, it shares the lane's copy and branch. In parallel mode it gets its own slot and `task/…` branch |
| `start_review` | Lead | Seats a reviewing role, read-only: in the task's own copy while that copy is still its, otherwise in the lane's. The brief says where the change is — this copy, the merge that carried it, or the task branch — and a change with none of those left is refused |
| `accept` | Lead | Lane mode: marks the task merged in place, tells the Lead in a MERGED letter and retires the Peer. Parallel: queues it for the merge queue |
| `rework` / `cut` | Lead | Sends the task back with a letter, refused while another task holds the lane copy — or stops it, archives its Peer at once, and resets the lane copy to where the task started when nothing merged there since |
| `report` | Lead | Reports to the Supervisor. With `ready`, it runs the lane gate first and puts the result in the report. With nobody supervising seated, the report is kept in `events.log` and the Lead is told there is nothing to wait for |
| `ask` | Lead, Peer, Reviewer | A Lead asks whoever supervises; a Peer or Reviewer asks its Lead, or whoever supervises when the Lead is gone |
| `done` | Peer, Reviewer | Writes a hand-back file and mails the Lead, or whoever supervises if the Lead is gone. On a project that gates each task it runs the gate first, and the verdict goes into the hand-back. A task already accepted, queued or cut is refused |
| `message` / `answer` | Supervisor, Lead | A Supervisor's `message` goes to a lane or a task, a Lead's only to a task in its own lane; a seat stopped on a question takes it as that question's answer. `answer` closes an open ask: a seat that supervises may answer any, anyone else only its own |
| `incidents` / `ack` | Supervisor | Lists the fifty most recent incidents still open or unmarked, with the brief each seat was working to and a count of any older ones; `ack` marks one `useful`, `noise` or `unknown`, with an optional note, and closes it |
| `status` | Supervisor, Lead | The lanes, tasks, working copies and open asks; a Lead sees its own lane. Held mail and seats waiting on the Human are in `status.md` and the panel, not here |

A call still running after 240 s is answered with "the answer arrives as mail", and the result follows
as a letter. An identical call that is already running is joined rather than run twice.

### Working copies, merges and gates

- A lane works in the project's own checkout, switched to `lane/<id>-<title>`. If it asks to be
  isolated, or another lane already works in place, it gets a worktree slot at
  `~/.local/share/seatworks-v2/worktrees/<slug>/S<n>`, with its own Paseo workspace.
- One lane-mode task holds the lane copy from the moment it starts until it is accepted or cut: a
  hand-back does not release it, because rework wakes that Peer in the same directory. A second task,
  and rework on a second task, are refused while it holds. Parallel tasks get slots of their own.
- One merge queue per project merges accepted parallel branches into their lane's copy, one at a
  time, whichever lane they belong to. Each ends `merged`, or `rework` on a conflict, or `failed`. If
  the lane copy is dirty, the task goes back to `done`. No gate runs inside the queue: where the
  project gates tasks, the Lead already had that verdict with the hand-back.
- Gates write logs under `<state>/gates/`. A task gate's result goes with the hand-back, and the
  MERGED letter repeats it. A lane gate's result goes in the Lead's report. `close_lane` mentions a
  gate only when it is red. It then refuses to land, quoting the output, unless the Supervisor passes
  `overGate`. In that case the reply notes the red gate and the override is written to `events.log`.
  A project with no gate set is not checked.
- Teardown waits for seats that are still mid-turn. The ledger records the pending release
  (`Slot.releasing`, `Lane.restoring`), which finishes when that seat's turn ends or on a later
  patrol round, so a daemon restart does not lose it. Your own checkout is switched back to base and
  the lane branch is kept. A cut parallel task's own branch is dropped when the lane already has its
  commits, and otherwise kept and named in the reply. The only branch the desk deletes by itself is a
  lane branch nothing was committed to, when `open_lane` failed after taking the copy.

A lane may also be opened as a **detour** of another open lane (`detourOf`). Its Lead is told to do
only what the waiting lane needs, and when the detour closes the waiting lane's Lead gets a CLEARED
letter saying the work is not on its branch yet.

### Letters

Everything the desk sends is one file, `desk/letters.ts`, and everything waiting for one seat goes out
as a single message with its open asks listed underneath.

| Kind | Letters |
|---|---|
| Opening a seat | OWNER DIRECTIVE, TASK, REVIEW |
| Between seats | MESSAGE, RECONCILE, ASK, ANSWER to your ask, ANSWERED FOR YOU, STILL OPEN, UNANSWERED |
| Work moving | HANDBACK, REWORK, STOP, MERGED, MERGE FAILED, MERGE CONFLICT, REPORT, CLEARED |
| The desk noticing | SILENT, FAILED, WAITING FOR PERMISSION, LANE IDLE, INCIDENT, the bare nudge |
| Answering late | ANSWER to your `<tool>` call |

### The rules the concept asks for

- **No hidden command chain.** When a Supervisor messages a Peer directly, the Lead first gets a
  RECONCILE letter carrying what was sent and what is still its own. If the lane has no live Lead,
  the message is refused.
- **Answers for someone else.** Only a seat that supervises may answer an ask addressed to another
  seat. That seat is told first, in an ANSWERED FOR YOU letter carrying the question, the answer and
  who gave it; a Lead is also told the task is still owned by the same Peer and still its to accept.

## Tool calls in, letters out

![Tool calls in, letters out](images/calls-and-mail.svg)

### The spool

Every seat with a tool set gets a stdio MCP server named `team`, run as
`node plugin/mcp/team.mjs <role> <tool set> <spool>`. It lists that set's tools from `tools.json`.
For each call, it writes `spool/requests/<id>.json` through a temporary file and a rename, then polls
`spool/replies/<id>.json` every 250 ms for up to 300 s; past that it tells the seat the desk is
probably not running, to leave the call alone and to end its turn naming it. The daemon drains the
spool every 500 ms, answers each request through the desk, and writes the reply the same way. It
drops requests older than 10 minutes, and with them any reply no seat took.

### The outbox

Letters live in one `~/.local/share/seatworks-v2/outbox.json` shared by all projects. A letter with
the same key to the same reader counts as a duplicate while an earlier one is still waiting, and for
30 minutes after it was sent. That memory lives in the daemon process and is lost on restart. When a
seat is pumped, every letter waiting for it goes out as one message, together with its open asks.

| Situation | What happens |
|---|---|
| Paseo cannot look the seat up | held |
| The seat is archived | never sent; the letters age out |
| The seat has a pending permission | held, steerable or not |
| The seat is running, its agent `steers`, and this desk saw the turn start at least 60 s ago | **steered** into the running turn |
| The seat is running or starting | held |
| The seat was sent mail less than 10 minutes ago, with no turn end since | held |
| Otherwise | sent |

The 60 s wait exists because Paseo replaces the running turn when the agent cannot take a steer yet,
and that is the interruption holding avoids. A turn that started before a daemon restart is never
steered.

Mail is pumped from three places: posting a letter, a turn ending, and the end of a patrol round. A
letter still waiting after 7 days is dropped the next time any letter is posted, and the drop is
written to the daemon log.

### Permission requests

| Seat | Where its request goes |
|---|---|
| Lead | A letter to whoever supervises |
| Peer or Reviewer on a task | A letter to the lane's Lead |
| Supervisor | One line in `attention.log`, and listed in `status.md`. The Human answers it in Paseo |
| Peer or Reviewer with no task | Nowhere; it shows only in Paseo |

A question's letter lists the questions and their options. The owner answers with `message`, and the
desk answers the question in Paseo on the seat's behalf. Any other kind of permission can only be
answered by the Human, and every letter to that seat waits meanwhile.

## Reading turns

At every turn end, `TurnRules` reads the turn's timeline mechanically. It never calls a model.
Canceled turns, and seats without a tool set, are skipped. A turn whose start this process never saw
is read as having started 30 minutes ago.

- **Failed turns** are reported to the seat's owner: a Lead's to whoever supervises, a Peer's or
  Reviewer's to its Lead. A Supervisor has no owner, so its failed turn is reported to nobody.
- **Silent turns** of a Peer or Reviewer on a task, with no desk call recorded and none in flight, get
  a nudge. Any desk call keeps a turn from counting as silent, but the count resets only on `done`,
  `ask`, `answer`, `message` or `report` — for a Peer, its hand-back or an ask. The first silent turn
  nudges the Peer itself; on the second the task is marked `stalled` and the Lead is mailed. It also happens on
  the first, if the turn ended on a call that was refused or never finished, with at most 200
  characters said after it. A stalled task goes back to `running` the next time its Peer calls the
  desk at all.

## Watching Leads and Peers

![What the watch sees](images/watch.svg)

Every live seat whose role can be `watched` — the preset gives it to Lead and Peer, never to a
Reviewer — is followed through one timeline subscription, opened when the seat is created or first
seen by the patrol, and closed when it is archived.

### The stream

Paseo 0.8 delivers a timeline as a live subscription plus a paged history, and the reader in
`core/stream.ts` joins them: it subscribes, then seeds from the last 200 rows, fills any gap in the
sequence with a refetch, and reseeds when the epoch changes or the cursor goes stale. A row that
carries no turn id is replay: it updates the window and raises nothing, which is how a reload's
re-sent history stays quiet. Plugin rows are dropped.

Rows fold into a window per seat, keyed by call: at most 80 units — calls, what was said, what was
thought, instructions, errors and compactions — and the oldest goes when the 81st arrives. That
window, not the sensor's size limit, is the real ceiling on what anything here can see.

### Facts

Facts are read in code, never by a model:

| Fact | Level | Fires when |
|---|---|---|
| destructive | page | a shell command matches the destructive pattern, at the first row that carries the command, while it still runs |
| stuck | attend | one of OpenHands' four patterns in the last twenty steps since the seat was last told something: the same action and result 4 times, the same action failing 3 times, the same words 3 times, two actions alternating 3 times |
| no-recovery | attend | ten steps after a failed shell command, neither the same program nor the gate has passed |
| test-weakened / suppressed | attend | an edit takes assertions out of a test or adds a skip marker, or adds a suppression such as `@ts-ignore` |
| unverified | attend | a Peer's turn ended with a hand-back carrying no gate result, and the turn wrote files in its own copy without running the gate after the last of them. It needs a gate command set |
| long-turn | attend | a turn runs past `longTurnMinutes`, or past three times this seat's median turn once it has ended five of them, whichever is longer. The patrol checks it |
| call-failed / gate-failed / outside-scope | note | a call failed; the gate command failed; a write left the seat's working copy or the paths its task declared. Evidence for the sensor, never an incident alone |

A `page` is sent at once and never waits for the sensor; an `attend` incident is subject to the
sensor's judgement and to the day's budget; a `note` is only ever evidence. A failure counts however
the harness reports it: a failed status, a non-zero exit code, or an output
matching the harness's `exitPattern`. Devin reports only `Exited with code N`, which is why two of the
four stuck patterns — the two that compare results — are skipped there. Rows Paseo marks synthetic,
and plain terminal output rows, are not evidence of anything and are skipped.

Facts are deduplicated per turn, and the last twenty are kept for the sensor.

### What a lane's history shows

A window is eighty steps from the last instruction, and a letter restarts it, so nothing that takes
more than one turn can be seen there. The patrol reads the ledger it already holds for those shapes,
in `runtime/watch/history.ts`: `rework-loop` (one task past `attention.reworksAt` sendings-back),
`patched-not-fixed` (that many spread over two or more tasks in a lane), `reviews-unconverged`
(`attention.reviewsAt` reviews of a target still neither accepted nor cut), `certainty-only` (a
review's focus asking for only what it is sure of), `brief-prewritten` (a code task's brief
carrying a code fence, or steps with a file and a member name) and `accepted-unfinished` (a task
merged whose Peer handed it back `partial` or `blocked`, or that was merged having never handed back
at all — `accept` refuses only a task already merged, queued, merging or cut).

The seat named is the lane's Lead, because each is something a Lead decides, and a lane whose Lead
has gone raises nothing: an incident about a seat that is not there is one nothing would ever close.
One fact of a kind per lane, never one per task, because the book keys an incident by seat and kind
and a second one would land as an afterword on the first. These are standing conditions rather than
episodes — three sendings-back stay three — so the quote is the whole of what was counted and the
patrol asks the book whether it has said those words before; a condition already on the book is
sighted again, so a day's budget or a watch that is off does not lose it, and one already marked is
left alone until the record says something new. They go through the same incident book as what the
watch reads from a timeline, so `incidents`, `ack` and `calibrate` treat them alike.
`docs/ANTIPATTERNS.md` says which of the shapes a team goes wrong in each of these answers.

### The sensor

With the sensor's key set — under Watch on Machine defaults, or as `sensor.key` in the machine
settings — the sensor in `catalog/sensor/` (Jev through OpenRouter Decisions) is asked about a seat
five seconds after it goes quiet, at least every thirty while it works, and at once when a call or
the gate fails, when something irreversible is seen, when a turn ends, or when a permission is
asked. One seat is never assessed twice at once.

The state it is sent has seven fields: the task or lane brief, the instruction the turn serves
however long ago it arrived, the seat's role, the project's gate command, whether the turn is
running, the steps, and — once the turn has ended — the words it ended on. Each step shows the end of
what it printed, or its error; an edit shows what it changed; a tool with no command or path shows
what it was given. Secrets are masked before anything is cut, and the state stays within the
sensor's size, most of it given to the steps. No fact, finding, score or earlier answer is in it, so
the sensor agreeing with a fact is a second opinion and not an echo. A seat whose brief cannot be
read is not asked about, and a question whose `needs` fields are all empty is not asked; if that
leaves no questions, nothing is sent. Nor is a question marked `whole`, whose finding rests on a step
not being there, asked of a state that says steps were left out: the step it looks for may be in the
hole. Saying so in the state does not cover it — measured against the shipped sensor, adding that
line to an otherwise identical state moved those answers by -0.05, 0.00 and +0.01, leaving a seat
that did check reported at p≈0.86 on a turn long enough to lose the checking.

Each question names state fields, asks what the state shows, has yes as the finding, and may carry
`criteria`. What its answer does depends on how it is tied, and a question tied to nothing — four of
the fourteen the shipped sensor asks — is recorded and does nothing else:

- `alone`: it opens its own incident. At `attend` it needs two readings in a row at or over its
  threshold, in the same turn and under the same instruction — a letter landing mid-turn starts the
  count again, since the subject it asked about has changed — or one taken after the turn ended,
  since no other follows; a reading in the
  `unclear` band raises nothing. At `page` one reading is enough, and a reading in the band just under
  the threshold is raised at `attend` rather than let pass — and a page that follows is sent as a
  page, not folded into the attention already sent.
- `agrees`: it opens its own incident when one of the named facts was noted when the state was taken.
- `confirms`: it opens nothing of its own. It judges the open incident of a named attention-level
  fact: at or over the threshold it confirms, in the band it is unsure, under the band it disagrees.

The shipped sensor asks fourteen questions. Seven stand alone: `needs_human`, `unsafe_action`,
`missing_mechanism`, `wrapped_instead_of_changed`, `proof_changes_product`, `proves_the_old_is_gone`
and `agreed_without_checking`, of which `wrapped_instead_of_changed` and `agreed_without_checking`
are marked `whole`. `goal_drift` and
`unverified_success` need a fact to agree, `worker_stuck` only confirms `stuck` and `no-recovery`,
and `injected_intent`, `guessed_ambiguity`, `admits_error` and `changed_direction` are recorded only.
A `sensor.json` the loader cannot make sense of — an unknown field, a url that is not https, a
threshold on a question nothing decides, a `whole` on one nothing decides, a `confirms` naming a fact
that is not attention-level — fails the plugin's load with the problem named.

A sensor that will not answer is not an incident: 429 and 5xx are retried, and a failure is written
as `sensor.degraded` at most once a minute. With no key at all, one `sensor.off` line is written per
project and nothing is ever asked.

### Incidents

Each finding joins the open incident for its seat and kind in `incidents.json`, or opens one. An
incident is sent once, as an INCIDENT letter to whoever supervises the project, and is quiet after
that; a sighting after it was sent is kept beside it and shown when it is marked. Until it is sent it
is decided again on every sighting and every judgement:

| Held | Meaning |
|---|---|
| shadow | `attention.watch` is off, which is the default. Nothing is ever sent |
| awaiting | a question can judge this fact and has not yet. It waits up to two minutes from the last sighting, then goes anyway |
| vetoed | the sensor disagreed. It is kept, and sent if the sensor later agrees or a new sighting goes unjudged |
| budget | `incidentsPerDay` attention-level incidents have been sent in the last 24 hours. The patrol does not retry it: the next sighting decides again, by which time the window has moved |
| nobody | nobody is seated to tell, or the only candidate is the watched seat itself. A patrol round retells it |

A page never waits for the sensor. Archiving a seat closes its open incidents, which still wait to be
marked; closed ones are forgotten oldest first past 500.

The Supervisor lists them with `incidents`, on the schedule it sets itself with Paseo's own heartbeat
tools as well, since held ones never arrive as mail. The list gives each incident's kind, level, where it happened, the quote, why it was not sent,
and the brief the seat was working to. It marks each `useful`, `noise` or `unknown` with `ack` from
the agent's own record; any of the three closes it, and only `useful` and `noise` tune anything.
Neither the letter nor the list carries a score, a model or a verdict, so the marks measure the
sensor rather than echo it — though the list does say when one was held for it. A note is masked
before it is kept. Nothing the watch concludes goes to the seat it watches, and the Supervisor's
prompt keeps it from passing any of it on.

### Keeping and calibrating

Every assessment is kept in `assessments/` with its state, the questions and criteria as asked, the
facts noted, the answers, the findings and the judgements. `current.jsonl` rotates when it would pass
32 MiB; rotated files are gzipped and pruned to the newest 64.

`node bin/calibrate.ts <project or its state directory>` reads them against the marks on incidents,
which the `incident.ack` event keeps in `events.log` after `incidents.json` has forgotten the
incident itself, counting only answers given
to the wording in use. For each question it reports AUROC — on its own incidents, or on the ones it
judged — how often it fires in its busiest 24 hours, and, for an attention-level question, the most
sensitive threshold within the day's budget were it the only thing firing. Each block ends in a
verdict: keep it, make it label-only, stop it holding incidents back, or not enough marks to judge.
It then reports all of them together with the incidents code facts opened, and how precise the
incidents were in the end, split by who raised them and what the sensor said.

`--ask` asks the current questions again against the kept states, at one call each. `--limit N` keeps
the newest N assessments, `--per-day N` replaces the day's budget, and `--model ID` keeps only what
one model version answered — a threshold tuned on one version does not carry to another. `--sample N`
offers turns nothing was raised on, and `--missed ID` or `--fine ID` marks them, which is the only
part of the report that says anything about what was never raised.

## The patrol

The patrol runs every `tickSeconds`, 30 s by default, and rounds never overlap. Each round reads the
open seats, follows the watched ones it does not know yet, lets go of the gone, and checks every watch
for a long turn. Then for each project, each step guarded on its own so one broken project does not
stop the round:

- mails the Supervisor about idle lanes
- sends the incidents that were held: ones waiting on the sensor, ones it disagreed with, and ones
  there was nobody to tell
- marks tasks whose Peer is gone
- reminds, re-addresses or escalates open asks: a STILL OPEN letter every `askRemindMinutes` up to
  `maxReminders`, an ask whose reader has gone re-addressed to whoever supervises now, and, once the
  reminders run out, a Peer's ask escalated past its Lead as UNANSWERED
- sweeps stray workspaces and worktrees
- finishes held teardowns
- writes `status.md`

On its first round it also looks once at every project on record with no live seat, to finish a
teardown a restart lost. Then it pumps every seat that has mail.

## Settings

There are two JSON layers. For any single value the project layer wins, but rules from both layers
are joined, machine first.

- **Machine:** `~/.local/share/seatworks-v2/settings.json`
- **Project:** `~/.local/share/seatworks-v2/projects/<slug>/settings.json`

A layer can set the following. Unknown keys are refused.

- each role's agent, model, thinking level and rules
- MCP servers: on or off, for which roles, with which settings — and a new name, a pasted connection,
  a replacement rule, per-role tool lists, or removal
- rules for every seat
- the Flow switch and its interval
- the attention values
- the sensor's key, in the machine layer only

Only the agent, model, thinking level, MCP servers, the Flow switch, `attention.watch` and the
sensor's key have a control in the panel. The rules and the other attention values are written into
the file by hand.

The key is the one setting a read does not hand back. `readSettings` replaces it with the word
`KEPT` from `shared/rpc.ts`, in the layer it returns and in the machine layer a project screen is
given, and `writeSettings` puts the stored key back under any save that carries that word. A write
is the whole layer, so this is what keeps the key through a save about something else; a layer with
no `sensor` block at all is the owner forgetting it, and `settings.reset` is not that — it puts the
layer back to the kit's and leaves the key. A file that will not parse is reported by the place the
parser stopped at and never by what it read, because that text is as likely to be the key or a
server's token as anything else, and it is shown on the settings screen, in the team's errors and in
the health report.

A save carries the revision it was read at, a hash of the parsed content with its keys sorted. If the
file has changed since, the save answers `conflict`. A file that does not parse is never overwritten.
A save is refused if its team does not resolve, or if it would make a buildable seat unbuildable — a
word a role may not see, in your own rules, is refused here. A machine-layer save also reconciles the
Paseo providers; a project-layer save does not.

| Attention value | Default |
|---|---|
| `tickSeconds` (a project may set it, and only the machine layer's is read) | 30 |
| `leadIdleMinutes` | 12 |
| `askRemindMinutes` / `maxReminders` | 15 / 2 |
| `watch` | false |
| `incidentsPerDay` | 5 |
| `longTurnMinutes` | 30 |
| `destructive` / `testPath` / `suppressed` / `repeatsAt` | patterns and 3 |
| `reworksAt` / `reviewsAt` | 3 / 3 |

A pattern that does not compile is refused at save time.

**Replacing the preset.** A `roles.json` in `~/.local/share/seatworks-v2/` replaces the shipped one
whole, including its provider prefix and its attention block. A role there may point at its prompt
and skills by absolute path, though `extraSkills` are always read from this package. A role needs no
tool set — one without it simply gets no desk tools — but each role name still needs:

- its settings files under `plugin/harness/<agent>/settings/`
- the Codex rules file, for Codex
- a tool set that `plugin/mcp/tools.json` defines, if it has one

With the prefix empty, the plugin stops cleaning up its own stale entries in `~/.paseo/config.json`.

## MCP servers

| Server | Kind | What it gives |
|---|---|---|
| `team` | Always there, for each seat with a tool set | The desk verbs in the role's tool set |
| `intellij-index` | Proxy over HTTP to a JetBrains IDE | Code-index tools per role |
| `code-search` | Proxy over stdio (`uvx … semble`) | One `search` tool |
| `context7` | Plain HTTP server, no key | Library documentation. Queries leave the machine |

Catalog servers stay off until a settings layer switches them on for some roles. Each proxied entry
runs through `plugin/mcp/code.mjs`, which can do six things. Each is switched on by the entry's
`proxy` block:

- pin every call to the seat's git root, and hide that argument from the schema the seat sees
- send changed files to the backend before a call
- open the working copy in the backend when a call says it is not open
- wait out indexing
- rewrite known errors
- replace a tool's description with the entry's own wording

`intellij-index` pins, syncs, waits out indexing and rewrites errors; `code-search` pins, and
rewrites what `search` says it is for. When the backend does not answer while tools are being listed,
the proxy still lists them, each with the reason it will fail and a placeholder schema, so a seat
reads why rather than finding an empty server. For `intellij-index` both the desk
and the proxy add `.idea/` to the repository's `.git/info/exclude`, and the desk syncs a reused
working copy when it hands one out. Each server's `rule.md` and tool list go into the seat's working
rules, and its skills are linked into the seat.

## The panel

`index.client.tsx` adds a **Seatworks** sidebar item. It opens on a list of projects, with a
**Machine defaults** row and an **Add project** dialog: Repository, Team, then Check, which is a
summary of what will be saved and runs nothing. Machine defaults and every project open the same four
tabs, though on Machine defaults Flow only sets the live switch and its interval, and Health has the
machine's checks without a project's status report:

- **Team:** the agent per role, its model where the agent offers more than one, and its thinking
  level where the agent has one — then **Watch**: whether what it marks is mailed to the Supervisor,
  and, on Machine defaults, the sensor's key
- **Flow:** Supervisors, lanes, tasks and open asks, polled with a revision so an unchanged view is
  not sent again, and drawing at most 50 open lanes
- **MCP:** switch servers on or off, choose their roles and options, add one from a pasted snippet
- **Health:** the checks for this machine and, on a project, the status report built from the ledger
  as it is now — which is not the `status.md` the patrol writes, and carries the held mail and the
  seats waiting on the Human as well

Detaching a project removes its settings and its record of itself, and leaves the ledger, the
incidents, the assessments and the logs where they are. It is refused while a lane is open, a lane is
still restoring, or a working copy is checked out.

The client talks to the server only through the `seatworks.*` RPCs in `shared/rpc.ts`, and it uses 13
of the 14 (`settings.reset` has no button). It also reads Paseo's own project list. Nothing is pushed
to the client: it reloads after every save, and the Flow tab polls.

## State on disk

```
~/.paseo/config.json                      providers sw2-<role>-<agent>, agent profiles
~/.local/share/seatworks-v2/
  roles.json                              optional; replaces the shipped preset
  settings.json                           machine settings layer, including the sensor key
  outbox.json                             waiting letters, all projects
  spool/requests/  spool/replies/         seat tool calls
  guides -> plugin/content/guides
  worktrees/<slug>/S<n>/                  isolated working copies
  projects/<slug>/                        slug = repo folder name + 6 hex chars of sha1(root)
    meta.json  settings.json  project.json
    ledger.json  incidents.json
    assessments/current.jsonl  assessments/<n>.jsonl.gz  assessments/spot-checks.jsonl
    events.log  attention.log  status.md
    handbacks/  gates/  docs/  notebook.md
<profileRoot>/sw2-<role>-<agent>-<slug>/  one seat directory per role, agent and project
```

`events.log` is the provenance record. It has one JSON line per tool call and per lane, task, merge,
gate and slot. The watch writes its own kinds there and nowhere else: `watch.fact`, `watch.finding`,
`watch.sensor`, `watch.unbriefed`, `watch.offline`, `sensor.off`, `sensor.degraded`, `sensor.unkept`,
and for incidents `incident.open`, `incident.judged`, `incident.held`, `incident.told`,
`incident.read`, `incident.ack`, and the two ways delivering one can fail, `incident.lookup-failed`
and `incident.post-failed`. A sensor that is misconfigured or unreachable shows up there, and nowhere
in Health.

## Testing

`cd plugin && npm run check` runs `tsc` over the server and the client, then `node --test` over
`test/**/*.test.ts`. The tests drive the desk, the outbox and the runtime through fake ports. A
real-kit test builds every role on every shipped agent. It builds the Codex seats only where `codex`
is installed, because building one asks Codex for its model catalog. No test launches a seat.

Two commands sit outside it. `npm run eval:triggers -- --agent "…"` calls a real agent.
`node bin/calibrate.ts <project>` reads a real project's kept assessments, and calls the sensor only
with `--ask`.

## Known limits

- **Devin cannot be steered.** Mail to a running Devin seat waits for its turn to end.
- **Pi and Devin have no sandbox.** Pi has no command rules either, and the preset narrows tools only
  for its Reviewer, so a Pi Lead, Peer or Supervisor runs Pi's own defaults. Devin's roles are limited
  by permission denials, which include commands such as `git push` and `gh`, but it has no path rules.
- **Codex command rules match argument prefixes**, so `git -C <path> push` is not caught.
- **A steer Paseo cannot hand over replaces the turn** rather than waiting, which is the interruption
  the 60 s wait exists to avoid. A Claude seat that is compacting refuses a steer the same way.
- **A turn that was running before a daemon restart** is never steered, only held, and is read as
  having started 30 minutes ago.
- **A project-layer settings save** does not rewrite the Paseo providers, so the defaults they show
  come from the machine layer.
- **The watch cannot see a sub-agent.** What a seat's own sub-agents do is not on its timeline, so no
  fact is read from it.
- **Nothing checks the sensor.** Health does not look at the key, the endpoint or the watch switch;
  `events.log` is where a sensor that will not answer shows up.
