# Architecture

How Seatworks works inside, in one sitting. The [README](../README.md) says what it is and how to
install it. Lookups such as verbs, letters, facts, settings and files are in
[REFERENCE.md](REFERENCE.md).

**One rule shapes everything: the plugin serves SLP and never constrains it.** It owns session
lifecycle, transport, routing, notification, durable state and provenance. Whether the work is right
is always a seat's call.

- [Bird's eye](#birds-eye)
- [Invariants](#invariants)
- [Code map](#code-map)
- [From data to a running seat](#from-data-to-a-running-seat)
- [A lane](#a-lane)
- [Tool calls in, letters out](#tool-calls-in-letters-out)
- [The Human in the loop](#the-human-in-the-loop)
- [The watch](#the-watch)
- [The concept](#the-concept)
- [The patrol](#the-patrol)
- [Settings](#settings)

## Bird's eye

![Seatworks inside Paseo](images/overview.svg)

| Process | Seatworks code in it |
|---|---|
| Paseo daemon | `plugin/server/**`, entered through `index.server.ts` |
| Paseo app | `plugin/client/**`, the panel, entered through `index.client.tsx` |
| A seat: an agent started from a `sw2-<role>-<agent>` provider | Only `bin/seat-room`, the launcher for Claude seats |
| A seat's MCP servers | `mcp/team.mjs` (the desk tools), and `mcp/code.mjs` for proxied servers |

The daemon and the seats share no memory. There are two one-way channels:

- **Seats reach the plugin through a socket**, `desk.sock` in the state root, open to this user alone:
  each seat's `team` server keeps a line to it and shows the key the seat was created with.
- **The plugin reaches seats through Paseo**, with `agents.ref(id).send`.

## Invariants

These are mostly absences, so the code won't show them to you.

- **The plugin never judges the work.** A gate result is evidence the Lead weighs. The only verdict
  the desk acts on is a red gate when a lane lands, and the Supervisor can override it. A landing that
  touches a path the Human asked about first waits for them: that is their standing order, not a verdict.
- **Capabilities, not names.** No code under `server/` compares a role to a name. What a role can do
  (`supervise`, `lead`, `work`, `write`, `review`, `watched`, `judge`, `page`) decides routing,
  acceptance, watching, judging and paging.
- **One door to Paseo.** Only `server/adapters/paseo/` imports Paseo's SDK: it registers the hooks,
  binds the daemon's API from each hook and panel call, and calls the agent, workspace and model API.
  Everything else depends on the ports in `core/ports.ts`, in the plugin's own types, so the tests
  use fakes.
- **One place checks arguments.** `desk/args.ts` checks every call against the schema its seat was
  shown, before any verb runs. Each tool's zod input, which a test holds equal to that schema, types
  what its handler reads; a tool set picks among tools of one name by the schema it shows.
- **One table per lifecycle.** A task, lane, ask or incident changes status only through its table
  in `server/domain/`, checked inside the ledger transaction against the status it has then.
- **One place writes letters.** Everything the desk mails a seat is in `desk/letters.ts` and, for
  asks, merges, landings and the Watcher's cases, the `*-letters.ts` beside it: each letter is keyed by its kind and ids, and
  ends with one `Next:` line, what it asks of whoever reads it. What a Peer or Reviewer starts from
  is in `desk/briefs.ts`, a Lead's directive in `desk/directive.ts` and a Pager's two lines in
  `desk/pager.ts`; a Watcher starts from its first case.
- **One writer per working copy.** A lane-mode task holds the lane's copy, on its own branch, from
  start until it is merged or cut, a failed merge included.
- **No hidden command chain.** When the Supervisor messages a Peer, the Peer's Lead is told first.
- **The desk writes nothing of the Human's.** No file in the project is written by the plugin; what
  every role shares is in its own prompt.
- **The watched seat never hears what the watch concluded about it.** No incident is ever addressed
  to it.
- **Nothing a seat reads resolves into a repository.** Skills and guides are copies under
  `content/`, because some agents load the `AGENTS.md` above every file they read.
- **All or nothing.** A seat directory is written only when the whole seat can be built. A kit that
  fails to load leaves the plugin inert, with the problem named.

## Code map

| Path | What it does |
|---|---|
| `server/core/` | The ports, the timeline stream reader, atomic stores, `git`, the gate runner |
| `server/domain/` | Each kind's lifecycle as one transition table: tasks, lanes, asks, incidents. Imports nothing |
| `server/adapters/paseo/` | Paseo itself: its hooks and panel calls in the plugin's own types, and its agent, workspace and model API behind the ports |
| `server/adapters/decisions.ts` | A sensor asked over HTTP, behind the `Judge` port |
| `server/catalog/` | Data to seats: the kit loader, team resolution, providers, seat directories, launch config, content, the project files |
| `server/desk/` | The ledger and what the tools do to it: lanes, tasks, asks, working copies, merges, gates, incidents, letters, closing a lane |
| `server/desk/tools/` | One module per tool the seats call, each a zod input and a handler; `registry.ts` lists them for the desk |
| `server/runtime/` | The composition root and the loops: hooks, seat keys, the desk's socket, outbox, patrol, turn reading, RPC, health |
| `server/runtime/watch/` | The watch: the window over a timeline, the facts read from it and from each lane's record, and the findings they make |
| `client/` | The Seatworks panel |
| `shared/` | What the panel and server share, as zod schemas both take their types from: the RPC contracts (`rpc.ts`), each answer's shape (`views.ts`, which the panel checks every answer against) and the settings layer (`settings.ts`) |
| `mcp/` | `team.mjs`, `code.mjs`, `tools.json` (the tool sets: titles, hints, schemas) and `instructions.json` (what each set's server is for) |
| `bin/` | `seat-room`, the launcher that refuses a seat the plugin did not configure |
| `roles.json` | The SLP preset: roles, capabilities, tool sets, prompts, skills, defaults, attention values |
| `harness/<agent>/` | How each agent is set up: `harness.json`, base and per-role settings, and per-role deltas: what a role's prompt needs said against that agent's own instructions |
| `catalog/` | Optional MCP servers; `ecosystem.json`: gates, one-writer paths, test and docs names, the watch's patterns; `paseo.json`: the tools Paseo gives every agent; `refused.json`: the commands a seat's `PATH` refuses, and why; `sensor/`: where and how each sensor is asked; `checks.json`: the watch's questions |
| `content/` | Runtime content that seats read: prompts, skills, guides. Not documentation |

All paths are under `plugin/`.

## From data to a running seat

![From data to a running seat](images/seat-build.svg)

1. **Plugin start.** `loadKit` reads `roles.json`, each `harness.json`, the MCP catalog and the tool
   sets. Then the plugin writes one Paseo provider and one agent profile per role and
   agent. The shipped kit makes twenty-five: five roles on five agents. It reloads the daemon only when
   something changed.
2. **Before `agent.create`.** `Seating.ensure` builds the seat directory. This covers settings, deny
   rules, the sandbox, MCP servers, skills linked to copies outside any repository, and the working
   rules. `applyRole` then sets the model, thinking level, mode, prompt and MCP servers. The prompt
   is the role's, then its agent's delta for that role, if the agent's own instructions need one.
3. **Before `agent.session_open`.** The plugin points the agent's config directory at the seat
   directory and sets `SEATWORKS_ROLE`, `SEATWORKS_PROJECT` and `SEATWORKS_STATE`, with a `git` first
   on its `PATH` that refuses the commands only the desk runs (push, merge, checkout and the like),
   however they are spelled, and beside it a `gh` and a `paseo` that only refuse, since the desk
   talks to the forge and starts agents. It also seeds the project's records, such as `notebook.md`,
   and writes nothing into the project's own files.
4. **`bin/seat-room`** checks the launch and then `exec`s Claude. Codex, Pi, Oh My Pi and OpenCode seats start
   through Paseo's own providers.

The content lint runs during the build. A role prompt, a working rule or a skill that uses a word
from the role's `hidesWords` fails the build. For example, a Peer may not read "seat". Only
`{{guides}}` and `{{state}}` are allowed as placeholders.

Each role declares in `roles.json` what it writes under the project's state (`writes`: a file, or a
folder ending in `/`). On Claude Code and Codex, a seat's shell may write there and nowhere else under
state. The lint fails a prompt, rule or skill that names a path under state (`{{state}}/…` or
`$SEATWORKS_STATE/…`) its role does not write, unless it is the desk's own record, which seats only
read. A role may not declare the desk's own files, and only the Supervisor writes `CONTEXT.md`. Claude
Code's file tools are outside its sandbox, so their rules deny them the desk's records, the plugin's
own files beside the projects (the key file that says which seat calls, the content seats read, the
`git` launcher), every agent's configuration and git's, and deny reads of every agent's login. Pi,
Oh My Pi and OpenCode have no sandbox.

What each agent's seat directory holds is in [the reference](REFERENCE.md#seat-directories).

## A lane

![A lane, end to end](images/lane-lifecycle.svg)

The **ledger** (`ledger.json`, one per project) holds lanes, tasks, asks, agents and slots. Every
change is one synchronous transaction: the ledger is read, decided on and saved with nothing awaited
in between, so no other change can land in the middle. A ledger it can't read is refused, never
treated as empty.

**Where a lane works.**

- The first lane works in your own checkout, on a branch `lane/<id>-<title>`. The checkout must be
  clean.
- A later lane, or one that asks to be isolated, gets a git worktree slot of its own.

**Two task modes.** Every task works on a `task/…` branch of its own, and the lane branch takes work
only by the desk's merge.

- **Lane mode**, the default. The task works in the lane's copy, switched to its branch from its start
  until it is merged or cut, and then back on the lane branch. A seat has one duty for life: every
  task starts a Peer of its own, and a kept Peer never takes another. Its Peer finds where the change
  goes: `hints` say where to start reading and fence nothing, and what it writes is bounded by the
  lane's write set and what tasks beside it hold.
- **Parallel mode.** The task gets its own slot, and `holds` what it writes, as coarsely as the work
  allows: no task that may run at once holds any of it, nor is any of it a one-writer path, and a Peer
  at work in the lane's copy is told.

**One way in.** At hand-back every task has its lane brought into its branch, so its gate runs on what
the lane would become; conflicts there go back to its Peer before anything is handed back. `accept`
queues it, and each lane's merge queue merges its branches one at a time, beside the other lanes': the
lane is brought in again if it moved, the gate runs unless it already ran on that commit, and the lane
takes a red tree only when the Lead accepted it over the gate with a reason. The merge commit is made
from that very tree, and the lane branch moves to it only from the tip the task was gated with: a lane
that moved meanwhile sends it round again. The queue is the tasks' status in the ledger, so a restart
picks it up: a merge cut off before the lane moved is run again, and one that moved it is only
recorded. A copy with work uncommitted, the lane's or the task's, holds the merge: the task stays
queued, its Lead is told once, and the merge is tried again as each turn ends and before the lane lands.
A task is read from where its branch meets the lane's, never with what came in with the lane. What a
task changed is read at hand-back and at merge, not declared: a file in what another task holds,
outside the lane's write set, or outside what a parallel task holds is a note to its Lead.

**Landing.** `land_lane` does four things in a fixed order:

1. If the base moved, merge the base into the lane, in the lane's copy. A conflict here is the Lead's
   to settle.
2. Run the gate on the result.
3. Read what the lane changed since it left its base. If it touches a path in the project's `askFirst`,
   the landing waits for the Human's approval on the panel; nothing else makes it wait.
4. Land it on the base the project's way (`landAs`): one squashed commit by default, with the lane's
   own commits kept at `refs/seatworks/lanes/<id>`, a merge commit, or a fast-forward.

Landings in one project run one at a time, so the next one merges in what the last one landed. The base
moves only from the commit read at the start, and what lands is the head its gate saw: a landing never
writes over another, and a lane that moved after its gate lands nothing.

A task still on its branch in the lane's copy, a seat mid-turn, a conflict or a red gate refuses the
call and leaves the lane open. Only a red gate
can be overridden, with `overGate`, and the override is written to `events.log`. Everything else the
desk reads of the lane (deleted or weakened tests, files outside the write set, open incidents, what
its reviews leave standing) goes with the REPORT letter and the reply as evidence. A review whose range
touches a path the project's risk rules name (the kit's cover migrations, schemas and SQL) carries
their questions, and its verdict is refused until it answers them.

**Who stays.** A Peer stays after its task is merged, a parallel task's in its own copy, until its Lead
releases it; the next round puts away the copy of one archived in Paseo. Closing a lane lets its Peers go.
Its Lead stays, with the lane's copy of its own if it had one, until whoever supervises releases it or
it is archived in Paseo, which archives a Supervisor's Leads with it; the next round then puts that
copy away. Your checkout goes back to base at close. A task still in the lane's copy left it on its own
branch: the copy comes off it once no seat is mid-turn there, onto the Human's own branch with their
uncommitted work along when the lane carried theirs, and the task's branch goes unless it holds commits
nothing else has.

**Teardown** waits for seats that are still mid-turn. The pending release is recorded in the ledger,
and a seat waiting to be archived in `intents.json`, so a daemon restart loses neither: the first
round after it treats every turn that ended meanwhile as ending then. A landed lane's branch is
deleted with its copy, and one closed without landing is kept for you.

**The first gate.** The first `open_lane` of a project with no recorded gate detects one from the
project's files, for example `npm test` or `cargo test`. `set_project` changes it.

## Tool calls in, letters out

![Tool calls in, letters out](images/calls-and-mail.svg)

**In.** A seat calls a desk tool. Its `team.mjs`, an MCP server on the official SDK, sends the call
on its line to the desk's socket. The desk knows the seat by the key it showed when the line opened:
made as the seat is created, bound to the agent when Paseo opens its session, and given back each time
it opens again. The desk checks the arguments, runs the verb and answers on the line. A call still
running after 240 s is answered with "the answer arrives as mail", and so is one the seat's harness
stops or whose line drops. That promise is kept in `intents.json` until the letter is posted; if the
plugin stops first, the seat is told NO ANSWER when it starts again. A harness that asked for progress
hears every 20 s that a call still runs, and the desk's choices for a role's fields reach its seats as
a changed tool list when the team's settings change.

**Out.** Every letter goes into one `outbox.json`. Mail to a seat is pumped when a letter is
posted, when a turn ends, and after each patrol round. Everything waiting for one seat goes out as
a single message.

- **Steered** into a running turn only when its agent can take a steer and the turn has run at
  least 60 s.
- **Held** while the seat waits on a permission, is busy, had mail in the last 10 minutes, or its lane
  is on hold.
- **Kept** while every letter for it asks nothing now: a lane that opened, a task that started, a
  landing held or done. Such a letter goes out with the next one that asks something.
- **Sent** otherwise.

Each letter's `Next:` line is picked by the desk from what it knows, so a seat's prompt needs no table
of letters: a red gate, an ask's kind, whether its reader is the Lead or whoever supervises because
the Lead is gone, a review's hand-back, the lane's last task merged.

**Reading turns.** At every turn end, `TurnRules` reads the turn in code, with no model call:

- A failed turn is reported to the seat's owner.
- A Peer or Reviewer whose turn ends without a desk call is nudged. On the second such turn, its task
  is marked `stalled` and the Lead is told.

## The Human in the loop

The Human is asked what only they can decide, and told what they cannot take back; everything else
goes ahead.

- **Questions.** The Supervisor puts a decision only the Human can make on their queue with
  `ask_human`: the choices as a user sees them, its recommendation, and what goes ahead while they are
  silent, by class. A reversible one goes on with the recommendation at once; a costly one until the
  lane reports ready, where the lane is put on hold; an irreversible one holds the lane now. They answer
  on the Flow tab, or in chat for `record_human_answer`, and HUMAN ANSWERED tells the Supervisor what
  that turns round. At most `questionsPerDay` a day.
- **Standing orders.** What they settle once for every lane: the paths no landing touches before they
  look (`askFirst`), and where lanes work when their copy makes that a question (`laneHome`). The
  Orders tab shows them with the project's `CONTEXT.md`.
- **Landings held for them.** A landing that touches `askFirst` waits on the Flow tab with the
  desk's evidence; approved, it lands, and sent back, the note goes to the Lead.
- **Holds.** `hold_lane` stops every seat in a lane at once, holds its mail and refuses its permission
  requests until `resume_lane`.
- **Pages.** An incident that cannot be undone reaches their phone: see the watch below.
- **The Report tab** tells the last day from the record, with no model's words: what needs them, what
  went ahead on a recommendation, what landed, what could not be undone, and the counts.

## The watch

**What is watched.** Every live seat whose role can be `watched`: Leads and Peers in the preset,
never a Reviewer. `core/stream.ts` joins Paseo's live timeline with its paged history, reading back
what a join, a gap or a reconnect missed, and folds it into a window of at most 80 entries per seat:
calls, words, thoughts, instructions and errors. A seat whose subscription fails is followed again on
the next round.

**Facts, in code.** Every turn is read for facts, and every lane's record for shapes that span
turns. Each fact has a level:

- **`page`**, e.g. `destructive`. It goes out at once.
- **`attend`**, e.g. `stuck`, `test-weakened` or `unverified`. It counts against its lane's budget for the day.
- **`note`**, e.g. `gate-failed`. It is only evidence.

The full list is in [the reference](REFERENCE.md#facts).

**Incidents.** Each finding joins the open incident for its seat and kind, or opens one, in
`incidents.json`. It is sent at most once, as an INCIDENT letter:

- An `attend` incident about a Peer goes to the Lead of its lane.
- One about a Lead, a `page`, or one whose Lead is gone goes to the Supervisor.
- It never goes to the watched seat.
- A `page` also reaches the Human's phone, through a Pager started for it: an agent with no tools and
  no parent, whose first and only reply is two lines the desk writes, which Paseo pushes.

Until it is sent, it may be held: in **shadow** (mailing is off, the default), on **probation** (the
last ten marks of its kind were mostly noise), over its lane's **budget** for the day (two by default;
those about no lane share one), or with **nobody** to tell. Only the last can hold a page.

**Questions.** What a fact cannot say, the watch asks at the moment it matters, one condition per
question, on a small state the code builds: of a hand-back, of a review that accepts a change a risk
rule reaches, of an act a fact names, of a first change made before any look. `checks.ts` builds each
case from the record and never from a seat's own reasoning; the wording, thresholds and mode of each
question are data in `catalog/checks.json`. `judging.ts` puts the case to whoever
`attention.judge` names, behind the `Judge` port: a sensor over HTTP (`adapters/decisions.ts`, the key
in its header only, the catalog's data rules with every request), or the Watcher seat, which the desk
seats under the Supervisor and mails one CASE letter per case, and which answers with `judge`. Every
question ships `shadow`: the case, the question as sent and the answer go to `assessments.log`, and no
seat reads them. Nothing waits on an answer; one that fails is kept as unasked.

**Marking.** Whoever gets an incident marks it with `mark_incident`, as `useful`, `noise` or `unknown`, after
checking the agent's own record.

## The concept

**`CONTEXT.md` is the Human's word.** It lives in the project's state, never in the repo. It holds
only what the project does, its logic, how it behaves, and the words it is spoken of in. The
Supervisor settles new work with you through the `grilling` skill and writes each answer there,
following `guides/CONTEXT_FORMAT.md`. The desk never writes in it. It only names the file in a Lead's
directive once the file exists.

**What every role shares is in each role's own prompt**, not in the project's files.

## The patrol

A timer runs a round every `tickSeconds`, 30 s by default. Rounds never overlap. Each step is guarded
on its own, so one broken project doesn't stop the round. For each project, in order:

1. Tell the Supervisor about idle lanes.
2. Retell held incidents that had nobody to tell.
3. Mark tasks whose Peer is gone, and tell the Supervisor of a lane whose Lead is gone.
4. Remind open asks, re-address ones whose reader is gone, and escalate ones nobody answered.
5. Read each lane's record for facts.
6. Sweep stray workspaces and worktrees, and finish held teardowns.
7. Open waiting lanes whose turn has come, and archive finished ones.
8. Write `status.md`.

Then it pumps every seat that has mail.

## Settings

There are two JSON layers: the machine layer (`~/.local/share/seatworks-v3/settings.json`) and a
project layer. For any single value the project wins, and rules from both are joined. Unknown keys
are refused.

- A save carries the revision it read. If the file changed since, the save answers `conflict`.
- A save that would make a buildable seat unbuildable is refused.
- A broken file is reported by the position where parsing stopped, never by its text, because that
  text might be a key.
- A `roles.json` in the state root replaces the shipped preset whole.

Every setting and its default is in [the reference](REFERENCE.md#settings).
