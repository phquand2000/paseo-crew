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
| `plugin/server/core/` | Ports (`Seats`, `Workspaces`), the Paseo adapter, atomic JSON and TOML stores, `git`, the gate runner, paths |
| `plugin/server/catalog/` | Data to seats: the kit loader and harness contract, team resolution, providers, seat directories, launch config, content rendering |
| `plugin/server/desk/` | The ledger and the verbs seats call: lanes, tasks, asks, working copies, merge queue, gates, letters |
| `plugin/server/runtime/` | The composition root and loops: hooks, spool, outbox, patrol, turn and risk reading, RPC, health checks |
| `plugin/client/` | The Seatworks panel |
| `plugin/shared/rpc.ts` | The typed RPC contracts between the panel and the server |
| `plugin/mcp/` | `team.mjs` (desk tools over stdio), `code.mjs` (proxy for catalog servers), `tools.json` (tool sets) |
| `plugin/roles.json` | The SLP preset: each role's capabilities, tool set, prompt, skills and default agent |
| `plugin/harness/<agent>/` | How each agent is set up: `harness.json`, plus base and per-role settings |
| `plugin/catalog/mcp/<id>/` | Optional MCP servers |
| `plugin/content/` | Runtime content seats read: role prompts, skills, guides, the notebook, page templates. This is not documentation. |

Only `server/core/paseo-adapter.ts` calls the daemon's agent and workspace API (`context.paseo`). The
runtime just registers hooks, events and RPC handlers with the SDK. The desk, the outbox, the patrol
and the settings control depend on the `Seats` and `Workspaces` ports, so the tests drive them with
fakes. The API handle is never kept from boot. It is taken fresh from every hook, event and RPC call,
so opening the panel after a daemon reload also brings the patrol and the spool back.

## Boot

1. Paseo calls `contribute(server)` in `index.server.ts`.
2. The plugin finds its directory from `SEATWORKS_PLUGIN_DIR`, or from `plugins["seatworks-v2"]` in
   `~/.paseo/config.json` when that entry is a directory install. Without one, it logs and stays
   inert.
3. `loadKit` reads `roles.json`, preferring a copy in `~/.local/share/seatworks-v2/`. It also reads
   every `harness/<agent>/harness.json`, the MCP catalog, `mcp/tools.json` and the page templates. A
   harness file with an unknown top-level field, or with a required field missing, fails the load
   with the field named.
4. `Runtime.prepare` creates the state root and the spool, and links `guides/` to `content/guides`.
   It then reconciles the providers.
5. `Runtime.register` sets up the rest:
   - the RPC handlers
   - two hooks that run before a start, on `agent.create` and `agent.session_open`
   - four lifecycle events
   - a 500 ms spool poll
   - a self-rescheduling patrol timer

| Hook or event | What the plugin does |
|---|---|
| before `agent.create` | For a `sw2-` provider, builds the seat directory and shapes the launch config. A seat that cannot be built refuses the launch, with the reason. |
| before `agent.session_open` | Seeds the project's records, rebuilds the seat directory if needed, and points the agent's config directory at it |
| `agent.turn_started` | Records when the turn started, for turn reading and for the outbox's steer rule |
| `agent.turn_ended` | Finishes a deferred archive or working-copy teardown, reads the turn, and pumps the seat's mail |
| `agent.permission_requested` | Mails the request to the seat's owner, or logs it (see [Permission requests](#permission-requests)) |
| `agent.archived` | Forgets the seat's in-memory turn and send timing. Letters already held for it stay in the outbox until they age out. |

## From data to a running seat

![From data to a running seat](images/seat-build.svg)

### Providers

The plugin makes a Paseo provider for every role and agent pair where that role has a settings file
for that agent. The provider is `<prefix><role>-<agent>` (the prefix is `sw2-`), with a matching agent
profile, and its label reads like **Lead · Claude Code (sw2)**. Each provider:

- extends the agent's Paseo base provider
- carries the agent's environment, launch command and models
- carries the Paseo tools the role may use (the role's `paseoTools.allow` becomes a `disabledTools`
  list)

