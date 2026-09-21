# Architecture

How Seatworks works inside. The [README](../README.md) says what it is, who is on the team and how
to install it. [AGENTS.md](../AGENTS.md) holds the rules the code follows.

One rule shapes everything here: **the plugin serves SLP and never constrains it.** Its authority
stops at:

- session lifecycle
- transport and routing
- notification
- durable state and provenance

Whether the work is right is always a seat's call, never the plugin's.

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

![Seatworks inside Paseo](images/overview.svg)

Four kinds of process are involved:

| Process | What it is | Seatworks code in it |
|---|---|---|
| Paseo daemon | Runs agents and loads plugins | `plugin/server/**`, entered through `index.server.ts` |
| Paseo app | The UI | `plugin/client/**`, entered through `index.client.tsx` |
| A seat | An agent process Paseo started from a `sw2-<role>-<agent>` provider | For Claude Code and Devin, `plugin/bin/seat-room` checks the launch and then `exec`s the agent. For Codex and Pi, nothing but the seat directory the plugin wrote |
| A seat's MCP servers | Child processes of the seat | `plugin/mcp/team.mjs`, plus `plugin/mcp/code.mjs` for proxied catalog servers |

The daemon side and the seats share no memory:

- **Seats reach the plugin through files**, the spool.
- **The plugin reaches seats through Paseo**, with `agents.ref(id).send`.

## Code map

| Path | Responsibility |
|---|---|
| `plugin/server/core/` | Ports (`Seats`, `Workspaces`), the Paseo adapter, the timeline stream reader, atomic JSON and TOML stores, `git`, the gate runner, paths |
| `plugin/server/catalog/` | Data to seats: the kit loader and harness contract, team resolution, providers, seat directories, launch config, content rendering |
| `plugin/server/desk/` | The ledger and the verbs seats call: lanes, tasks, asks, working copies, the merge queue, gates, incidents and letters. `args.ts` checks every call's arguments before a verb sees them |
| `plugin/server/runtime/` | The composition root and the loops: hooks, spool, outbox, patrol, turn reading, RPC, health checks |
| `plugin/server/runtime/watch/` | The window over a seat's timeline, the trail, the facts read from it and the findings they make |
| `plugin/server/runtime/watch/jev/` | The views Jev reads, the sensor, its kept assessments, and how its answers are weighed |
| `plugin/client/` | The Seatworks panel |
| `plugin/shared/` | What the panel and the server share: the RPC contracts in `rpc.ts`, the Flow and watch views in `views.ts` |
| `plugin/mcp/` | `team.mjs` (desk tools over stdio), `code.mjs` (the proxy for catalog servers), `tools.json` (the tool sets and their schemas) |
| `plugin/bin/` | `seat-room`, the launcher for Claude and Devin seats; `calibrate.ts`, the report over what the watch kept |
| `plugin/roles.json` | The SLP preset: the provider prefix, the attention values, and each role's capabilities, tool set, prompt, skills and default agent |
| `plugin/harness/<agent>/` | How each agent is set up: `harness.json`, plus base and per-role settings |
| `plugin/catalog/mcp/<id>/` | Optional MCP servers |
| `plugin/catalog/sensor/<id>/` | The sensor: where it is asked, which model, and the questions it asks |
| `plugin/content/` | Runtime content seats read: role prompts, skills, guides, the notebook and page templates. This is not documentation |

Only `server/core/paseo-adapter.ts` calls the daemon's agent and workspace API (`context.paseo`).
The runtime only registers hooks, events and RPC handlers with the SDK. The desk, the outbox, the
patrol and the settings control depend on the `Seats` and `Workspaces` ports, so the tests drive them
with fakes.

The API handle is never kept from boot. It is taken fresh from every hook, event and RPC call. Until
the first of those arrives, the patrol skips its ticks and the spool is not drained. After a daemon
reload, whatever comes first brings both back: opening the panel, or starting a seat.

## Boot

1. Paseo calls `contribute(server)` in `index.server.ts`.
2. The plugin finds its directory from `SEATWORKS_PLUGIN_DIR`, or from `plugins["seatworks-v2"]` in
   `~/.paseo/config.json` when that entry is a directory install. Without one, it logs and stays
   inert.
3. `loadKit` reads the kit:
   - `roles.json`, preferring a copy in `~/.local/share/seatworks-v2/`, with its attention values
   - every `harness/<agent>/harness.json`
   - the MCP catalog, `mcp/tools.json` and the page templates
   - the sensor in `catalog/sensor/`

   A kit that fails to load leaves the whole plugin inert, with the problem named. These fail it:
   - a `harness.json` or `sensor.json` with an unknown field, or a required field missing
   - an MCP entry whose id does not match its folder, a proxy with no backend, a server with no type,
     a pattern that does not compile, a missing rule or skill file, or a bad `requires`
   - a role whose default agent is missing or unknown, or an attention block that does not validate
4. `Runtime.prepare` creates the state root and the spool, links `guides/` to `content/guides`, and
   prints every settings error. It then reconciles the providers.
5. `Runtime.register` sets up the rest:
   - the RPC handlers
   - two hooks that run before a start, on `agent.create` and `agent.session_open`
   - five lifecycle events
   - a 500 ms spool poll
   - a patrol timer that re-arms itself. It reads the cadence again each round and never goes below
     5 s, so a change in settings takes hold without a reload.

Unloading the plugin stops both timers and lets go of every watch.

| Hook or event | What the plugin does |
|---|---|
| before `agent.create` | For a `sw2-` provider, builds the seat directory and shapes the launch config. A seat that cannot be built refuses the launch, with the reason |
| before `agent.session_open` | Seeds the project's records, rebuilds the seat directory if needed, and points the agent's config directory at it |
| `agent.created` | Starts following the seat's timeline, if its role can be `watched` |
| `agent.turn_started` | Records when the turn started, for turn reading and for the outbox's steer rule |
| `agent.turn_ended` | Finishes a deferred archive or working-copy teardown, reads the turn unless the seat is being put away, and pumps the seat's mail whatever the reading ran into |
| `agent.permission_requested` | Mails the request to the seat's owner, or logs it (see [Permission requests](#permission-requests)) |
| `agent.archived` | Forgets the seat's turn and send timing, lets go of its timeline watch, and closes its open incidents. Letters already held for it stay in the outbox until they age out |

## From data to a running seat

![From data to a running seat](images/seat-build.svg)

### Providers

The plugin makes a Paseo provider for every role and agent pair where:

- that role has a settings file for that agent, and
- every source that the harness's `files` names exists.

The provider is `<prefix><role>-<agent>`, with a matching agent profile. The prefix is `sw2-`, and the
label reads like **Lead · Claude Code (sw2)**. Each provider:

- extends the agent's Paseo base provider
- carries the agent's environment, launch command and models
- carries the Paseo tools the role may use. The role's `paseoTools.allow` becomes a `disabledTools`
  list.

Reconciling runs at plugin start and after a machine-layer settings save. When the wanted providers
or profiles differ from `~/.paseo/config.json`, it:

- rewrites `agents.providers` and `daemon.agentProfiles` atomically, keeping the file's mode
- deletes the `sw2-` entries the kit no longer produces
- keeps env keys the user added
- runs `paseo daemon reload`

When nothing differs, it leaves the file and the daemon alone. The shipped kit makes 20 providers:
five roles on four agents.

