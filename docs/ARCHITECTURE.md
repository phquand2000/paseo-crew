# Architecture

How Seatworks works inside, for a contributor, in one sitting. The [README](../README.md) says what it does;
[REFERENCE.md](REFERENCE.md) holds every name, value and letter.

**One rule governs it: the plugin serves SLP and never constrains it.** It owns session lifecycle, transport,
routing, notification, durable state and provenance; whether the work is right is always a seat's call, or the
Human's.

## Bird's eye

![Seatworks inside Paseo](images/overview.svg)

| Process | Seatworks code in it |
|---|---|
| Paseo daemon | `server/**`, entered through `index.server.ts`: the runtime, the desk, the watch, the patrol, the outbox |
| Paseo app | `client/**`, the panel, entered through `index.client.tsx` |
| A seat: an agent started from a `sw2-<role>-<agent>` provider | `bin/git-shim.mjs`, which its `git` runs, and `bin/seat-room`, the launcher of a Claude Code seat |
| A seat's MCP servers | `mcp/team.mjs` (the desk verbs), and `mcp/code.mjs` for proxied servers |

Paths are under `plugin/`. The daemon and the seats share no memory; two channels join them:

- **Seats reach the plugin through a socket**, `desk.sock` in the state root, open to this user alone: each
  seat's `team` server keeps a line to it, shows the key the seat was created with, and hears each answer on
  the same line.
- **The plugin reaches seats through Paseo**: it starts them in workspaces, follows their timelines, and mails
  them with `agents.ref(id).send`.

Its records, mail, seat keys and working copies live under the state root, `~/.local/share/seatworks-v3/`, and
a seat directory per role and agent under that agent's own folder, such as `~/.claude/profiles/`.

## The workflow in code