Reconciling runs at plugin start and after a machine-layer settings save. When the wanted providers
or profiles differ from `~/.paseo/config.json`, it rewrites `agents.providers` and
`daemon.agentProfiles` atomically and keeps the file's mode. It deletes `sw2-` entries the kit no
longer produces, keeps env keys the user added, and runs `paseo daemon reload`. When nothing
differs, it leaves the file and the daemon alone. The shipped kit makes 20 providers: five roles on
four agents.

### The harness contract

`plugin/harness/<agent>/harness.json` describes how one agent is set up.

| Field | Drives |
|---|---|
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
| `checks` | Files the Health tab looks for, with a hint |
| `models`, `hasThinking` | The models offered in the panel, and their thinking levels |
| `provider` | Env, launch command, `forceFlags`, and the mode a seat starts in |

A role runs on an agent only if `harness/<agent>/settings/<role>.settings.*` exists, along with every
source its `files` name.

### What each seat gets

At `agent.create`, `Seating.ensure` builds the seat directory `<profileRoot>/sw2-<role>-<agent>-<slug>`,
unless it was already built for the same settings revision. Then `applyRole` shapes the launch:

- **Model and thinking:** the chosen model, or the catalog default, with a valid thinking level.
- **Mode:** the harness's `profileModeId`.
- **System prompt:** the rendered role prompt, for agents that take it in config.
- **MCP servers:** the role's servers, for agents that take them at launch.
- **Provider options:** the sandbox's writable state paths for agents that take them at launch,
  which is Claude Code only. Codex gets them in `config.toml` when the seat is built. Pi and Devin
  have no sandbox, so nothing limits what they write. The working directory also goes in, at
  `projectContextOption`.

At `agent.session_open`, `seatEnv` sets the config-directory variable to the seat directory, plus
`SEATWORKS_ROLE`, `SEATWORKS_PROJECT` and `SEATWORKS_STATE`.

| Agent | Seat directory | Written there | How it launches |
|---|---|---|---|
| Claude Code | `~/.claude/profiles/…` | `settings.json` (deny rules, sandbox), `.claude.json` (its own MCP servers cleared), `skills/`, a `projects` link, and `CLAUDE.md` when there are working rules | Through `bin/seat-room`, which forces `--setting-sources user`, so the project's settings, hooks and skills stay out |
| Codex | `~/.codex/seats/…` | `config.toml` (sandbox, `approval_policy = "never"`, Codex's own subagents and bundled skills off, `model_catalog_json`), `model-catalog.json` (Codex's own model list with native subagents cleared), `rules/seatworks.rules`, `skills/`, an `auth.json` link, and `AGENTS.md` when there are working rules | Paseo's Codex provider, which starts a `codex app-server` for each seat |
| Pi | `~/.pi/seats/…` | `settings.json` (the `pi-mcp-adapter` package, project trust off, tools per role), `skills/`, links to the login, model store and npm folder, and `AGENTS.md` when there are working rules | Paseo's Pi provider. MCP reaches Pi only through `pi-mcp-adapter` |
| Devin CLI | `~/.devin/seats/…` | `devin/config.json` (permissions, command denials, and reading Claude, Cursor and Windsurf config switched off), `devin/AGENTS.md` (prompt and rules), `devin/mcp_config.json`, `devin/skills/` | Through `bin/seat-room acp`, over Paseo's ACP provider |

A Claude seat still reads the project's `CLAUDE.md` and `.claude/rules`. The working directory is
passed in the `additionalDirectories` option (`projectContextOption`), and
`CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` makes Claude read `CLAUDE.md` from added
directories.

`bin/seat-room` refuses to start a Claude or Devin seat whose config-directory variable is empty. It
checks only that the variable is set, so a value the daemon inherited from its own environment would
get through. It also forces the harness's `forceFlags` onto the command line, replacing any value
already there. For Claude that flag is `--setting-sources user`. Paseo fixes Claude's setting sources
itself and drops extra arguments from a provider's command, so a launcher is the only way to set it.
Codex and Pi seats do not go through `seat-room`; they rely on `agent.session_open` to set the
variable.

### Content

Role prompts and working rules may use two placeholders, `{{guides}}` and `{{state}}`. Any other
placeholder fails the seat build. So does a word from the role's `hidesWords`: the Peer's prompt, for
example, may not say "seat". Skills are linked as they are, and refer to `$SEATWORKS_STATE` instead.