### The harness contract

`plugin/harness/<agent>/harness.json` describes how one agent is set up. `id`, `label`,
`baseProvider`, `configDirEnv`, `profileRoot`, `skillsDir`, `settings`, `mcp` and `provider` are
required; the rest are optional. Any other field fails the load.

| Field | Drives |
|---|---|
| `id`, `label` | The harness's own name, and the half of a provider's label that names the agent |
| `baseProvider` | The Paseo provider this one extends: `claude`, `codex`, `pi` or `acp` |
| `configDirEnv`, `profileRoot` | The variable that points the agent at its seat directory, and where those directories live |
| `systemPrompt`, `promptFile` | Whether the prompt goes in the launch config (`config`) or into a file (`file`) |
| `contextFile` | A file in the seat directory that gets the working rules, when there are any |
| `skillsDir` | Where skills are linked in the seat directory |
| `settings` | The base settings, the per-role overlay (`settings/<role>.settings.*`) and, optionally, the paths the plugin owns in an existing file |
| `mcp` | The MCP file, how servers are delivered (`launch` or `file`), transports, seed and clear rules, and `desk`: extra fields for the desk's own server entry |
| `links`, `files` | Files linked from the user's own setup (logins, project history), and files composed per role |
| `modelCatalog` | A command whose model list is patched and written as the agent's catalog |
| `stateWrites` | Where the seat's writable state paths go, and whether at launch or in the settings file |
| `projectContextOption` | A provider option that receives the working directory, so the agent reads the project's instructions |
| `steers` | Whether mail may be steered into a running turn |
| `exitPattern` | How this agent writes a failed exit in its output, so the watch can tell a failure from a result |
| `modes` | The modes Paseo can list without launching the agent. An `acp` harness must give them, and `provider.profileModeId` must name one |
| `checks` | Files the Health tab looks for, with a hint |
| `models`, `hasThinking` | The models offered in the panel, and their thinking levels |
| `provider` | Env, launch command, `forceFlags`, and the mode a seat starts in |

Which shipped harnesses use the optional fields:

- only Claude sets `projectContextOption`
- only Devin sets `exitPattern` and `modes`
- only Claude and Codex declare `stateWrites`
- only Codex has `files`
- only Pi sets `mcp.desk`

How a seat says a call was refused is one fixed pattern for every agent, in
`runtime/timeline.ts`.

### What each seat gets

At `agent.create`, `Seating.ensure` builds the seat directory
`<profileRoot>/sw2-<role>-<agent>-<slug>`. It skips the build when all of these hold:

- the directory was built at the current settings revision
- its settings file is still there
- every link whose target exists is present

The last condition means a login made after the seat was built causes a rebuild. Nothing is written
unless the whole seat can be built. Then `applyRole` shapes the launch:

- **Model and thinking:** the chosen model, or the catalog default, with a valid thinking level.
- **Mode:** the harness's `provider.profileModeId`, where it declares one.
- **System prompt:** the rendered role prompt, for agents that take it in config.
- **MCP servers:** the role's servers, for agents that take them at launch.
- **Provider options:** for Claude Code only, the sandbox's writable state paths and the working
  directory, at `projectContextOption`. Codex gets its writable paths in `config.toml` when the seat
  is built. Pi and Devin have no sandbox, so nothing limits what they write.

At `agent.session_open`, `seatEnv` sets the config-directory variable to the seat directory. It also
sets `SEATWORKS_ROLE`, `SEATWORKS_PROJECT` and `SEATWORKS_STATE`.