The [four phases](../README.md#how-a-piece-of-work-goes) as the code runs them: who acts, by which verb, what
changes on record, who is mailed ([verbs](REFERENCE.md#desk-verbs), [letters](REFERENCE.md#letters)). Mail for
the Supervisor goes to the seat that opened the lane while it is seated, else to the project's most recently
active seat that can `supervise`.

### Brief

The Human is there and starts the Supervisor from its registered provider; no code starts or archives one.
With its `grilling` skill the Supervisor settles new work with them in numbered rounds of questions, each with
a recommended answer, and writes each settled answer into `CONTEXT.md` in the project's state; no verb is
called. After a read-back (the lanes, their outcomes and acceptance, what will bring the Human back), the
Supervisor records the standing orders they keep with `set_project`, in `project.json`: `askFirst` paths
offered among access, money and what ships, risk rules, `laneHome`. What should wake the Human goes into
`notebook.md`, which no code reads.

### Run

The Human may be away. Each row is a verb a seat calls, or something the desk reads for itself.

| Who | Verb or event | On record | Mailed |
|---|---|---|---|
| Supervisor | `open_lane` | a lane, `open` with a working copy, a branch and a Lead the desk seats, or `waiting` until its `after` lanes land | the Lead starts from its OWNER DIRECTIVE |
| Lead | `add_tasks` | tasks, `waiting`; each goes `running` with a Peer of its own once what it waits for has merged | each Peer starts from its TASK brief |
| Peer | `done` | the task `done`, with a hand-back file and the gate's verdict | HANDBACK to the Lead, or to the Supervisor once the Lead is gone |
| Lead | `accept` | `queued`, then `merging` and `merged` through the lane's merge queue | MERGED, MERGE RED, MERGE CONFLICT, MERGE WAITS or MERGE FAILED to the Lead |
| Lead | `rework`, `amend_task`, `cut` | the task back in `rework` for its Peer, changed, or `cut` | REWORK or AMENDED to the Peer; STRUGGLING, ARCHITECTURE or TURNING to the Supervisor at the moments SLP names |
| Lead | `start_review` | a review task, `L<n>-R<k>`, `running` at once | the Reviewer starts from its REVIEW brief; its verdict comes back as HANDBACK |
| Peer, Reviewer | `ask` | an ask, `open`, to the Lead; a Peer's `bestGuess` is its default, a Reviewer's has none | ASK to the Lead, or to the Supervisor once the Lead is gone; UNANSWERED to the Supervisor once reminders run out |
| Lead | `ask`, with the `default` it works on meanwhile | an ask to the Supervisor | ASK to the Supervisor |
| Supervisor, Lead | `answer`, `message` | the ask `answered` | ANSWER to the asker, and ANSWERED FOR YOU to the seat it was put to when another answers; MESSAGE, with RECONCILE to the Lead first when the Supervisor writes to a Peer |
| Supervisor | `amend_lane` | the lane amended, its `ready` cleared | AMENDED to the Lead |
| Supervisor | `hold_lane`, `resume_lane` | `onHold` set, or cleared | HOLD past the outbox to the Lead and each seat of a task not merged or cut; RESUMED |
| The watch | a fact in a turn or in a lane's record | an incident in `incidents.json` | INCIDENT to the Lead or the Supervisor, once it is told |
| Turn ends, the patrol | a silent, failed or gone seat; an idle Lead | a task `stalled` | the nudge, SILENT, FAILED, STRUGGLING, LANE IDLE, LEAD GONE |

The Human meets the run four ways, all under [The Human in the loop](#the-human-in-the-loop): a question the
Supervisor queues with `ask_human`; a page to their phone, sent with no hold first as a Lead's or Peer's
command that cannot be undone opens an incident; words they type into a Lead's or Peer's chat (HUMAN WROTE to
the Supervisor); and a permission prompt (WAITING FOR PERMISSION to the seat's owner).

### Land

| Who | Verb or event | On record | Mailed |
|---|---|---|---|
| Lead | `report` with `ready` | queued merges settle; the lane gate and its rehearsals run; `ready` is set, red gate or not; open `costly` questions about the lane are parked and the lane held | REPORT to the Supervisor, with the gate's verdict, the `askFirst` hits and what the desk read of the lane |
| Supervisor | `land_lane` | base merged in, the gate run, the change read against `askFirst`, then landed on the local base: the lane `closed` and `landed`, its unsettled tasks cut, its Peers let go | BASE CONFLICT or LAND HELD to the Lead; CAN LAND to the Supervisor; LANE CLOSED to the Lead, which stays; CLEARED to the lane a detour served |
| The Human | Approve or Send back, on the Flow tab | approved, the desk tries to land the lane at once; sent back, the hold is dropped and the lane stays open | LANDED, HELD AGAIN, APPROVED, CHANGED or SENT BACK to the Supervisor; LAND SENT BACK to the Lead |
| Supervisor | `drop_lane`, `release` | the lane `closed` without landing, its branch kept; a kept Lead archived, its copy put away | LANE CLOSED to the Lead; CLEARED, as on landing |

A landing that touches an `askFirst` path waits for the Human's approval on the Flow tab. `ready` is evidence,
not a condition: a lane never reported ready still lands, saying so in its evidence; only a landing the Human
approved needs it. [A lane](#a-lane) has the order `land_lane` works in.

### Report

The Human comes back to the panel: the Report tab tells the last day from the record, and the Orders tab shows
what they settled. Pushing and releasing are theirs: the desk moves only the local base, and every seat's
`git` refuses a push (`release` in the code lets a kept seat go).

## Invariants

These are mostly absences, so the code will not show them to you.

- **The plugin never judges the work.** A gate result is evidence; the one verdict the desk acts on is a red
  gate, overridden by `overGate` with a reason: a task's by its Lead at `accept`, a lane's by the Supervisor
  at `land_lane`. A landing held for `askFirst` is the Human's standing order, not a verdict.
- **Capabilities, not names.** No code under `server/` compares a role to a name; what a role can do
  (`supervise`, `lead`, `work`, `write`, `review`, `watched`, `judge`, `page`) decides who is mailed, seated,
  watched, asked to judge or sent to page.
- **One door to Paseo.** In `server/`, only `adapters/paseo/` imports Paseo's SDK: it registers the hooks,
  binds the daemon's API from each hook and panel call, and serves it behind `core/ports.ts`, so tests use
  fakes; beyond it, only `index.server.ts`, `shared/rpc.ts` and the panel use the SDK.
- **One place checks arguments.** `desk/args.ts` checks every call against the schema its role's tool set
  shows in `mcp/tools.json`, before any verb runs; each verb's zod input, held equal to it by a test, types
  the handler, and where verbs share a name (`ask`, `done`, `release`) that schema picks one.
- **One table per lifecycle.** A lane, task, ask or question changes status only by a move in its table in
  `server/domain/`, inside the transaction on `ledger.json`; an incident's delivery, likewise.
- **One place writes letters**: `desk/letters.ts` and the `*-letters.ts` beside it, each letter keyed by kind
  and ids and ending in one `Next:` line. First prompts come from `desk/briefs.ts`, `desk/directive.ts` and
  `desk/pager.ts`, and a Watcher's from its first CASE.
- **One writer per working copy.** The project's checkout holds one lane at a time; a lane-mode task holds the
  lane's copy on its own branch from its start until it is merged or cut, a failed merge included.
- **No hidden command chain.** A Peer the Supervisor messages has its Lead told first; when one seat answers
  an ask put to another, that one is told; the Human's words in a Lead's or Peer's chat go to the Supervisor.
- **The watched seat never hears what the watch concluded about it**: no incident is addressed to it, and a
  `message`, `answer`, `rework`, `amend_task` or `amend_lane` that names or quotes an open incident about the
  seat it goes to is refused.
- **No heartbeat.** Nothing wakes a seat on a timer: the patrol mails only when what it reads calls for it,
  and a letter that asks nothing waits for one that does.
- **The desk keeps out of the Human's files.** No file of its own goes into the project's tree (a code index
  may add patterns to `.git/info/exclude`), and what roles share is in their prompts; in git it makes lane and
  task branches and `refs/seatworks/lanes/<id>`, moves the local base only at a landing, and pushes nothing.
- **Skills and guides are copies** under the state root's `content/`, never links into a repository, since
  some agents load the `AGENTS.md` above every file they read.
- **All or nothing.** A seat directory is written only when the whole seat can be built, else the launch is
  refused with the reason; a kit that fails to load leaves the plugin inert, the problem named.

## Code map

| Path | What it does |
|---|---|
| `server/core/` | The ports, the timeline stream reader, atomic stores, `git`, the gate runner, the ref moves that merge a task and land a lane (`land.ts`), an MCP client, the plugin's paths |
| `server/domain/` | Each kind's lifecycle as one transition table: lanes, tasks, asks, the Human's questions, incidents. Imports nothing |
| `server/adapters/paseo/` | Paseo itself: its hooks and panel calls in the plugin's own types, and its agent, workspace and model API behind the ports |
| `server/adapters/decisions.ts` | A sensor asked over HTTP, behind the `Judge` port |
| `server/catalog/` | The kit's data made into seats: the kit loader and its schemas, team resolution from the settings layers, Paseo providers, seat directories, launch config, prompts and skills with their lint, MCP servers |
| `server/desk/` | The ledger and what the verbs do to it: lanes, tasks, working copies, merges, gates, landing, asks, questions, incidents, letters, and the Human's side of the panel |
| `server/desk/tools/` | One module per verb, each a zod input and a handler; `registry.ts` lists them |
| `server/runtime/` | The composition root (`runtime.ts`) and the loops: hooks, seat keys, the desk's socket, the outbox, the patrol, turn reading, RPC, settings, health |
| `server/runtime/watch/` | The watch: the window over a timeline, the facts read from it and from each lane's record, and the findings they make |
| `server/upkeep/` | The plugin's own upkeep behind the Plugin tab: updating its clone, clearing what nothing uses, migrating settings, settling content the kit changed |
| `client/` | The panel: `state/` reads and saves through RPC, `model/` edits a settings layer, `format/` decides what a card says, `ui/` draws the cards |
| `shared/` | What panel and server share, as zod schemas both take their types from: the RPC contracts (`rpc.ts`), each answer's shape (`views.ts`, which the panel checks every answer against), the settings layer (`settings.ts`) |
| `mcp/` | `team.mjs`, `code.mjs`, `tools.json` (the tool sets: titles, hints, schemas) and `instructions.json` (what each set's server is for) |
| `bin/` | `seat-room`, the launcher that refuses a seat the plugin did not configure, and `git-shim.mjs`, the `git` every seat runs |
| `roles.json` | The SLP preset: roles, capabilities, tool sets, prompts, skills, defaults, `writes`, attention values |
| `harness/<agent>/` | How each agent is set up: `harness.json`, base and per-role settings, and `delta/<role>.md`, what a role's prompt needs said against that agent's own instructions |
| `catalog/` | Optional MCP servers (`mcp/`); `ecosystem.json`: gates, one-writer paths, risk rules, test and docs names, the watch's patterns; `paseo.json`: Paseo's own tools; `refused.json`: what a seat's `PATH` refuses; `sensor/`; `checks.json`: the watch's questions |
| `content/` | What seats read at run time: prompts, skills, guides, and the records seeded into a project. Not documentation |

`test/architecture.test.ts` holds each folder to what it may import: `core/` and `domain/` import no other
folder, `desk/` never imports `runtime/`, only `runtime/` imports `upkeep/`, and `mcp/` and `bin/` import none
of the plugin's code. It refuses import cycles and unused exports, holds files to 300 lines (tests to 400) and
functions to 50, and fails on an agent, MCP server or sensor named in code; its lists of known breaches only
shrink.

## From data to a running seat

![From data to a running seat](images/seat-build.svg)

1. **Plugin start.** `loadKit` reads `roles.json`, each `harness.json`, the MCP catalog and the `catalog/`
   files, each against its schema, and the tool sets. The plugin writes a Paseo provider and profile per role
   and agent, thirty for the shipped kit, reloads the daemon only when they changed, and opens `desk.sock`.
2. **Before `agent.create`.** `Seating.ensure` builds the seat directory for that role, agent and project:
   settings with the role's overlay, deny rules and sandbox, MCP servers an agent reads from a file, working
   rules, skills linked to their copies. `applyRole` sets model, thinking, mode and system prompt (the role's
   prompt, then the agent's `delta/<role>.md`) and hands over MCP servers the agent takes at launch; a seat
   with desk tools gets a fresh key in `SEATWORKS_DESK_KEY`.
3. **Before `agent.session_open`.** The plugin seeds the project's records (`notebook.md`), rebuilds the
   directory if its inputs changed, points the agent's config directory at it, sets `SEATWORKS_ROLE`,
   `SEATWORKS_PROJECT` and `SEATWORKS_STATE`, binds the key, and puts the state root's `bin/` first on `PATH`:
   a `git` running `bin/git-shim.mjs`, which refuses the commands kept for the desk (push, pull, merge,
   checkout, reset and the like) however they are spelled, and a `gh` and a `paseo` that only refuse.
4. **`bin/seat-room`** refuses a Claude Code launch the plugin did not configure, forces
   `--setting-sources user`, and `exec`s Claude; the other agents start through Paseo's own providers.

The desk starts every seat but the Supervisor, in a Paseo workspace, labelled with its project, role, lane and
task, under a parent: a Lead under the Supervisor that opened its lane or replaced its Lead, a Peer or
Reviewer under its Lead, the Watcher under the Supervisor, a Pager under nobody, as Paseo pushes the first
reply of an agent with no parent to the Human's phone.

The build runs the content lint: a prompt, working rule, skill or tool set showing a word from the role's
`hidesWords` fails (a Peer may not read "seat"), as does a placeholder other than `{{guides}}` and
`{{state}}`, any in a skill, or a path under the project's state the role does not declare in `writes`, unless
it is the desk's own record, which no role may declare. On Claude Code and Codex a seat's shell writes only
those paths under state; Claude Code's file tools, outside its sandbox, may not write the desk's records, the
seat keys, the mail, the content seats read, the `git` launcher, any agent's configuration or the user's git
configuration, nor read any agent's login ([seat directories](REFERENCE.md#seat-directories)).

## Records

A project's records live in `projects/<slug>/` under the state root
([state on disk](REFERENCE.md#state-on-disk)).

- **`ledger.json`**: lanes, tasks, asks, the Human's questions, the seats bound to them, working-copy slots,
  id counters. Each change is one synchronous transaction (`DeskContext.transact`): read, decided on and saved
  with nothing awaited between, so no other change lands in the middle. A change to a ledger that cannot be
  read is refused, never made over an empty one; only the Human repairs it.
- An unreadable **`incidents.json`** or **`project.json`** is never written over either, and an unreadable
  `project.json` holds every landing for the Human.
- **`events.log`** is the provenance: a JSON line per tool call and per lane, task, merge, gate, slot and
  watch event, each kind a case of `DeskEvent` in `desk/events.ts` that only ever gains fields.

The tables in `server/domain/` hold each lifecycle: a lane's (`waiting`, `open`, `closed`), a task's, an ask's
(`open`, `answered`), a question's (`open`, `answered`, `declined`, `canceled`), an incident's delivery
(`unsent`, `held`, `told`). Ready, on hold, held for the Human, landing and landed are lane fields (`ready`,
`onHold`, `landApproval`, `landing`, `landed`), not statuses; the next two drawings show both.

## A lane

![A lane, from open to closed](images/lane-lifecycle.svg)

**Where a lane works.** `open_lane` places a lane in the transaction that records it, so two lanes cannot both
take the project's own checkout.

- **In the project's checkout**, while no other lane holds it: on `lane/<id>-<title>` from base, in a clean
  checkout; or `onBranch`, carrying on the branch it is on, or a `newBranch` started there with the
  uncommitted work along, reading its change from `startSha` and merging nowhere when it lands. When the
  checkout has uncommitted work or sits off base and neither the call nor `laneHome` says, `open_lane` is
  refused with the choices, for the Human.
- **In a slot of its own**, a git worktree with its own Paseo workspace, with `isolate`, or for a detour
  (`detourOf`) while the checkout is taken; any other lane is refused then, or waits with `after`.
- **Waiting**, with `after` naming lanes not yet landed: it opens by itself, placed again, once they all land;
  never, if one closed without landing.

It is also refused where its write set or `contracts` overlap an open lane's, or its write set reaches a
one-writer path (`serialOnly`) an open lane may write ([`open_lane`](REFERENCE.md#desk-verbs) has each case).
Each copy the desk takes is opened in the project's code indexes, and a slot closed there as it goes.

**Landing.** `land_lane` waits for the project's queued merges and takes its one landing turn, so each landing
merges in the last. It is refused while a task's branch is checked out in the lane's copy; then, in order:

1. If base moved, it merges base into the lane in the lane's copy: under a seat mid-turn there it records
   `landing` and sends CAN LAND when the turn ends; a conflict is left in the copy, `ready` cleared, and BASE
   CONFLICT sent to the Lead.
2. It runs the lane gate on the result: the project's gate, then the rehearsal of each risk rule the change
   reaches. Red is refused unless the Supervisor passes `overGate` with a reason; the override goes to
   `events.log`.
3. It reads what the lane changed since base (or `startSha`). A change touching an `askFirst` path holds the
   landing for the Human (`landApproval`), with LAND HELD to the Lead, as do standing orders it cannot read
   and, with `askFirst` set, a change it cannot read; nothing else makes a landing wait.
4. It lands on the local base as `landAs` says, with no checkout: one squashed commit by default, the lane's
   own commits kept at `refs/seatworks/lanes/<id>`; a merge commit; or a fast-forward. Base moves only from
   the commit read at the start, to the head the gate saw: a lane that moved after its gate lands nothing.

The rest the desk reads goes with REPORT, the Supervisor's reply and the Human's card as evidence: commits,
files and lines, deleted or weakened tests, files outside the write set, tasks accepted over a red gate, open
incidents, what reviews leave standing, whether it was reported ready as it stands.

**Who stays.** A Peer stays after its task merges, in its own copy if parallel, until its Lead `release`s it
or the lane closes, which lets every Peer go. The Lead stays, with the lane's slot if it had one, until the
Supervisor `release`s it or it is archived in Paseo; the next round then puts the copy away, as for a gone
Peer. The project's checkout goes back to base, or stays on the Human's branch for `onBranch`; a task still on
its branch in the lane's copy leaves it, its branch kept only if it holds commits nothing else has.

**Teardown** waits for seats mid-turn in the copy, and what waits is on record (a slot's `releasing`, a lane's
`restoring`, a seat to archive in `intents.json`), so a restart loses none of it: the first round after treats
every turn that ended meanwhile as ended. A landed lane's branch goes once the landed ref holds it; a dropped
one's is kept for the Human.

**The first gate.** The first `open_lane` of a project with no gate on record detects one from its files, such
as `npm test` or `cargo test` ([gate detection](REFERENCE.md#gate-detection)); `set_project` changes it, and
an empty gate set there is never replaced.

## A task

![A task, from brief to merge](images/task-lifecycle.svg)

`add_tasks` records a Lead's tasks in one transaction, checking only their structure (keys, loops in `after`,
what each holds). Each works on a branch of its own, `task/<id>-<title>`, with a Peer of its own that never
takes another; the lane branch takes its work only by the desk's merge. A task starts once its `after` tasks
have merged, its lane is open with a Lead and not on hold, and its placement holds; one whose Peer fails to
start waits again until a task merges or is cut, the lane resumes, or more are added.

- **Lane mode**, the default: in the lane's copy, switched to its branch until it is merged or cut, one such
  task at a time, so those added together wait each for the one before. Its Peer finds where the change goes:
  `hints` fence nothing, and the lane's write set bounds it.
- **Parallel**: a slot of its own, and `holds` for what it writes, as coarsely as the work allows. What it
  holds may not be held by a task of its call that may run beside it, nor by a task at work or in the merge
  queue that it does not wait for, nor be a one-writer path or outside the lane's write set; the Peer at work
  in the lane's copy gets BESIDE as it starts.

**One way in.** At hand-back (`done`) the lane is brought into the task's branch, so its gate runs on what the
lane would become; conflicts stop the hand-back, left for the Peer to settle, with SETTLING to the Lead, and a
copy with work uncommitted is left as it is, which the hand-back says. Where the project gates tasks (a gate
set and `gateOn: task`, the default), the gate runs, then each rehearsal the change reaches, until one fails.
The hand-back names the files changed from where the branch meets the lane's, and notes those another task
holds or that lie outside what it may write.

`accept` queues a handed-back task, refused while its copy is off its branch or has work uncommitted, and over
a red gate on that commit without `overGate` and a reason. Each lane's queue merges one task at a time, beside
the other lanes':

1. The lane comes into the task's copy again if it moved: conflicts send the task to `rework`, with MERGE
   CONFLICT to the Lead; a copy that cannot take the lane leaves it `queued`, with MERGE WAITS.
2. The gate's verdict on that commit is reused, or the gate runs: red sends the task back to `done` with MERGE
   RED, unless the Lead accepted that verdict over the gate.
3. The merge commit is made from that tree with no checkout, and the lane branch moves to it only from the tip
   the task was gated with; a lane that moved meanwhile requeues it (MERGE WAITS). MERGED tells the Lead; the
   Peer is kept; waiting tasks are tried.

Uncommitted work in a copy the merge must touch holds it `queued`, the Lead told once, until a turn end, a
ready report or a close tries again. The queue is the tasks' statuses in `ledger.json`: the first round after
a start takes it up in accept order, finishing a merge that reached the lane branch and running again one that
did not. With `gateOn: lane`, no gate runs at hand-back or merge, and MERGED says so.

**Reviews.** `start_review` seats a read-only reviewing role on a review task, `L<n>-R<k>`, `running` at once
and holding nothing, in a parallel task's own copy while it has one, else in the lane's copy; with no task
named, on the whole lane. Its REVIEW brief says where to read the change and carries the question of every
risk rule the change reaches, and `done` refuses a verdict of `changes` or `reopen` without findings, or one
that leaves such a question unanswered. `accept` refuses a review; the Lead cuts it.

`rework` returns a task to its own Peer, and reopening a merged one, while that Peer is kept, clears the
lane's `ready`. `cut` archives the Peer at once and gives back its copy, refused while the task merges.
Silence stalls a task ([reading turns](#tool-calls-in-letters-out)), as does a Peer gone from Paseo, with
FAILED to the Lead; a desk call from its Peer resumes it.

## Tool calls in, letters out

![Tool calls in, letters out](images/calls-and-mail.svg)

**In.** A seat's `team.mjs`, an MCP server on the official SDK, sends each call on its line to `desk.sock`.
The desk knows the seat by its key: made as the seat is created, bound when Paseo first opens its session,
given back at each later open, kept in `keys.json`; an unknown key is refused. It checks that the seat's role
holds the verb and the arguments fit its schema, runs it, answers on the line, and logs the call.

**The answer window.** A call still running after 240 s is answered "the answer arrives as mail"; one the
seat's harness stops, or whose line drops, has its answer mailed too, and the same call again joins the
running one. The promise is kept in `intents.json` until the letter is posted, and if the plugin stops first,
its first round back sends NO ANSWER. After a start or reload a call waits until Paseo reaches the plugin
through a hook or panel call, its 240 s counting from then. A harness that asked for progress hears every 20 s
that the call still runs. Values the desk fixes for some fields, such as the roles a Lead may seat, are shown
to the seat, and a change reaches it as a changed tool list.

**Out.** Every letter goes into one `outbox.json`. A seat's mail is pumped when a letter is posted, when its
turn ends and after each patrol round, and goes as one message, with the asks waiting on the seat listed last.
It is:

- **steered** into a running turn only when the agent takes a steer (`steers`), the turn has run 60 s since
  the desk saw it start, and the seat waits on no desk call;
- **held** while the seat waits on a permission, runs or starts, or its lane is on hold, and for up to 10
  minutes after its last mail, until it ends a turn;
- **kept** while every letter for it asks nothing of it (`wakes: false`), such as a task started or a landing
  held, to go with the next that asks something or ride into a steer;
- **sent** otherwise.

HOLD alone goes past the outbox, as an interrupt that cuts a running turn short where the agent allows it. A
repeat of a letter's kind and ids for the same seat is dropped while the first waits and for 30 minutes after.
A letter untaken in 7 days is given up on; a gone seat's mail goes to no other seat, and `status.md` lists it
until then. The desk picks each `Next:` line from what it knows (a red gate, an ask's kind, a Lead gone, the
lane's last task merged), so no prompt holds a table of letters ([mail](REFERENCE.md#mail)).

**Reading turns.** A turn end archives a seat that waited for it, finishes teardowns it held up, sends CAN
LAND and retries held merges; then `TurnRules` reads the turn in code, with no model call:

- A failed turn goes to the seat's owner as FAILED: a Lead's to the Supervisor, a Peer's to its Lead, or to
  the Supervisor once that Lead is gone. A permission request goes the same way as WAITING FOR PERMISSION,
  unless refused: any while the seat's lane is on hold, and a question that would stop the turn. The
  Supervisor's own are only logged, and `status.md` lists them under "Waiting on the Human".
- A Peer or Reviewer whose turn ends before its hand-back with no desk call carried out, and none running, is
  nudged; on a second such turn, or one ending on a call refused or left unfinished, its task is `stalled`,
  with SILENT to its Lead and STRUGGLING to the Supervisor.

## The Human in the loop

The Human is asked what only they can decide and told what they cannot take back; the rest goes ahead.

- **`CONTEXT.md`** holds what the project does, how it behaves and its words, as the Human settled them, in
  the shape `content/guides/CONTEXT_FORMAT.md` gives, in the project's state, never the repository. In the
  shipped roles only the Supervisor writes it, and the desk has no verb for it. A Lead's directive names it
  once it exists, as the Human's word, to ask about with kind `question` where it is silent; a Peer gets what
  its Lead copies into its brief. The Orders tab shows its first 4,000 characters.
- **Standing orders** (`set_project`): `askFirst`; `riskRules`, replacing the kit's one rule for migrations,
  schemas and SQL, which has no rehearsal; and `laneHome`, kept in `project.json` with the base, gate,
  `gateOn`, `serialOnly` and `landAs`. Where lanes work comes back as an `open_lane` refusal whenever the
  checkout makes it a question and nothing says.
- **Questions.** `ask_human` carries 2–4 options with their effects, the one recommended and why, what happens
  if the Human is silent, and a class. Nothing times out; the class says what goes ahead meanwhile:
  `reversible`, everything; `costly`, the lane, until it reports ready, when the desk parks the question and
  holds the lane; `irreversible`, nothing, its lane held at once. A `reversible` question about a lane whose
  write set or change reaches `askFirst` becomes `costly`. At most `questionsPerDay` (3, set by hand in a
  settings layer) go out in 24 h across every project on the machine. The Human answers on the Flow tab, an
  option or Decline with a note, and HUMAN ANSWERED tells the Supervisor what that turns round; or in its
  chat, which `record_human_answer` takes only with a quote found among the Human's own messages there. No
  Lead is mailed, and a held lane stays held until `resume_lane`
  ([questions for the Human](REFERENCE.md#questions-for-the-human)).
- **No question stops a turn.** A permission request of kind `question` from a seat with desk tools is
  refused, naming where to ask: `ask_human` or its reply for the Supervisor, `ask` for a Lead, Peer or
  Reviewer; the Watcher settles it from what it has.
- **Holds.** `hold_lane` sets `onHold`, calls off a landing waiting or held for the Human, approved or not,
  and sends HOLD to the Lead and the seat of each task not merged or cut. Until `resume_lane`, their mail
  waits, their permission requests are refused, `add_tasks`, `accept` and `land_lane` are refused, no task
  starts and a waiting lane does not open; `start_review`, `replace_lead`, `rework`, `cut`, `amend_task`,
  `message`, `report` and merges accepted before it go on. Only the Supervisor lifts a hold, the desk's own
  included.
- **Landings held for the Human** keep the head they were held at, the `askFirst` hits and the evidence, shown
  on the Flow tab with a note, Approve and Send back. A head moved since the hold drops it, whatever the Human
  chose (CHANGED to the Supervisor). Otherwise, approved, the desk tries to land the lane at once for the
  Supervisor, with the `overGate` it was held with, and tells it LANDED, HELD AGAIN or APPROVED (not landed
  yet, the approval standing while the head does); sent back, the hold drops, the lane stays open with `ready`
  as it was, and LAND SENT BACK brings the note to the Lead. No verb lets a seat approve.
- **Pages.** Only `destructive` opens one. As its incident opens, INCIDENT goes to the Supervisor whatever the
  watch's switch, budget or marks say, and the desk starts a Pager in the project's workspace, with no tools
  and no parent, whose one reply is the page the desk wrote, cut at 220 characters: the repository, the seat
  and its command, whether a Supervisor is told, what is held. No verb sends a page.
- **The Report tab** (`desk/away.ts`, read once as the tab opens): Needs you (questions holding a lane,
  landings held), Went ahead on its recommendation (every other open question), Landed in 24 h, Beyond a lane
  (page-level incidents of 24 h), and counts, among them this project's questions today against
  `questionsPerDay`. Flow shows questions and held landings only while "Follow the team live" is on.
- **Writing in a seat's chat.** A live message a person sent into a Lead's or Peer's chat, its id not starting
  `sw2-` as the desk's do, reaches the Supervisor as HUMAN WROTE, fenced as data; for a Peer, saying its Lead
  was not told.

## The watch

**What is watched.** Every live seat whose role can be `watched`: Leads and Peers in the preset, never a
Reviewer, the Watcher or a Pager. `core/stream.ts` joins Paseo's live timeline with its paged history, reading
back what a join, gap or reconnect missed, into a window of at most 80 entries per seat (calls, words,
thoughts, instructions, errors); a seat whose subscription fails is followed again the next round.

**Facts** are read in code as a turn runs, as each call's detail comes and settles, and at its end; each round
reads long turns and every open lane's record, for shapes that span turns. `destructive` alone is `page`, its
incident going out at once; `attend` facts, such as `stuck` or `test-weakened` in a turn, or `rework-loop` in
a lane's record, filed against its Lead, open incidents told within the lane's budget; `note` facts, such as
`gate-failed`, are evidence in `events.log`, never an incident alone ([facts](REFERENCE.md#facts);
[ANTIPATTERNS.md](ANTIPATTERNS.md) says which failure each lane fact answers).

**Incidents.** A finding joins the open incident for its seat and kind in `incidents.json`, or opens one, told
at most once as INCIDENT: an `attend` one about a Peer to its Lead while it is seated, anything else to the
Supervisor, never to the seat it is about. Until then it may be [held](REFERENCE.md#holds): in **shadow**
while `attention.watch` is off, the default ("Mail incidents" on the Supervisor's chip); on **probation** when
its kind's last ten marks were mostly noise; over **budget** once its lane had `incidentsPerLane` (2) told in
24 h, those about no lane sharing one; or for **nobody** to tell, retold by the patrol once someone is seated,
the only hold on a page. The Supervisor's `incidents` lists them all, a Lead's those about the other seats of
its lane, the Flow tab the open ones. An incident closes when marked, when its seat is archived, when its task
merges, and, for a Lead, when its lane closes.

**Questions to a model.** What a fact cannot say, the watch asks at the moment it matters, one condition per
question, of a small state `desk/checks.ts` builds from the record, never a seat's own reasoning: of a
hand-back, of a review that accepts a change a risk rule reaches, of an act a fact names, of a first change
made before any look ([each](REFERENCE.md#questions-to-a-model)). Wording, thresholds and mode are data in
`catalog/checks.json`; every mode is `shadow`, which with `off` is all the schema takes. `desk/judging.ts`
puts each case to whoever `attention.judge` names, behind the `Judge` port: a sensor over HTTP
(`adapters/decisions.ts`; the preset's Jev, over OpenRouter, its key in the request header only, the catalog's
data rules sent with every request, and nothing asked without a key), or the Watcher, one seat per project,
seated under the Supervisor at the first case, mailed a CASE per case, answering with `judge`. The case, the
question as sent and the answer go to `assessments.log`, which no seat reads; nothing waits on an answer, and
one missing after 15 minutes, or whose Watcher is gone, is kept as unasked.

**Marking.** Whoever is told of an incident marks it with `mark_incident`, `useful`, `noise` or `unknown`,
from the seat's own record, closing it; `noise` also silences the same words on that seat and kind at `attend`
level, never a page. The marks feed probation.

## The patrol

A timer runs a round every `tickSeconds`, 30 s by default, read from the machine settings each time; a round
runs once Paseo has reached the plugin, never beside another, each step guarded on its own so one broken
project stops nothing else. It lists the seats, follows each watched seat not yet followed and reads long
turns, then, for each project the desk has met since it started:

1. LANE IDLE to the Supervisor for a Lead idle `leadIdleMinutes` (12) with no task at work or in the merge
   queue, no ask of its own open, no ready report, no hold and no landing held.
2. Retell incidents held for nobody.
3. A task at work whose Peer is gone goes `stalled`, with FAILED to its Lead; a lane whose Lead is gone brings
   LEAD GONE to the Supervisor, once, whose `replace_lead` seats a Lead where the lane stands.
4. Remind an ask after `askRemindMinutes` (15) while its reader is idle, up to `maxReminders` (2), then
   escalate one a Peer or Reviewer put to its Lead (UNANSWERED); move one whose reader is gone to the
   Supervisor.
5. Read each open lane's record for facts.
6. Sweep workspaces and worktrees the desk made that nothing holds, keeping each owner's last five gate runs.
7. Take on the seat Paseo had started for a lane or task a stop left half-seated, found by its labels, or put
   back what it took; open waiting lanes and start waiting tasks whose turn has come.
8. Archive closed lanes past the newest 20 once nothing of theirs is still open.
9. Finish teardowns held for writers that are gone, and put away copies kept for seats that are gone.
10. Give up on Watcher cases unanswered in 15 minutes or whose Watcher is gone; let an idle Watcher go once no
    lane is open, or once something else judges.
11. Write `status.md`.

The first round after a start also ends what waited on turns that ended while the plugin was down, sends NO
ANSWER for answers the stop lost, and takes up the merge queues. Then every seat with mail is pumped.

## Settings

Two JSON layers: the machine's, `~/.local/share/seatworks-v3/settings.json`, and a project's,
`projects/<slug>/settings.json`. For one value the project wins; rules from both are joined, the machine's
first; a project that puts a role on another agent drops the machine's model and thinking for it. One strict
schema (`shared/settings.ts`) reads both, so an unknown key is refused; `tickSeconds` comes from the machine
layer only.

- A save carries the revision it read, and answers `conflict` if the file changed since.
- A save is refused while the settings it leaves hold an error, or when it makes a buildable seat unbuildable;
  seat-build problems already there do not block it.
- A broken file is reported by where parsing stopped, never by its text, which might hold a key, and is never
  saved over; a sensor's key is never read back to the panel.
- A machine save rewrites the Paseo providers and profiles, a project save does not; either rebuilds a seat at
  its next start.

A `roles.json`, `ecosystem.json`, `refused.json` or `paseo.json` in the state root replaces the shipped one
whole ([every setting](REFERENCE.md#settings)).