On Claude Code and Codex, the sandbox lets a seat's shell write under the project's state only where
its prompt, skills and rules say `{{state}}/…` or `$SEATWORKS_STATE/…`. A role that can `lead` also gets
`docs/`, for the project pages, and the desk's own files are never granted. This binds only the
shell. Claude's file tools are kept off the desk's files by deny rules. Pi and Devin seats have no such
limit.

## The desk

![A lane, end to end](images/lane-lifecycle.svg)

### The ledger

Each project has one `ledger.json`, at version 1, holding `lanes`, `tasks`, `asks`, `agents` and
`slots`. Every change goes through a per-project lock that loads, applies and saves. A ledger that
cannot be read, or has the wrong version, is refused rather than treated as empty.

| Record | States | Ids |
|---|---|---|
| Lane | `open`, `closed` | `L<n>` |
| Task | `running`, `done`, `rework`, `queued`, `merging`, `merged`, `failed`, `cut`, `stalled` | `<lane>-T<n>` (code), `<lane>-R<n>` (review) |
| Ask | `open`, `answered` | `A<n>` |
| Slot | A git worktree held by a lane or task | `S<n>`. A released id is never reused; a slot left free by a failed setup is handed out again under its id |

### Verbs

A seat's call runs only if its Paseo provider maps to a role whose tool set in `mcp/tools.json`
holds the verb. Inside the verbs, behaviour depends on what the role **can** do, never on its name.
The capabilities are `supervise`, `lead`, `work`, `write`, `review` and `watched`, in `roles.json`.

| Verb | Held by | Effect |
|---|---|---|
| `open_lane` | Supervisor | Records the lane, takes a working copy and seats a Lead with an owner directive. It can read a GitHub issue. It refuses a lane that overlaps another open lane's write set or serial-only paths |
| `close_lane` | Supervisor | Waits for pending merges. With `land`, it runs the lane gate and lands the branch. It then cuts leftover tasks, archives their seats and the Lead, and puts the copy away |
| `set_project` | Supervisor | Sets the base branch and the gate command, its timeout and whether it runs per lane or per task. Also sets the serial-only paths and the template pages to place |
| `start_task` | Lead | Seats a writing role on a task. In lane mode, the default, it shares the lane's copy and branch. In parallel mode it gets its own slot and `task/…` branch |
| `start_review` | Lead | Seats a reviewing role, read-only, in the change's copy |
| `accept` | Lead | Lane mode: marks the task merged in place. Parallel: queues it for the merge queue |
| `rework` / `cut` | Lead | Sends the task back with a letter, or stops it and resets or releases its copy |
| `report` | Lead | Reports to the Supervisor. With `ready`, it runs the lane gate first and puts the result in the report |
| `ask` | Lead, Peer, Reviewer | A Lead asks its Supervisor; a Peer or Reviewer asks its Lead |
| `done` | Peer, Reviewer | Writes a hand-back file and mails the Lead, or the Supervisor if the Lead is gone. For a code task on a project that gates each task, it runs the gate first |
| `message` / `answer` | Supervisor, Lead | Mail to a lane or a task; answer an open ask |
| `incidents` / `ack` | Supervisor | Lists the incidents not yet marked; marks one useful or noise and closes it |
| `status` | Supervisor, Lead | The project's status text; a Lead sees its own lane |

A call still running after 240 s is answered with "the answer arrives as mail", and the result follows
as a letter. An identical call that is already running is joined rather than run twice.

### Working copies, merges and gates

- A lane works in the project's own checkout, switched to `lane/<id>-<title>`. If it asks to be
  isolated, or another lane already works in place, it gets a worktree slot at
  `~/.local/share/seatworks-v2/worktrees/<slug>/S<n>`, with its own Paseo workspace.
- One lane-mode task holds the lane copy at a time. Parallel tasks get slots of their own.
- The merge queue merges accepted parallel branches into the lane copy, one at a time. Each ends
  `merged`, or `rework` on a conflict, or `failed`. If the lane copy is dirty, the task goes back to
  `done`.
- Gates write logs under `<state>/gates/`. A task gate's result goes with the hand-back, and the MERGED
  letter repeats it. A lane gate's result goes in the Lead's report. `close_lane` mentions a gate only
  when it is red. It then refuses to land, quoting the output, unless the Supervisor passes `overGate`.
  In that case the reply notes the red gate and the override is logged. A project with no gate set is
  not checked.