| Agent | Seat directory | Written there | How it launches |
|---|---|---|---|
| Claude Code | `~/.claude/profiles/…` | `settings.json` (deny rules, sandbox), `.claude.json` (its own MCP servers cleared), `skills/`, a `projects` link, and `CLAUDE.md` when there are working rules | Through `bin/seat-room`, which forces `--setting-sources user`, so the project's settings, hooks and skills stay out |
| Codex | `~/.codex/seats/…` | `config.toml` (`workspace-write` with network access, or `read-only` for the Reviewer and the Watcher; `approval_policy = "never"`; Codex's own subagents and bundled skills off; `model_catalog_json`), `model-catalog.json`, `rules/seatworks.rules`, `skills/`, an `auth.json` link, and `AGENTS.md` when there are working rules | Paseo's Codex provider, which starts a `codex app-server` for each seat |
| Pi | `~/.pi/seats/…` | `settings.json` (the `pi-mcp-adapter` package, project trust off, and a tool list for the Reviewer and an empty one for the Watcher), `mcp.json`, `skills/`, links to the login, model store and npm folder, and `AGENTS.md` when there are working rules | Paseo's Pi provider. MCP reaches Pi only through `pi-mcp-adapter`, which reads the servers from the seat's `mcp.json`. The desk's entry carries `lifecycle: "keep-alive"` and `directTools` from the harness's `mcp.desk`, so the desk verbs are the seat's own tools from the first turn |
| Devin CLI | `~/.devin/seats/…` | `devin/config.json` (permissions, command denials, Devin's own subagents off, and reading Claude, Cursor and Windsurf config switched off), `devin/AGENTS.md` (prompt and rules), `devin/mcp_config.json`, `devin/skills/`, and a link to your own git config | Through `bin/seat-room acp`, over Paseo's ACP provider |

Notes per agent:

- **Codex:** building a seat asks `codex debug models --bundled` for its model list, so a machine
  without the Codex CLI cannot build one at all.
- **Devin:** the config-directory variable is `XDG_CONFIG_HOME`, so pointing it at the seat directory
  moves everything that reads it. The `git` link is what keeps your own git identity inside a Devin
  seat. A machine with no `~/.config/git` gets no link, and that seat commits as whoever it resolves
  to.
- **Claude:** the seat still reads the project's `CLAUDE.md` and `.claude/rules`. The working
  directory is passed in the `additionalDirectories` option, and
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` makes Claude read `CLAUDE.md` from added
  directories.

### The launcher

`bin/seat-room` starts Claude and Devin seats. Codex and Pi seats do not go through it; they rely on
`agent.session_open` to set the variable.

It refuses a launch, with the reason, when:

- `SEATWORKS_AGENT_BIN` is unset
- `jq` is missing
- the harness file cannot be read
- the config-directory variable is empty

It checks only that the variable is set, so a value the daemon inherited from its own environment
would get through. When the variable is empty, a Devin seat gets a stand-in ACP server built from
the harness's own modes. The stand-in answers the handshake and returns the reason for every other
call, so the reason is readable in the session rather than lost in a dead launch. Every other refusal
exits with the reason.

`seat-room` also forces the harness's `forceFlags` onto the command line, replacing any value already
there. For Claude that flag is `--setting-sources user`. Paseo fixes Claude's setting sources itself
and drops extra arguments from a provider's command, so a launcher is the only way to set it.

### Content

Role prompts and working rules may use two placeholders: `{{guides}}` and `{{state}}`. These fail the
seat build:

- any other placeholder
- a word from the role's `hidesWords`, looked for in:
  - the prompt
  - the whole working-rules text, your own rules included
  - every markdown file of every skill the seat is given

The Peer's prompt, for example, may not say "seat". This is also why an ordinary line in your own
`rules` can be refused at the settings screen.

A skill is linked as it is written, so a skill holding any placeholder is refused. Skills refer to
`$SEATWORKS_STATE` instead.

On Claude Code and Codex, the sandbox lets a seat's shell write under the project's state only where
its prompt, skills and rules say `{{state}}/…` or `$SEATWORKS_STATE/…`:

- A role that can `lead` also gets `docs/`, for the project pages.
- The desk's own files are never granted.
- In the shipped kit that comes to three folders and `notebook.md` for the Supervisor, and five
  folders for the Lead.
- A Peer or Reviewer names none, so its shell writes nothing under the state at all.

This binds only the shell. Claude's file tools are kept off the desk's files by deny rules. Pi and
Devin seats have no such limit.

## The desk

![A lane, end to end](images/lane-lifecycle.svg)

### The ledger

Each project has one `ledger.json`, at version 1. It holds `lanes`, `tasks`, `asks`, `agents`,
`slots` and the counters ids come from.

- Every change goes through a per-project lock that loads, applies and saves.
- A ledger that cannot be read, or has the wrong version, is refused rather than treated as empty.
- Incidents live beside it in `incidents.json`, under the same discipline with a lock of their own.

| Record | States | Ids |
|---|---|---|
| Lane | `open`, `closed` | `L<n>` |
| Task | `running`, `done`, `rework`, `queued`, `merging`, `merged`, `failed`, `cut`, `stalled` | `<lane>-T<n>` for code, `<lane>-R<n>` for review. Both come from one counter per lane, so a review started after `L1-T1` is `L1-R2` |
| Ask | `open`, `answered` | `A<n>` |
| Incident | open until it is marked | `I<n>` |
| Slot | A git worktree held by a lane or task | `S<n>`. A released id is never reused; a slot left free by a failed setup is handed out again under its id |

### Who may call what

A seat's call runs only if all three hold:

- its Paseo provider maps to a role whose tool set in `mcp/tools.json` holds the verb
- the role its bridge names is that same role
- its arguments fit the schema that tool set shows the seat

`desk/args.ts` is the one place arguments are checked, before any verb runs. A call fits when:

- every required field is present and says something: a text is not blank, and a list has an item
  that is not blank
- every value has its type, and is one of the listed values where the schema lists them
- no field is one the schema does not have

A call that does not fit is refused with what is wrong and what the verb takes. No verb checks its
own arguments.

Inside the verbs, behaviour depends on what the role **can** do, never on its name. The capabilities
are `supervise`, `lead`, `work`, `write`, `review`, `watched` and `watch`, set in `roles.json`. `open_lane`,
`start_task` and `start_review` each take an optional `role`, which picks between roles holding the
same capability.

### Verbs

| Verb | Held by | Effect |
|---|---|---|
| `open_lane` | Supervisor | Records the lane, takes a working copy, and seats a Lead with an owner directive. Taking the project's own copy needs it clean of uncommitted and untracked files. It can read a GitHub issue; one it cannot read is a note in the reply, not a refusal. It refuses a lane whose declared write set or `contracts` overlap an open lane's write set, or that reaches a path the project keeps to one writer that an open lane could also write. A lane that declares nothing is not checked, and counts as writing every such path. The first `open_lane` of a project that has no gate recorded detects one (see below) |
| `close_lane` | Supervisor | Waits for every merge the project has queued, then with `land` lands the lane (see [Landing a lane](#landing-a-lane)). Then it cuts leftover tasks, archives their seats and the Lead, and puts the copy away |
| `set_project` | Supervisor | Sets, in the project's `project.json`: the base branch, the gate command, its timeout (30 minutes by default), whether it runs per lane or per task, the serial-only paths, and the template pages to keep. An empty gate is an answer, and the desk never detects a gate over it. When the kept pages change, every open Lead gets a DOCUMENTS letter |
| `start_task` | Lead | Seats a writing role on a task. In lane mode, the default, it shares the lane's copy and branch. In parallel mode it gets its own slot and `task/…` branch. `skills` must name skills the Peer role has; any other is refused with the list |
| `start_review` | Lead | Seats a reviewing role, read-only. It runs in the task's own copy while that copy is still its own, otherwise in the lane's. The brief says where the change is: this copy, the merge that carried it, or the task branch. A change with none of those left is refused |
| `accept` | Lead | Lane mode: marks the task merged in place, tells the Lead in a MERGED letter, and retires the Peer. It is refused when the lane's copy is off the lane branch or has uncommitted changes, and the refusal says whose changes they are. Parallel mode: queues the task for the merge queue |
| `rework` / `cut` | Lead | `rework` sends the task back with a letter, and is refused while another task holds the lane copy. `cut` stops it, archives its Peer at once, and resets the lane copy to where the task started when nothing merged there since |
| `report` | Lead | Reports to the Supervisor. With `ready`, it runs the lane gate first and puts the result in the report. With nobody supervising seated, the report is kept in `events.log` and the Lead is told there is nothing to wait for |
| `ask` | Lead, Peer, Reviewer | A Lead asks whoever supervises. A Peer or Reviewer asks its Lead, or whoever supervises when the Lead is gone |
| `done` | Peer, Reviewer | Writes a hand-back file and mails the Lead, or whoever supervises if the Lead is gone. On a project that gates each task, it runs the gate first and puts the verdict in the hand-back. A task already accepted, queued or cut is refused |
| `message` / `answer` | Supervisor, Lead | A Supervisor's `message` goes to a lane or a task; a Lead's only to a task in its own lane. A seat stopped on a question takes it as that question's answer. `answer` closes an open ask: a seat that supervises may answer any, anyone else only its own |
| `raise` / `judge` | Watcher | `raise` opens an incident of one of the kinds in `catalog/watcher/watcher.json` on the step a reading sent it under that ref; the incident quotes the step without the reading's number, and the reason goes only to `events.log`. `judge` confirms or vetoes an open fact it judges that has no judgement yet, filed under the question `watcher` with p 1 or 0 and the reason kept on the incident. Both are refused once the watch is by Jev |
| `incidents` / `ack` | Supervisor, Lead | A Lead's are only those about the other seats of its own open lane. `incidents` lists the fifty most recent incidents still open or unmarked, each with the brief its seat was working to, and counts any older ones. With `closed`, it adds the twenty most recently marked. `ack` marks one `useful`, `noise` or `unknown`, with an optional note, and closes it |
| `status` | Supervisor, Lead | The lanes, tasks, working copies and open asks. A Lead sees its own lane. Held mail and seats waiting on the Human are in `status.md` and the panel, not here |

A call still running after 240 s is answered with "the answer arrives as mail", and the result
follows as a letter. An identical call that is already running is joined rather than run twice.

**Gate detection.** When no gate was ever recorded, the first `open_lane` looks for one in the
project root and records what it finds:

| Found | Gate |
|---|---|
| a `package.json` with a real `test` script | `pnpm test`, `yarn test`, `bun run test` or `npm test`, by lockfile |
| `mvnw` or `pom.xml` | `./mvnw -q test` or `mvn -q test` |
| `gradlew` | `./gradlew test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pyproject.toml` or `pytest.ini` | `pytest -q` |

### Working copies, merges and gates

- **Where a lane works.** A lane works in the project's own checkout, switched to
  `lane/<id>-<title>`. If it asks to be isolated, or another lane already works in place, it gets a
  worktree slot at `~/.local/share/seatworks-v2/worktrees/<slug>/S<n>`, with its own Paseo workspace.
  That workspace is filed under the project's own Paseo project. Handed a bare directory, Paseo makes
  a project of it, and a plugin cannot remove a project.
- **One writer at a time.** One lane-mode task holds the lane copy from the moment it starts until it
  is accepted or cut. A hand-back does not release it, because rework wakes that Peer in the same
  directory. While it holds, a second task and rework on a second task are refused. Parallel tasks
  get slots of their own.
- **The merge queue.** One queue per project merges accepted parallel branches into their lane's
  copy, one at a time, whichever lane they belong to. Each ends `merged`, or `rework` on a conflict,
  or `failed`. If the lane copy is dirty, the task goes back to `done`. No gate runs inside the queue:
  where the project gates tasks, the Lead already had that verdict with the hand-back.
- **Gates.** Gates write logs under `<state>/gates/`. A task gate's result goes with the hand-back,
  and the MERGED letter repeats it. A lane gate's result goes in the Lead's report. A project with no
  gate set is not checked.
- **Teardown.** Teardown waits for seats that are still mid-turn. The ledger records the pending
  release (`Slot.releasing`, `Lane.restoring`). It finishes when that seat's turn ends or on a later
  patrol round, so a daemon restart does not lose it. Your own checkout is switched back to base and
  the lane branch is kept. A cut parallel task's own branch is dropped when the lane already has its
  commits, and otherwise kept and named in the reply. The only branch the desk deletes by itself is a
  lane branch nothing was committed to, when `open_lane` failed after taking the copy.

A lane may also be opened as a **detour** of another open lane (`detourOf`). Its Lead is told to do
only what the waiting lane needs. When the detour closes, the waiting lane's Lead gets a CLEARED
letter saying the work is not on its branch yet.

### Landing a lane

`close_lane` with `land` lands in one fixed order:

1. **Bring the base in.** If the base has moved on since the lane branched, the desk merges the base
   into the lane in the lane's own copy. A conflict here is the Lead's to settle, not the desk's.
2. **Gate that.** It runs the lane gate on the result, so what is checked is exactly what will land.
3. **Fast-forward the base.** The base moves up to the lane branch. `landLane` only fast-forwards,
   and refuses a lane branch that does not contain the base.

Any of these refuses the call and leaves the lane open:

- a seat mid-turn in the lane's copy
- a conflict with the base
- a red gate
- a base that cannot be moved

The Supervisor can pass `overGate` to land over a red gate. The reply notes the red gate, and the
override is written to `events.log`. Nothing else can be overridden. `close_lane` mentions a gate only
when it is red, and then quotes its output.

### Letters

Everything the desk sends is written in one file, `desk/letters.ts`. Everything waiting for one seat
goes out as a single message, with its open asks listed underneath.

| Kind | Letters |
|---|---|
| Opening a seat | OWNER DIRECTIVE, TASK, REVIEW |
| Between seats | MESSAGE, RECONCILE, ASK, ANSWER to your ask, ANSWERED FOR YOU, STILL OPEN, UNANSWERED |
| Work moving | HANDBACK, REWORK, STOP, MERGED, MERGE FAILED, MERGE CONFLICT, REPORT, CLEARED, DOCUMENTS |
| The desk noticing | SILENT, FAILED, WAITING FOR PERMISSION, LANE IDLE, INCIDENT, the bare nudge |
| Answering late | ANSWER to your `<tool>` call |

### The rules the concept asks for

- **No hidden command chain.** When a Supervisor messages a Peer directly, the Lead first gets a
  RECONCILE letter carrying what was sent and what is still its own. If the lane has no live Lead,
  the message is refused.
- **Answers for someone else.** Only a seat that supervises may answer an ask addressed to another
  seat. That seat is told first, in an ANSWERED FOR YOU letter carrying the question, the answer and
  who gave it. A Lead is also told the task is still owned by the same Peer and still its to accept.

## Tool calls in, letters out

![Tool calls in, letters out](images/calls-and-mail.svg)

### The spool

Every seat with a tool set gets a stdio MCP server named `team`, run as
`node plugin/mcp/team.mjs <role> <tool set> <spool>`. It lists that set's tools from `tools.json`.

1. For each call, `team.mjs` writes `spool/requests/<id>.json` through a temporary file and a rename,
   so a half-written call is never read.
2. The daemon drains the spool every 500 ms. It checks each request's arguments, answers it through
   the desk, and writes `spool/replies/<id>.json` the same way.
3. `team.mjs` polls for the reply every 250 ms, for up to 300 s. Past that it tells the seat the desk
   is probably not running, to leave the call alone, and to end its turn naming it.

Requests older than 10 minutes are dropped, and with them any reply no seat took.

### The outbox

Letters live in one `~/.local/share/seatworks-v2/outbox.json`, shared by all projects. A letter with
the same key to the same reader counts as a duplicate while an earlier one is still waiting, and for
30 minutes after it was sent. That memory lives in the daemon process and is lost on restart.

When a seat is pumped, every letter waiting for it goes out as one message, together with its open
asks. Mail is pumped from three places: posting a letter, a turn ending, and the end of a patrol
round.

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
and holding avoids that interruption. A turn that started before a daemon restart is never steered.
A letter still waiting after 7 days is dropped the next time any letter is posted, and the drop is
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
- **Silent turns** are the turns of a Peer or Reviewer on a task that ended with no desk call recorded
  and none in flight. Any desk call keeps a turn from counting as silent, but the count resets only on
  `done`, `ask`, `answer`, `message` or `report`.
  - The first silent turn nudges the Peer itself.
  - On the second, the task is marked `stalled` and the Lead is mailed. This also happens on the
    first, if the turn ended on a call that was refused or never finished, with at most 200
    characters said after it.
  - A stalled task goes back to `running` the next time its Peer calls the desk at all.
- **Malformed calls** are logged. A tool call the seat's own harness refused, because the model wrote
  an input that is not JSON, never reaches the desk. `malformed` in `timeline.ts` finds it, and it is
  written to `events.log` as `call.malformed`. Paseo hands the hook the seat's whole timeline, so
  `malformed`, `outputText` and `deniedCall` all cut to the last instruction first.

## Watching Leads and Peers

![What the watch sees](images/watch.svg)

### The switch

**`attention.by` is the switch.** Two helpers in `catalog/team.ts` read it:

- `watchOn`: are seats followed at all? Always by `seat`, the default. By `jev`, only with a key.
  Off, no seat is followed, no turn is read, and `deskFacts` is not asked what a lane's record shows.
- `jevOn`: is Jev asked? Only by `jev` with a key. By `seat` a key changes nothing.

Where each is checked:

- `Runtime.watching` answers `watchOn`, and `Watches.on` gates following on it.
- `Patrol.history` gates the ledger half on `watchOn`.
- `Runtime.sensing` asks Jev only when `jevOn`.
- `waits` in `desk/notice.ts` holds a fact back for Jev only when `jevOn`.
- `retell` in `desk/notice.ts` gates the mail it sends late on `jevOn`. With the key gone, or the
  watch gone to a seat, the set of questions that could hold an incident back is empty, so without
  this gate either would release every held incident as mail.

The settings are read every round, so changing `by` or taking the key away takes effect within one
round, with no reload.

**What is watched.** Every live seat whose role can be `watched` is followed through one timeline
subscription. The preset gives that capability to Lead and Peer, never to a Reviewer. The
subscription opens when the seat is created or first seen by the patrol, and closes when it is
archived or the watch is switched off.

### The stream and the window

Paseo 0.8 delivers a timeline as a live subscription plus a paged history. The reader in
`core/stream.ts` joins them:

- It subscribes, then seeds from the last 200 rows.
- It fills any gap in the sequence with a refetch.
- It reseeds when the epoch changes or the cursor goes stale.
- A row that carries no turn id is replay. It updates the window and raises nothing, which is how a
  reload's re-sent history stays quiet.
- Plugin rows are dropped.

Rows fold into a window per seat, keyed by call. It holds at most 80 units: calls, what was said,
what was thought, instructions, errors and compactions. The oldest goes when the 81st arrives. That
window, not Jev's size limit, is the real ceiling on what anything here can see.

### Facts, read in code

| Fact | Level | Fires when |
|---|---|---|
| `destructive` | page | a shell command matches the destructive pattern, at the first row that carries the command, while it still runs. Each segment of a compound command is checked, and removing only scratch files under the temporary directory does not count |
| `stuck` | attend | one of OpenHands' four patterns in the last twenty steps since the seat was last told something: the same action and result 4 times, the same action failing 3 times, the same words 3 times, two actions alternating 3 times |
| `no-recovery` | attend | ten steps after a failed shell command, neither the same program nor the gate has passed |
| `test-weakened` / `suppressed` | attend | an edit takes assertions out of a test or adds a skip marker, or adds a suppression such as `@ts-ignore` |
| `unverified` | attend | a Peer's turn ended with a hand-back carrying no gate result, and the turn wrote files in its own copy without running the gate after the last of them. The gate is the gate command or the runner its package script starts. It needs a gate command set |
| `long-turn` | attend | a turn runs past `longTurnMinutes`, or past three times this seat's median turn once it has ended five, whichever is longer. The patrol checks it |
| `call-failed` / `gate-failed` / `outside-scope` | note | a call failed; the gate command failed; a write left the seat's working copy or the paths its task declared. Evidence for Jev, never an incident alone |

What each level means:

- **`page`** is sent at once and never waits for Jev.
- **`attend`** is subject to Jev's judgement and to the day's budget.
- **`note`** is only ever evidence.

A failure counts however the harness reports it: a failed status, a non-zero exit code, or an output
matching the harness's `exitPattern`. Devin reports only `Exited with code N`, so the two stuck
patterns that compare results are skipped there. Rows Paseo marks synthetic, and plain terminal
output rows, are skipped. Facts are deduplicated per turn.

### What a lane's record shows

A window starts at the last instruction, and a letter restarts it, so nothing that takes more than
one turn can be seen there. The patrol reads the ledger it already holds for those shapes, in
`runtime/watch/history.ts`:

| Fact | Fires when |
|---|---|
| `rework-loop` | one task has been sent back `attention.reworksAt` times |
| `patched-not-fixed` | that many sendings-back are spread over two or more tasks in a lane |
| `reviews-unconverged` | `attention.reviewsAt` reviews of one target, still neither accepted nor cut |
| `certainty-only` | a review's focus asks for only what the Reviewer is sure of |
| `brief-prewritten` | a code task's brief carries a code fence, or steps naming a file and a member |
| `accepted-unfinished` | a task merged whose Peer handed it back `partial` or `blocked`, or that never handed back at all |

The seat named is the lane's Lead, because each of these is a Lead's decision. A lane whose Lead has
gone raises nothing, since nothing would ever close an incident about a seat that is not there.

Each lane gets one fact of a kind, never one per task. These are standing conditions, not episodes:
three sendings-back stay three. So the quote is the whole of what was counted, and the patrol asks
the incident book whether it has said those words before:

- A condition already on the book is sighted again, so a day's budget or a watch that is off does not
  lose it.
- A condition already marked is left alone until the record says something new.

These facts go through the same incident book as what the watch reads from a timeline, so
`incidents`, `ack` and `calibrate` treat them alike. `docs/ANTIPATTERNS.md` says which shape each one
answers.

### By a Watcher seat

Code in `watch/seat/`, beside `watch/jev/`, reading the same stream and trail:

- **Seating.** Each patrol round, `settleWatcher` keeps one Watcher on a project whose watch is by a
  seat and which has an open lane, and none on any other. It sits in the project's own workspace
  (`Agents.startResident`), on the Peer's agent and model unless it has its own. When it is not
  wanted it is archived after its turn, as a Lead is.
- **Rotation.** After `watcherRotateAfter` readings, once it is idle with no reading waiting for it,
  it is archived, and the next round seats a fresh one with the brief of every seat again.
- **Readings.** `Reader` paces each watched seat with the same `Pacer` Jev uses: after
  `watcherQuietSeconds` of quiet, at most `watcherEveryMinutes` apart, and at once when a turn ends
  or something fails. A reading (`letters.reading`) carries, for one seat, the brief the first time
  an instruction is read, then only the steps that are new or changed, each behind a ref naming the
  reading (`R3.S5`), because step ids start again at every instruction. It also carries the claim
  the turn ended on and the facts the code noticed. The oldest steps give way past
  `watcherChars`.
- **Delivery.** Readings go through the outbox, which never steers into a Watcher's running turn,
  whatever its agent. What arrives meanwhile is handed over together.
- **What it may raise and judge** is data, in `catalog/watcher/watcher.json`: each kind with a
  level, a label, what it means and a one-line example of how it shows in a seat's steps, and the
  attention-level facts it judges. The kinds are the ones `docs/ANTIPATTERNS.md` lists that a trail
  can show; the Watcher never reads that file, only this short form. The kit refuses a kind
  that is not lowercase words or that is named after a fact the code raises (one incident stands per
  seat and kind), a level other than page or attend, and a judged fact that is not an
  attention-level one the code raises. Its first message lists both, so a kit's own list needs no
  prompt edit. Its prompt, `content/prompts/WATCHER.md`, says how to read: what the seat is doing,
  why it might be fine, then each kind on its own; an empty reading as the common answer; a thought
  weighed by the step that acts on it; and the readings that look like faults and are not.
- **Reporting.** `raise` takes a ref only from the readings sent to that Watcher, kept per Watcher in
  memory and dropped when it is gone. After a restart it waits for the next reading. It refuses a seat
  that has gone. What it opens carries `by: "watcher"`, which `ack` writes into its event. One
  incident stands per seat, kind and reader: a Watcher and Jev share kind names, and neither's
  sighting joins, or is judged or calibrated as, the other's.
- **Judging.** A fact it judges waits `watcherJudgeMinutes` for it before it is told anyway, where
  Jev's wait is two minutes. A reading carries each such incident once, in shadow too, so its
  judgements are there to calibrate against; seen again, the incident drops its judgement, as it does
  for Jev, and is read again. One the code opens or sees again wakes the reader at once. A reading
  names each as its id and how many times it had been seen (`I4.2`), and `judge` takes that name back:
  one seen again or judged since is refused, not overwritten. A veto is lifted only by the reader that made it: changing `by` would otherwise send
  what the other one held back.

### When Jev is asked

The sensor in `catalog/sensor/jev/` is Jev (`typesafe/jev-1.13`), asked through OpenRouter Decisions.
It is asked about a seat:

- five seconds after the seat goes quiet
- at least every thirty seconds while it works
- at once when a turn ends, a call or the gate fails, something irreversible is seen, or a
  permission is asked

One seat is never assessed twice at once. A seat whose brief cannot be read is not asked about.

### The trail

A turn is first read into a trail, in `watch/trail.ts`:

- **Instruction.** The turn's instruction, however long ago it arrived.
- **Steps.** Each step has an id counted from the instruction (`S14`), in order.
- **Kinds.** Each step has a kind:
  - an act: `ran`, `changed`, `read` or `called`
  - the seat's own account of an act: `said` or `thought`
  - `told`, `error` or `compacted`
- **Claim.** Once the turn has ended on something said, that is its claim.
- **Output.** A step shows the end of what it printed or its error.
- **Edits.** An edit shows what it changed.
- **Commands.** A command keeps the part that makes it irreversible, however long it is.

Secrets are masked before anything is cut.

### Views

From the trail, `watch/views.ts` builds four views. Each view is an object with named fields and
holds only what its questions read, because unrelated material costs Jev accuracy.

| View | Fields | Read by |
|---|---|---|
| `actions` | `goal`, `context`, `instruction`, `working_copy`, `steps` (acts only, without their output) | `unsafe_action` |
| `work` | `role`, `goal`, `context`, `beside`, `instruction`, `steps` (everything, ending with what the turn ended on) | the questions about the work itself |
| `claim` | `goal`, `claim`, `last_check`, `changed_after_check` | `unverified_success`, `claim_contradicted` |
| `instruction` | `instruction`, `steps` (the first ones) | `agreed_without_checking` |

- **`context` and `beside`.** `context` is what the Lead told a Peer beyond its goal. `beside` lists
  the tasks being written in other copies and the paths each owns, from `alongside` in
  `desk/ledger.ts`. Without them, Jev read a stand-in the Lead had asked for, or a neighbour's file
  still being written, as the Peer's own invention.
- **The claim view.** It reads `claim` beside the check it rests on, the way a citation is checked
  against its source. `last_check` is the last run of the gate or of the runner its script starts.
  `changed_after_check` is what changed after that run.
- **Sibling notes.** A step that speaks of a file a sibling task owns carries a `note` saying so,
  right where the step stands.
- **Nothing else.** No fact, finding, score or earlier answer is in any view. When Jev agrees with a
  fact, that is a second opinion and not an echo.

When the views are built:

- A view with nothing to show is not built.
- The `instruction` view is not built for a turn that has lost its first steps. Its question rests on
  a step not being there, and the lost part may hold that step. Saying so in the view does not work,
  because Jev does not discount for a stated gap.
- A question whose `needs` fields are all empty in its view is not asked.

Each view is one request, and a reading's requests are sent together. The reading's answers are
theirs combined.

### Questions

The shipped sensor asks fourteen questions. Each question:

- names its view
- asks what the view's fields show, with yes as the finding
- may carry `criteria`

What an answer does depends on how its question is tied:

- **`alone`** opens its own incident.
  - At `attend`, it needs two readings in a row at or over its threshold, in the same turn and under
    the same instruction. A letter landing mid-turn starts the count again. One reading taken after
    the turn ended is enough, since no other follows. A reading in the `unclear` band raises nothing.
  - At `page`, one reading is enough. A reading in the band just under the threshold is raised at
    `attend` rather than let pass, and a page that follows is still sent as a page.
- **`agrees`** opens its own incident when one of the named facts was noted in the same reading.
- **`confirms`** opens nothing of its own. It judges the open incident of a named attention-level
  fact:
  - at or over the threshold, it confirms it
  - in the band, it is unsure
  - under the band, it disagrees
- **Untied**, a question is recorded and does nothing else.

| Tie | Questions |
|---|---|
| `alone` | `unsafe_action` (page), `missing_mechanism`, `proves_the_old_is_gone`, `agreed_without_checking` |
| `agrees` | `goal_drift`, with `outside-scope` |
| `confirms` | `worker_stuck` confirms `stuck` and `no-recovery`; `unverified_success` confirms `unverified` |
| recorded only | `injected_intent`, `guessed_ambiguity`, `admits_error`, `changed_direction`, `wrapped_instead_of_changed`, `proof_changes_product`, `claim_contradicted` |

`unverified_success` asks only whether the seat claimed the work was done, which is the half of the
`unverified` fact code cannot see. A turn that wrote files without running the gate and said so
plainly is therefore vetoed rather than sent.

The questions that judge acts say in their instructions that a `said` or `thought` step calling the
work fine is the agent's own account, not evidence. Text that argues for its own reading moves a
fast single-pass model's answer.

Asking a person is not a question. A seat asks through `ask`. The desk nudges one whose turn ends on a
question in prose, or quotes its idle lane to the Supervisor.

### Pinpoint and excusedBeside

When a question opens an incident, Jev is asked once more which step of that view the finding was
about. This is one choice over the step ids. The incident then quotes that step, such as
`S14 ran: rm -rf …`, rather than the question.

A question marked `excusedBeside` is asked literally and excused in code. When the step it points at
carries a sibling's `note`, the finding is dropped. `missing_mechanism` is one of these: a Peer that
names a missing module and builds around it is, read literally, doing what the question asks about.
The ledger is what makes that expected, not the words.

### Thresholds

The thresholds are measured, not assumed:

- `missing_mechanism` opens at 0.85. Over three runs, every incident of it marked noise opened between
  0.70 and 0.73, and the real one opened at 0.94 and above.
- `wrapped_instead_of_changed` and `proof_changes_product` never reached their thresholds in 1,446
  readings. They are kept recorded-only, for `calibrate` to judge.

The loader refuses a `sensor.json` it cannot make sense of. Any of these fails the plugin's load,
with the problem named:

- an unknown field
- a url that is not https
- a threshold on a question nothing decides
- a view that is not one of the four
- `needs` naming a field its view does not hold
- a `confirms` naming a fact that is not attention-level

### When Jev will not answer

A sensor that will not answer is neither an incident nor the switch:

- 429 and 5xx responses are retried.
- A failure is written as `sensor.degraded` at most once a minute, while the watch keeps reading turns
  in code.
- A key that stops working is shown on the Flow tab, not only logged.

### Incidents

Each finding joins the open incident for its seat and kind in `incidents.json`, or opens one.

- **Sent once.** An incident is sent once, as an INCIDENT letter, and is quiet after that. A sighting
  after it was sent is kept beside it and shown when it is marked.
- **Addressed to whoever answers for the seat.** One at attention level about a Peer goes to the
  Lead of its lane, which owns acceptance there; its letter says so. One about a Lead, one that
  pages, and one whose Lead is gone go to the Supervisor that opened the lane, or to the most recent
  Supervisor of the project if that one is gone. It never goes to the watched seat. This holds by a
  seat and by Jev alike.
- **Decided again until sent.** Until it is sent, an incident is decided again on every sighting and
  every judgement:

| Held | Meaning |
|---|---|
| shadow | `attention.watch` is off, which is the default. Nothing is ever sent |
| awaiting | the reader can judge this fact and has not yet. It waits up to two minutes from the last sighting for Jev, `watcherJudgeMinutes` for a Watcher, then goes anyway |
| vetoed | the reader disagreed. It is kept, and sent if it later agrees or a new sighting goes unjudged |
| budget | `incidentsPerDay` attention-level incidents have been sent in the last 24 hours. The patrol does not retry it: the next sighting decides again |
| nobody | nobody is seated to tell, or the only candidate is the watched seat itself. A patrol round retells it |

A page never waits for Jev.

A sighting whose exact words the Supervisor already marked `noise` for that seat and kind is counted
on the mark and opens nothing. Without this, a condition that had not gone away opened a new incident
after every mark. This applies only at `attend`, and only for `noise`. An irreversible act pages
however often it is excused, and `useful` means the Human wanted to be told.

Archiving a seat closes its open incidents, which still wait to be marked. Closed incidents past 500
are forgotten, oldest first.

**Where the readings are kept.** An incident says where the readings behind it are kept. A settled
task gives its working copy back, and the agent's own record goes with it. What Jev was shown
outlives the copy, and the letter names the file when there is one.

**Marking.** A Lead lists and marks those about the other seats of its own open lane, never one
about itself; the rest are the Supervisor's, which may list and mark them all. The Supervisor lists
incidents with `incidents`, on a schedule it sets itself with
Paseo's own heartbeat tools, since held incidents never arrive as mail. The list gives, for each
incident:

- its kind, level, and where it happened
- the quote
- why it was not sent
- the brief the seat was working to

The Supervisor marks each one `useful`, `noise` or `unknown` with `ack`, from the agent's own record.
Any of the three closes the incident; only `useful` and `noise` tune anything.

Neither the letter nor the list carries a score, a model or a verdict, so the marks measure Jev
rather than echo it. The list does say when an incident was held for Jev. A note is masked before it
is kept. Nothing the watch concludes goes to the seat it watches, and the Supervisor's prompt keeps
it from passing any of it on.

### Keeping and calibrating

Every assessment is kept in `assessments/`: its views, the questions and criteria as asked, the facts
noted, the answers, the findings and the judgements. `current.jsonl` rotates when it would pass
32 MiB. Rotated files are gzipped and pruned to the newest 64.

`node bin/calibrate.ts <project or its state directory>` reads the assessments against the marks on
incidents. The `incident.ack` event keeps each mark in `events.log` after `incidents.json` has
forgotten the incident. The report counts only answers given to the wording in use. For each question
it reports:

- **AUROC**, on its own incidents or on the ones it judged
- **Peak rate**, how often it fires in its busiest 24 hours
- **Threshold**, for an attention-level question: the most sensitive one within the day's budget,
  were it the only thing firing
- **Verdict**: keep it, make it label-only, stop it holding incidents back, or not enough marks to
  judge

A Watcher's marks are left out of each question's, though its kinds share their names, and the
final count keeps what the Watcher raised, confirmed and held back apart from the sensor's.

It then reports all questions together with the incidents code facts opened, and how precise the
incidents were in the end, split by who raised them and what Jev said.

| Flag | Effect |
|---|---|
| `--ask` | Asks the current questions again against the kept views, at one call each |
| `--limit N` | Keeps the newest N assessments |
| `--per-day N` | Replaces the day's budget |
| `--model ID` | Keeps only what one model version answered. A threshold tuned on one version does not carry to another |
| `--sample N` | Offers turns nothing was raised on |
| `--missed ID` / `--fine ID` | Marks a sampled turn. This is the only part of the report that says anything about what was never raised |

## The patrol

The patrol runs every `tickSeconds`, 30 s by default, and rounds never overlap. Each round:

1. Reads the open seats, follows the watched ones it does not know yet, lets go of the gone, and
   checks every watch for a long turn.
2. For each project, runs these steps in order. Each step is guarded on its own, so one broken
   project or step does not stop the round.
   1. Mails the Supervisor about idle lanes.
   2. Retells held incidents: ones waiting on Jev, ones it disagreed with, and ones there was nobody
      to tell.
   3. Marks tasks whose Peer is gone.
   4. Handles open asks:
      - reminds with a STILL OPEN letter every `askRemindMinutes`, up to `maxReminders`
      - re-addresses an ask whose reader has gone to whoever supervises now
      - once the reminders run out, escalates a Peer's ask past its Lead as UNANSWERED
   5. Reads each lane's record into incidents, when the watch runs.
   6. Sweeps stray workspaces and worktrees.
   7. Finishes held teardowns.
   8. Writes `status.md`.
3. On its first round only, looks once at every project on record with no live seat, to finish a
   teardown a restart lost.
4. Pumps every seat that has mail.

## Settings

There are two JSON layers:

- **Machine:** `~/.local/share/seatworks-v2/settings.json`
- **Project:** `~/.local/share/seatworks-v2/projects/<slug>/settings.json`

For any single value the project layer wins. Rules from both layers are joined, machine first.

A layer can set the following. Unknown keys are refused.

| Setting | Panel control |
|---|---|
| each role's agent, model and thinking level | yes |
| each role's rules | by hand |
| MCP servers: on or off, for which roles, with which settings, plus a new name, a pasted connection, a replacement rule, per-role tool lists, or removal | yes |
| rules for every seat | by hand |
| the Flow switch | yes |
| the Flow interval | by hand |
| `attention.watch`, the mail switch | yes |
| `attention.by`, what reads the seats | by hand |
| the other attention values | by hand |
| the sensor's key, in the machine layer only | yes |

**The key is never read back.** `readSettings` replaces the key with the word `KEPT` from
`shared/rpc.ts`, in the layer it returns and in the machine layer a project screen is given.
`writeSettings` puts the stored key back under any save that carries that word. A write is the whole
layer, so this is what keeps the key through a save about something else. A layer with no `sensor`
block at all is the owner forgetting the key.

**A broken file is reported by position.** A file that will not parse is reported by the place the
parser stopped, never by what it read. That text is as likely to be the key or a server's token as
anything else. The report is shown on the settings screen, in the team's errors and in the Health
report.

**Saves are checked.** A save carries the revision it was read at, which is a hash of the parsed
content with its keys sorted.

- If the file has changed since, the save answers `conflict`.
- A file that does not parse is never overwritten.
- A save is refused if its team does not resolve, or if it would make a buildable seat unbuildable.
  For example, a word a role may not see in your own rules is refused here.
- A machine-layer save also reconciles the Paseo providers; a project-layer save does not.

| Attention value | Default |
|---|---|
| `tickSeconds` (a project may set it, but only the machine layer's is read) | 30 |
| `leadIdleMinutes` | 12 |
| `askRemindMinutes` / `maxReminders` | 15 / 2 |
| `watch` | false |
| `by` | `seat` |
| `watcherQuietSeconds` / `watcherEveryMinutes` | 60 / 5 |
| `watcherChars` / `watcherRotateAfter` | 12000 / 40 |
| `watcherJudgeMinutes` | 10 |
| `incidentsPerDay` | 5 |
| `longTurnMinutes` | 30 |
| `destructive` / `testPath` / `suppressed` / `repeatsAt` | patterns and 3 |
| `reworksAt` / `reviewsAt` | 3 / 3 |

A pattern that does not compile is refused at save time.

**Replacing the preset.** A `roles.json` in `~/.local/share/seatworks-v2/` replaces the shipped one
whole, including its provider prefix and its attention block.

- A role there may point at its prompt and skills by absolute path. `extraSkills` are always read
  from this package.
- A role needs no tool set; one without it simply gets no desk tools, and no desk server.
- A role names `defaults` or `follows`, never both. `follows` names another role that chooses for
  itself. Until a layer gives the follower its own agent, model or thinking, it takes what that role
  has in force, the owner's choices included. The kit copies that role's defaults onto it, so every
  reader of the kit sees a harness, and the panel says "Not set · follows the Peer".
- Each role name still needs its settings files under `plugin/harness/<agent>/settings/`.
- On Codex it also needs the Codex rules file.
- If it has a tool set, `plugin/mcp/tools.json` must define that set.

With the prefix empty, the plugin stops cleaning up its own stale entries in `~/.paseo/config.json`.

## MCP servers

| Server | Kind | What it gives |
|---|---|---|
| `team` | Always there, for each seat with a tool set | The desk verbs in the role's tool set |
| `intellij-index` | Proxy over HTTP to a JetBrains IDE | Code-index tools per role |
| `code-search` | Proxy over stdio (`uvx … semble`) | One `search` tool |
| `context7` | Plain HTTP server, no key | Library documentation. Queries leave the machine |

**When a server serves a project.**

- Catalog servers stay off until a settings layer switches them on for some roles.
- A server that names no roles goes to every role with desk tools except one that can `watch`: the
  Watcher reads what it is mailed, and a pasted server's tools can write.
- An entry's `requires` lists paths a project must have for the entry to serve it. `intellij-index`
  requires `.idea`, so a project the IDE has never opened gets neither the server nor its rule, notes
  and skills.
- Each server's `rule.md` and tool list go into the seat's working rules, and its skills are linked
  into the seat.

**What the proxy can do.** Each proxied entry runs through `plugin/mcp/code.mjs`. The entry's `proxy`
block switches on any of seven things:

- pin every call to the seat's git root, and hide that argument from the schema the seat sees
- send changed files to the backend before a call
- open the working copy in the backend when a call says it is not open
- close it there when the desk removes that working copy
- wait out indexing
- rewrite known errors
- replace a tool's description with the entry's own wording

**What each shipped server uses.**

- `intellij-index` pins, syncs, opens, closes, waits out indexing and rewrites errors. Both the desk
  and the proxy add `.idea/` to the repository's `.git/info/exclude`. The desk opens each working copy
  it hands out in the IDE, syncs a reused one, and closes a slot's window when the slot is removed. It
  never closes the project's own. Opening and closing need `ide_open_project` and `ide_close_project`
  switched on in the IDE plugin.
- `code-search` pins, and rewrites what `search` says it is for.

When the backend does not answer while tools are being listed, the proxy still lists them, each with
the reason it will fail and a placeholder schema. A seat then reads why, rather than finding an empty
server.

## The panel

`index.client.tsx` adds a **Seatworks** sidebar item. It opens on a list of projects, with a
**Machine defaults** row and an **Add project** dialog. The dialog has three steps: Repository, Team,
then Check. Check is a summary of what will be saved, and runs nothing.

Machine defaults and every project open the same four tabs:

- **Team:** the agent per role, its model where the agent offers more than one, and its thinking
  level where the agent has one. Then **Watch**, in two cards:
  - whether the watch runs, which the key decides
  - what becomes of what it marks

  `watchState` in `client/data.ts` chooses the wording, so a test can hold the screen to it.
- **Flow:** Supervisors, lanes, tasks and open asks. It is polled with a revision, so an unchanged
  view is not sent again, and it draws at most 50 open lanes. Then **the watch** card:
  - What the watch has done in this project, from the record: the incident book for what it marked
    and how each was judged, and a `stat` of the kept assessments for when it last read a turn.
  - The live seats, while there are any, each with its readings, cost, and the highest any question
    has reached on it.

  `watchCard` in `client/data.ts` chooses the wording. On Machine defaults, Flow only sets the live
  switch.
- **MCP:** switch servers on or off, choose their roles and options, and add one from a pasted
  snippet.
- **Health:** the checks for this machine and, on a project, the status report built from the ledger
  as it is now. This is not the `status.md` the patrol writes; it also carries the held mail and the
  seats waiting on the Human.

Detaching a project removes its settings and its record of itself. It leaves the ledger, the
incidents, the assessments and the logs where they are. Detaching is refused while:

- a lane is open
- a lane is still restoring
- a working copy is checked out

The client talks to the server only through the thirteen `seatworks.*` RPCs in `shared/rpc.ts`, and
uses all of them. It also reads Paseo's own project list. Nothing is pushed to the client: it reloads
after every save, and the Flow tab polls.

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
gate and slot event. The watch writes its own kinds there and nowhere else:

| Group | Kinds |
|---|---|
| Watch | `watch.fact`, `watch.finding`, `watch.sensor`, `watch.unbriefed`, `watch.offline` |
| Sensor | `sensor.degraded`, `sensor.unkept` |
| Incidents | `incident.open`, `incident.judged`, `incident.held`, `incident.told`, `incident.read`, `incident.ack`, `incident.lookup-failed`, `incident.post-failed` |

A sensor that is misconfigured or unreachable shows up there, and nowhere in Health.
`call.malformed`, from [Reading turns](#reading-turns), is the one line written from outside the
watch.

## Testing

`cd plugin && npm run check` runs `tsc` over the server and the client, then `node --test` over
`test/**/*.test.ts`.

- The tests drive the desk, the outbox and the runtime through fake ports.
- A real-kit test builds every role on every shipped agent. It builds the Codex seats only where
  `codex` is installed, because building one asks Codex for its model catalog.
- No test launches a seat.
- Every question the sensor asks must have, in `test/sensor/cases.json`, a turn that should make it
  read high and one that should not. That is checked inside `npm test`, needs no key, and means a
  question cannot ship unmeasured.

Three commands sit outside `npm run check`, because they call real models:

| Command | What it measures |
|---|---|
| `npm run eval:triggers -- --agent "…"` | Whether a real agent opens each shipped skill on the briefs it should |
| `npm run eval:sensor` | A question's wording. It puts each case in `test/sensor/cases.json` (a brief and a trail, built into views by the same `viewsOf` a seat's turn goes through) to the real sensor, and fails when one reads the other way |
| `node bin/calibrate.ts <project>` | A question's threshold, against what the Supervisor marked in a real project. It calls Jev only with `--ask` |

## Known limits

- **Devin cannot be steered.** Mail to a running Devin seat waits for its turn to end.
- **Pi and Devin have no sandbox.**
  - Pi has no command rules either, and the preset narrows tools only for its Reviewer. A Pi Lead,
    Peer or Supervisor runs Pi's own defaults.
  - Devin's roles are limited by permission denials, which include commands such as `git push` and
    `gh`, but Devin has no path rules.
- **Codex command rules match argument prefixes**, so `git -C <path> push` is not caught.
- **A steer Paseo cannot hand over replaces the turn** rather than waiting, which is the interruption
  the 60 s wait exists to avoid. A Claude seat that is compacting refuses a steer the same way.
- **A turn that was running before a daemon restart** is never steered, only held, and is read as
  having started 30 minutes ago.
- **A project-layer settings save** does not rewrite the Paseo providers, so the defaults they show
  come from the machine layer.
- **The watch cannot see a sub-agent.** What a seat's own sub-agents do is not on its timeline, so no
  fact is read from it.
- **Nothing checks the sensor.** Health does not look at the key, the endpoint or the watch switch.
  `events.log` is where a sensor that will not answer shows up.