- Teardown waits for seats that are still mid-turn. The ledger records the pending release, which
  finishes when that seat's turn ends or on a later patrol round. A branch is deleted only if it is
  already merged.

### The rules the concept asks for

- **No hidden command chain.** When a Supervisor messages a Peer directly, the Lead first gets a
  RECONCILE letter. If the lane has no live Lead, the message is refused.
- **Answers for someone else.** When a seat answers an ask addressed to another seat, the addressee
  first gets an ANSWERED FOR YOU letter.

## Tool calls in, letters out

![Tool calls in, letters out](images/calls-and-mail.svg)

### The spool

Every seat with a tool set gets a stdio MCP server named `team`, run as
`node plugin/mcp/team.mjs <role> <tool set> <spool>`. It lists that set's tools from `tools.json`.
For each call, it writes `spool/requests/<id>.json` through a temporary file and a rename, then polls
`spool/replies/<id>.json` for up to 300 s. The daemon drains the spool every 500 ms, answers each
request through the desk, and writes the reply the same way. It drops requests older than 10 minutes.

### The outbox

Letters live in one `~/.local/share/seatworks-v2/outbox.json` shared by all projects. A letter with the
same key to the same seat counts as a duplicate while an earlier one is still waiting, and for 30
minutes after it was sent. That memory lives in the daemon process and is lost on restart. When a seat
is pumped, every letter waiting for it goes out as one message, together with its open asks.

| Situation | What happens |
|---|---|
| Paseo cannot look the seat up | held |
| The seat is archived | never sent; the letters age out |
| The seat has a pending permission | held |
| The seat is running, its agent `steers`, and this desk saw the turn start at least 60 s ago | **steered** into the running turn |
| The seat is running or starting | held |
| The seat was sent mail less than 10 minutes ago, with no turn end since | held |
| Otherwise | sent |

The 60 s wait exists because Paseo replaces the running turn when the agent cannot take a steer yet,
and that is the interruption holding avoids. A turn that started before a daemon restart is never
steered.

Mail is pumped on every new letter, at every turn end and on every patrol round. A letter still
waiting after 7 days is dropped the next time any letter is posted, and the drop is logged.

### Permission requests

| Seat | Where its request goes |
|---|---|
| Lead | A letter to its Supervisor |
| Peer or Reviewer on a task | A letter to the lane's Lead |
| Supervisor | Logged in `attention.log` and listed in `status.md`. The Human answers it in Paseo |
| Peer or Reviewer with no task | Nowhere; it shows only in Paseo |

A question's letter lists the questions and their options. The owner answers with `message`, and the
desk answers the question in Paseo on the seat's behalf. Any other letter to that seat waits, like
all mail to a seat with a pending permission. Other kinds of permission can only be answered by the
Human.

## Reading turns

At every turn end, `TurnRules` reads the turn's timeline mechanically. It never calls a model.
Canceled turns, and seats without a tool set, are skipped.

- **Failed turns** are reported to the seat's owner.
- **Silent turns** of a Peer or Reviewer on a task, with no desk call recorded and none in flight, get
  a nudge. The count resets only when the seat reports, asks or answers through the desk, so a turn
  that only calls `status` neither counts nor resets it. The task is marked `stalled`, and the Lead is
  mailed, on the second silent turn. It also happens on the first, if the turn ended on a call that was
  refused or never finished, with at most 200 characters said after it.

## Watching Leads and Peers

Every live seat whose role can be `watched` (the preset gives it to Lead and Peer) is followed through
one timeline subscription, opened when the seat is created or first seen by the patrol, and closed when
it is archived. The stream is read the way Paseo 0.8 delivers it:

- a new subscription hears nothing of the past, so the tail is read first and told as replay;
- rows a dropped client missed are read back from where the sequence broke;
- a rewind resets it, and a reload's re-sent history is replay until the seat starts a turn.

Rows fold into a window per seat, keyed by call. Facts are read from them in code, never by a model:

| Fact | Level | Fires when |
|---|---|---|
| destructive | page | a shell command matches the destructive pattern, at the first row that carries it, while it still runs |
| stuck | attend | one of OpenHands' four patterns since the seat was last told something: the same action and result 4 times, the same action failing 3 times, the same words 3 times, two actions alternating 3 times |
| test-weakened / suppressed | attend | an edit takes assertions out of a test or adds a skip marker, or adds a suppression such as `@ts-ignore` |
| no-recovery | attend | ten steps after a failed shell command, neither the same program nor the gate has passed |
| unverified | attend | a turn that reported to the desk wrote files and did not run the gate after the last of them |
| long-turn | attend | a turn runs past `longTurnMinutes`, or three times the seat's median turn |
| call-failed / gate-failed / outside-scope | note | evidence for the sensor, never an incident alone |

A failure counts however the harness reports it: a failed status, a non-zero exit code, or an output
matching the harness's `exitPattern` (Devin reports only `Exited with code N`).

With a key in the machine settings, the sensor in `catalog/sensor/` (Jev through OpenRouter Decisions)
is asked about the seat five seconds after it goes quiet, at least every thirty while it works, and at
once when a call fails, a turn ends or a permission is asked. The state leads with the task or lane
brief and the instruction the turn serves, however long ago it arrived, masks secrets and stays within
the sensor's size, most of which goes to the steps: each shows the end of what it printed, or its error,
and an edit shows what it changed. Facts go in by level, then newest first. No earlier verdict is ever
in it. A seat whose brief cannot be read from the ledger is not asked about. A question whose `needs`
fields are all empty is not asked. A question above its threshold becomes a finding only with a fact
that agrees, except the ones marked `alone`, and only a fact the state carried can agree.

Every assessment is kept in `assessments/` with its state, questions, facts, answers and findings,
packed when a file passes 32 MiB and dropped, oldest first, past 64 files. `node bin/calibrate.ts
<project>` reads them against the marks on incidents, which the `incident.ack` event keeps after the
book lets an incident go. For each question it reports AUROC, how often it fires in its busiest 24
hours, and the most sensitive threshold within the day's budget were it the only thing firing, then
all of them together with the incidents code facts opened. `--ask` asks the questions in
`catalog/sensor/` again against the kept states first.

Each finding joins the open incident for its seat and kind in `incidents.json`, or opens one. An
incident is sent once, as an INCIDENT letter to whoever supervises the project, and is quiet after
that. Until it is sent it is decided again on every sighting: `attention.watch` off (the default) holds
it in shadow, the day's `incidentsPerDay` holds an attention-level one, and nobody seated holds it for
nobody until a patrol round finds somebody to tell. The Supervisor lists them with `incidents` and marks each `useful` or `noise` with `ack`,
which closes it and is what the thresholds are tuned from. Nothing the watch concludes goes to the
seat it watches.

The **patrol** runs every `tickSeconds`, 30 s by default, and rounds never overlap. For each project a
round:

- follows every watched seat, lets go of the gone ones, and checks for long turns
- mails the Supervisor about idle lanes
- marks tasks whose Peer is gone
- reminds, re-addresses or escalates open asks
- sweeps stray workspaces and worktrees
- finishes held teardowns
- writes `status.md`

Then it pumps every seat that has mail.

## Settings

There are two JSON layers. For any single value the project layer wins, but rules from both layers
are joined, machine first.

- **Machine:** `~/.local/share/seatworks-v2/settings.json`
- **Project:** `~/.local/share/seatworks-v2/projects/<slug>/settings.json`

A layer can set the following. Unknown keys are refused.

- each role's agent, model, thinking level and rules
- which MCP servers are on, for which roles, with which settings
- rules for every seat
- the Flow switch
- the attention values

A save carries the revision it was read at, a hash of the parsed content with its keys sorted. If the
file has changed since, the save answers `conflict`. A file that does not parse is never overwritten.
A save is refused if its team does not resolve, or if it would make a buildable seat unbuildable. A
machine-layer save also reconciles the Paseo providers.

| Attention value | Default |
|---|---|
| `tickSeconds` (read from the machine layer only) | 30 |
| `leadIdleMinutes` | 12 |
| `askRemindMinutes` / `maxReminders` | 15 / 2 |
| `watch` | false |
| `incidentsPerDay` | 5 |
| `longTurnMinutes` | 30 |
| `destructive` / `testPath` / `suppressed` / `repeatsAt` | patterns and 3 |

**Replacing the preset.** A `roles.json` in `~/.local/share/seatworks-v2/` replaces the shipped one,
and a role there may point at its prompt and skills by absolute path. Each role name still needs:

- its settings files under `plugin/harness/<agent>/settings/`
- the Codex rules file, for Codex
- a tool set that `plugin/mcp/tools.json` defines

## MCP servers

| Server | Kind | What it gives |
|---|---|---|
| `team` | Always there, for each seat with a tool set | The desk verbs in the role's tool set |
| `intellij-index` | Proxy over HTTP to a JetBrains IDE | Code-index tools per role |
| `code-search` | Proxy over stdio (`uvx … semble`) | One `search` tool |
| `context7` | Plain HTTP server | Library documentation |

Catalog servers stay off until a settings layer switches them on for some roles. Each proxied entry
runs through `plugin/mcp/code.mjs`, which can do five things. Each is switched on by the entry's
`proxy` block:

- pin every call to the seat's git root
- send changed files to the backend before a call
- open the working copy in the backend when a call says it is not open
- wait out indexing
- rewrite known errors

`intellij-index` uses all but opening, and `code-search` uses only pinning. For `intellij-index` the desk also keeps
`.idea/` out of git, and syncs a reused working copy when it hands one out. Each server's `rule.md` and
tool list go into the seat's working rules, and its skills are linked into the seat.

## The panel

`index.client.tsx` adds a **Seatworks** sidebar item. It opens on a list of projects, with a
**Machine defaults** row and an **Add project** dialog (Repository, Team, Check). Each project has
four tabs:

- **Team:** agent, model and thinking level per role
- **Flow:** Supervisors, lanes, tasks and open asks, polled with a revision so an unchanged view is not
  sent again
- **MCP:** switch servers on or off, choose their roles and options, add one from a pasted snippet
- **Health:** the checks for this machine and, on a project, its `status.md`

The client talks to the server only through the `seatworks.*` RPCs in `shared/rpc.ts`, and it uses 13
of the 14 (`settings.reset` has no button). It also reads Paseo's own project list. Nothing is pushed
to the client: it reloads after every save, and the Flow tab polls.

## State on disk

```
~/.paseo/config.json                      providers sw2-<role>-<agent>, agent profiles
~/.local/share/seatworks-v2/
  roles.json                              optional; replaces the shipped preset
  settings.json                           machine settings layer
  outbox.json                             waiting letters, all projects
  spool/requests/  spool/replies/         seat tool calls
  guides -> plugin/content/guides
  worktrees/<slug>/S<n>/                  isolated working copies
  projects/<slug>/                        slug = repo folder name + 6 hex chars of sha1(root)
    meta.json  settings.json  project.json
    ledger.json  incidents.json  assessments/
    events.log  attention.log  status.md
    handbacks/  gates/  docs/  notebook.md
<profileRoot>/sw2-<role>-<agent>-<slug>/  one seat directory per role, agent and project
```

`events.log` is the provenance record. It has one JSON line per tool call and per lane, task, merge,
gate, slot, watch fact, sensor answer and incident.

## Testing

`cd plugin && npm run check` runs `tsc` over the server and the client, then `node --test` over
`test/**/*.test.ts`. The tests drive the desk, the outbox and the runtime through fake ports. A
real-kit test builds every role on every shipped agent. It builds the Codex seats only where `codex` is
installed, because building one asks Codex for its model catalog. No test launches a seat.

## Known limits

- **Devin cannot be steered.** Mail to a running Devin seat waits for its turn to end.
- **Pi and Devin have no sandbox.** Pi also has no command rules, so its roles are limited only by the
  tools each is given. Devin's roles are limited by permission denials, which include commands such as
  `git push` and `gh`, but it has no path rules.
- **Codex command rules match prefixes**, so `git -C <path> push` is not caught.
- **Claude compaction.** Paseo cannot steer Claude while it is compacting, so a steer that arrives
  then replaces the turn.
- **A turn that was running before a daemon restart** is never steered, only held.
- **A project-layer settings save** does not rewrite the Paseo providers, so the defaults they show
  come from the machine layer.
