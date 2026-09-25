# Reference

Lookups, not reading. For how the parts fit together, see [ARCHITECTURE.md](ARCHITECTURE.md). Paths
are under `plugin/` unless they start with `~`.

- **Desk:** [verbs](#desk-verbs) · [records](#records) · [gate detection](#gate-detection) · [letters](#letters) · [mail](#mail) · [permission requests](#permission-requests)
- **Seats:** [hooks](#hooks-and-events) · [harness fields](#harness-fields) · [seat directories](#seat-directories) · [MCP servers](#mcp-servers)
- **Watch:** [facts](#facts) · [holds](#holds)
- **Setup and files:** [settings](#settings) · [panel](#panel) · [state on disk](#state-on-disk) · [evals](#evals) · [known limits](#known-limits)

## Desk verbs

A call runs only when three things hold: the seat's provider maps to a role whose tool set (in
`mcp/tools.json`) holds the verb, the seat's bridge names that same role, and the arguments fit the
schema. A call that doesn't fit is refused, with what is wrong. Where a field takes one of a set the kit
fixes (the roles that write and their skills, the roles that review or lead, the folders a role keeps
pages in), the seat's bridge shows that set as the field's choices.

<!-- drawn from the code: verbs -->
| Role | Tools |
|---|---|
| Supervisor | `open_lane` `message` `answer` `land_lane` `drop_lane` `amend_lane` `hold_lane` `resume_lane` `ask_human` `record_human_answer` `replace_lead` `release` `set_project` `status` `incidents` `mark_incident` `record` |
| Lead | `add_tasks` `start_review` `message` `answer` `accept` `rework` `amend_task` `cut` `release` `ask` `report` `status` `incidents` `mark_incident` `record` `note` |
| Peer, Reviewer | `done` `ask` |
| Watcher | `judge` `record` |
<!-- end -->

| Verb | Effect |
|---|---|
| `open_lane` | Records the lane, takes a working copy and seats a Lead, with a directive that names `CONTEXT.md` once it exists. It can read a GitHub issue. It refuses a lane whose declared write set or `contracts` overlap an open lane's write set, or whose write set reaches a path the project keeps to one writer that an open lane may write, an open lane that declared none counting as reaching them all. A lane that declares none opens anyway, and it and its Supervisor are told which of those paths open lanes may be writing. Before a lane takes the project's own checkout while it holds uncommitted work or sits on a branch other than the base, the Human decides where it works: the call says it (`onBranch`, `isolate` true or false) or the project's `laneHome` does, else it is refused with the choices |
| `land_lane` | Waits for queued merges, then [lands the lane](ARCHITECTURE.md#a-lane): it cuts leftover tasks and archives their Peers. Its Lead stays, with any copy of its own, until `release`; a lane in the project's own copy puts it back on base once no seat is mid-turn there. Landing over a red gate takes `overGate` and a reason. A lane that changes a path in the project's `askFirst` waits for the Human's approval instead |
| `drop_lane` | Waits for queued merges, then closes the lane without landing, with a reason: it cuts leftover tasks, archives their Peers and keeps the branch. Its Lead stays, with any copy of its own, until `release`. A waiting lane is dropped before anything starts |
| `amend_lane` | Changes what an open or waiting lane is asked, keeping what it was asked before and why. Its Lead is told, and a READY it reported no longer stands. A write set or `contracts` that would overlap an open lane's is refused |
| `replace_lead` | Seats a new Lead on an open lane whose Lead is gone, where the lane stands. A Lead Paseo already started for it is taken on instead, and the asks waiting on the old Lead move to the new one |
| `ask_human` | The Supervisor puts a decision only the Human can make on their question queue: 2–4 choices, a recommendation, and what goes ahead while they are silent by class. `reversible` goes on at once; `costly` goes on until the lane reports ready, where the desk puts the lane on hold if it is still unanswered; `irreversible` puts the lane on hold now. Refused past `questionsPerDay` questions in a day across all projects |
| `record_human_answer` | Records an answer the Human gave in the Supervisor's chat: a choice, `decline` or `cancel`, with their own words, which must be found in that chat. A lane put on hold for the question stays so until `resume_lane` |
| `hold_lane` | Stops a lane where it stands, with a reason: its Lead and each Peer and reviewer get HOLD at once. Until `resume_lane`, mail to them waits, their permission requests are refused, and `add_tasks`, `accept`, `land_lane` and waiting tasks or lanes do not go ahead; a landing it was waiting on is called off |
| `resume_lane` | Lifts a hold: each seat of the lane gets RESUMED with the mail held for it, and what waited may start |
| `set_project` | Sets the base branch, the gate command and its timeout (30 min by default), whether the gate runs per lane or per task, the serial-only paths, `laneHome`, where lanes work when a call does not say (`onBranch`, `newBranch`, `isolate`), `askFirst`, the paths no landing touches before the Human looks, and `riskRules`, which replace the kit's rules for migrations, schemas and SQL. An empty gate is an answer, and the desk never detects one over it |
| `add_tasks` | Records tasks in the lane in one call, each waiting for what it names, and starts what can start. A task in the lane's copy waits while another holds it. Every task starts a Peer of its own. Each brief names the tasks written beside it and what they own. The whole call is refused when two tasks that may run at once own one path, a parallel task owns a one-writer path, a task owns a path outside the lane's write set, or a task takes a path a running task still writes |
| `start_review` | Seats a read-only reviewing role. It runs where the change is now: the task's copy, the lane's copy, or the task branch. A task in the lane's copy is read by its own commits up to its last hand-back, commit by commit when a task beside it was merged in meanwhile. Its brief carries the question of every risk rule the change reaches |
| `accept` | Lane mode: marks the task merged in place, and its Peer stays until the Lead releases it; it never takes another task. It is refused if the lane copy is off its branch or dirty. Parallel mode: queues the task for merging; while the lane's copy has work uncommitted, the task stays queued, its Lead is told once, and the merge is tried again as each turn ends and before the lane lands |
| `rework` | Sends the task back to its Peer with a letter, an accepted one too while that Peer is kept: its work is then read from where the lane stands, and the lane is no longer reported ready. It is refused while another task holds the lane copy, for a Peer that is gone, and for a parallel task whose copy is being put away |
| `amend_task` | Changes what a task asks while its Peer works, keeping what it asked before and why. The Peer reads it at its next turn. A parallel task's new owned paths are checked as a start would check them |
| `cut` | Stops the task and archives its Peer. It resets the lane copy to where the task started, when nothing merged there since. It is refused while the task's merge runs |
| `release` | The Lead lets go of the Peer kept from a task it accepted: it is archived, and a parallel task's copy is put away with it, its merged branch too. It is refused for a task not yet accepted, a parallel task a review still reads in its copy, and a review, whose reviewer goes when it is cut. The Supervisor lets go of the Lead kept from a closed lane: it is archived after the turn it is in, and the copy it kept is put away once nobody writes there, a landed lane's branch with it. A kept Lead archived in Paseo has its copy put away by the next round |
| `report` | Reports to the Supervisor. With `ready`, it runs the lane gate first, and the report carries what the lane's reviews leave standing: no review of the whole lane, a latest review that did not accept, a task accepted over its own review's changes, or handed back again after them and accepted with no review since. Where review changes stand that nothing on record answers, its `Next:` asks the Supervisor to check with the Lead before landing. `land_lane` gives the same as evidence |
| `ask` | A Lead asks the Supervisor, with the default it works on meanwhile. A Peer asks its Lead with its best guess, which the letter shows as its default; a Reviewer asks with what it tried. Either goes to the Supervisor when the Lead is gone |
| `done` | Hands the task back to the Lead, with a file; the commit is read from the branch, and files changed outside the task's owned paths are named in it and to the Peer, counting in the lane's copy only the task's own commits, not the merges of tasks beside it. A review hands back its verdict, its answer to the focus and each finding (severity, place, failure, fix), and `changes` or `reopen` needs at least one; it is refused until it answers each risk rule question its brief carries. On a per-task-gate project, it runs the gate first. It is refused once the task is accepted, queued or cut |
| `message` | The Supervisor messages a lane, the Lead kept from a closed one included, or a task, and a Lead messages a task in its own lane. It is refused, like `rework`, `answer`, `amend_task` and `amend_lane`, when the text names or quotes an open incident about the seat it goes to |
| `answer` | Closes an open ask. The Supervisor may answer any ask, others only their own |
| `incidents` | Lists the 50 most recent open or unmarked incidents, with each one's brief. With `closed`, it adds the 20 most recently marked. A Lead sees only its own lane's |
| `mark_incident` | Marks an incident `useful`, `noise` or `unknown`, with an optional note, and closes it. Noise also silences the same words on that seat and kind from then on |
| `record` | What a lane's Lead, or a task's Peer or reviewer, ran, read, changed and said, one numbered step a line, without output or diffs. A Lead reads only its own lane's tasks; the Watcher reads any. Once the seat is archived it shows what the desk kept instead, since Paseo starts an archived agent again to read its history. A task whose Peer went on to the next task says so, since the steps shown are that task's too |
| `judge` | The Watcher answers a case: every question once, by name, with `yes`, `no`, `unsure` or a choice's name, and a why. Anything else is refused and nothing is kept. The answers go to the project's `assessments.log`, like a sensor's |
| `note` | Writes a page into a folder the caller's role declares under the project's state (the Lead's: `plans`, `council`, `ultra-review`, `repo-refresh`), replacing one of the same name, and answers with its path. It never writes into the repository. The Lead has no file-editing tools, except on Codex, where only its prompt keeps it from editing |
| `status` | Lanes, tasks, working copies, open asks, and the Leads kept after their lane closed. A Lead sees its own lane, and the Peer kept from its last task; a kept Lead only that it is kept. Asked again with nothing changed, it says only that |

Behaviour depends on a role's capabilities (`supervise`, `lead`, `work`, `write`, `review`,
`watched`, `judge`, `page`), never its name.

## Records

<!-- drawn from the code: records -->
| Record | States | Ids |
|---|---|---|
| Lane | `waiting`, `open`, `closed` | `L<n>` |
| Task | `waiting`, `running`, `rework`, `done`, `failed`, `stalled`, `merged`, `queued`, `merging`, `cut` | `<lane>-T<n>` for code, `<lane>-R<n>` for review, from one counter per lane |
| Ask | `open`, `answered` | `A<n>` |
| Question for the Human | `open`, `answered`, `declined`, `canceled` | `H<n>` |
| Incident | open until marked | `I<n>` |
| Slot | a git worktree held by a lane or task | `S<n>`, never reused once released |
<!-- end -->

A lane opened with `detourOf` serves another open lane. When it closes, that lane's Lead gets a
CLEARED letter.

## Gate detection

The first `open_lane` of a project with no gate on record looks in the project root, by the rules in
`catalog/ecosystem.json` (the shipped ones below):

| Found | Gate |
|---|---|
| `package.json` with a real `test` script | `pnpm test`, `yarn test`, `bun run test` or `npm test`, by lockfile |
| `mvnw` or `pom.xml` | `./mvnw -q test` or `mvn -q test` |
| `gradlew` | `./gradlew test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pyproject.toml` or `pytest.ini` | `pytest -q` |

`catalog/ecosystem.json` also holds the paths only one writer at a time may write (a project's own
`serialOnly` replaces them), how test and docs files are named, and the watch's default patterns. A file
of the same name in the state root replaces it, as `roles.json` does.

## Letters

They are written in `desk/letters.ts` and, for asks, merges, landings and the Watcher's cases, in
`desk/ask-letters.ts`, `desk/merge-letters.ts`, `desk/land-letters.ts` and `desk/case-letters.ts`. What a
Peer or Reviewer starts from is in `desk/briefs.ts`, a Lead's directive in `desk/directive.ts` and a Pager's
two lines in `desk/pager.ts`; a Watcher starts from its first case. Each letter carries a key made of its kind and the ids that make it that
letter, never written by hand where it is posted, and ends with one `Next:` line: what it asks of whoever
reads it, which the desk picks from what it knows (a red gate, the kind of an ask, whether its reader is
the Lead or whoever supervises because the Lead is gone, whether the task merged was the lane's last).

| Kind | Letters |
|---|---|
| Opening a seat | OWNER DIRECTIVE, TASK, REVIEW |
| Between seats | MESSAGE, RECONCILE, ASK, ANSWER to your ask, ANSWERED FOR YOU, STILL OPEN, UNANSWERED, HUMAN WROTE, HUMAN ANSWERED |
| Work moving | HANDBACK, REWORK, AMENDED, MERGED, MERGE WAITS, MERGE FAILED, MERGE CONFLICT, BASE CONFLICT, REPORT, CAN LAND, CLEARED |
| Landing held for the Human | LAND HELD, LANDED, HELD AGAIN, CHANGED, APPROVED, SENT BACK, LAND SENT BACK |
| Waiting and starting again | WAITING, OPENED, NOT OPENED, NOT STARTED, LEAD GONE |
| A lane stopped | HOLD, RESUMED |
| A seat kept on after its work | LANE CLOSED |
| The desk noticing | SILENT, FAILED, WAITING FOR PERMISSION, LANE IDLE, INCIDENT, the bare nudge |
| A question for the Watcher | CASE |
| A moment to look | ARCHITECTURE, STRUGGLING, TURNING |
| Answering late | ANSWER to your `<tool>` call, NO ANSWER to your `<tool>` call |

CAN LAND tells whoever tried to land a lane under a seat mid-turn that the turn has ended. NO ANSWER
tells a seat that the plugin stopped before the call it was told to wait for by mail had finished.
RECONCILE tells a Lead what the Supervisor sent its Peer. HUMAN WROTE tells whoever supervises what the Human
typed straight into a Lead's or Peer's chat, and HUMAN ANSWERED what they chose for a question on the panel. ANSWERED FOR YOU tells a seat that someone
else answered an ask addressed to it. MERGE CONFLICT and BASE CONFLICT tell a Lead that the desk began a merge no seat may run
and left its conflicts in the copy of whoever settles them: the task's own, or the lane's, for a Peer to settle and commit. HOLD is the one letter sent past the outbox, cutting a running turn
short where the seat's agent allows it. ARCHITECTURE, STRUGGLING and TURNING wake whoever supervises at
the three moments SLP names, as the desk sees them: a Lead widening what a task owns; a task sent back a
second time, or stalled; a Lead changing what a task is for. OPENED, WAITING for a lane that opened by
itself, LANDED and SENT BACK ask nothing of the Supervisor, and WAITING for a task that started by itself,
LAND HELD, LANE CLOSED, a MERGE WAITS behind a task that still holds the lane's copy, and a MERGED with nothing to note while other tasks remain ask nothing of a Lead, so they
wait for the next letter that does. A task handed to the Peer kept in the lane's copy reaches it as a TASK letter, its brief.

## Mail

| Situation | What happens |
|---|---|
| Paseo can't look the seat up | held |
| The seat is archived | never sent. The letters age out |
| The seat has a pending permission | held |
| The seat's lane is on hold | held until `resume_lane` |
| Running, its agent `steers`, and the turn started at least 60 s ago | **steered** into the turn |
| Running or starting | held |
| Mailed less than 10 minutes ago, with no turn end since | held |
| Every letter for it asks nothing of it now | held until one that does |
| Otherwise | sent |

| Timing | Value |
|---|---|
| Spool drained | every 500 ms |
| `team.mjs` polls for a reply | every 250 ms, for up to 300 s |
| A call answered "arrives as mail" | after 240 s |
| Spool requests dropped | after 10 minutes |
| A duplicate letter, same kind, same ids and same reader | dropped while waiting, and for 30 minutes after sending |
| A letter nobody took | dropped after 7 days |

## Permission requests

| Seat | Where the request goes |
|---|---|
| Lead | A letter to the Supervisor |
| Peer or Reviewer on a task | A letter to its Lead |
| Supervisor | `attention.log` and `status.md`. You answer it in Paseo |
| Peer or Reviewer with no task | Only Paseo |

A question that would stop a turn (AskUserQuestion, `request_user_input`) is refused, with where to ask
instead: `ask` for a Lead, Peer or Reviewer, `ask_human` for the Supervisor. Any other permission only you
can answer.

## Hooks and events

| Hook or event | What the plugin does |
|---|---|
| before `agent.create` | For a `sw2-` provider, builds the seat directory and shapes the launch. A seat that can't be built refuses the launch, with the reason |
| before `agent.session_open` | Seeds the project's records, rebuilds the seat directory if needed, and points the agent's config directory at it |
| `agent.created` | Follows the seat's timeline, if its role can be `watched` |
| `agent.turn_started` | Records the turn's start, for turn reading and steering |
| `agent.turn_ended` | Finishes deferred teardowns, reads the turn, and pumps the seat's mail |
| `agent.permission_requested` | Mails the request to the seat's owner, or logs it |
| `agent.archived` | Forgets the seat's timing, stops its watch, and closes its open incidents |

## Harness fields

`harness/<agent>/harness.json`, read against a schema: a field it doesn't know, at any depth, fails the load and is named.

| Field | Drives |
|---|---|
| `id`, `label` | The harness's name, and the agent half of a provider's label |
| `baseProvider` | The Paseo provider it extends: `claude`, `codex`, `pi`, `omp` or `opencode` |
| `configDirEnv`, `profileRoot` | The variable that points the agent at its seat directory, and where those live |
| `contextFile` | The file in the seat directory that gets the working rules |
| `skillsDir` | Where skills are linked, each to its copy under `content/` |
| `settings` | Base settings, the per-role overlay, and `inherits`: keys taken from your own config for that agent. The plugin writes the seat's settings file whole |
| `mcp` | The MCP file, how servers are delivered, transports, seed and clear rules, and `desk` fields |
| `links`, `files` | Files linked from your own setup (logins, history), and files composed per role |
| `modelCatalog` | A command whose model list is written as the agent's catalog |
| `stateWrites` | Where the seat's writable state paths go |
| `projectContextOption` | The provider option that receives the working directory |
| `steers` | Whether mail may be steered into a running turn |
| `mcpCall`, `mcpServerField` | How the agent names a call to an MCP server, or the field that holds the server's name, so a call to the desk is known as one |
| `timeline` | Where the agent's timeline differs from the rest: where it keeps a command's exit code when not in the call, calls it sends that are not the seat's, and the marks of an input that was not JSON |
| `checks` | Files the Health tab looks for |
| `provider` | Env, launch command, `forceFlags`, and the starting mode |

Required: `id`, `label`, `baseProvider`, `configDirEnv`, `profileRoot`, `skillsDir`, `settings`,
`mcp` and `provider`.

Beside it, `delta/<role>.md` holds what a role's prompt needs said against that agent's own
instructions, such as who "the user" is, or a habit of implementing that a Lead must not follow. It is
added after the role's prompt, in the same place, and held to the same checks; a role with none gets
nothing added.

## Seat names

A seat has one duty for life, and a plugin cannot rename an agent, so the name Paseo shows is fixed
when the seat starts and says that duty.

| Seat | Name |
|---|---|
| Lead | `<lane> · Lead · <lane title>`, as `L1 · Lead · Cart`. A Lead that replaces one gone gets the same name |
| Peer | `<task> · <role> · <task title>`, as `L1-T3 · Peer · Cart total` |
| Reviewer | `<review> · Review <task or lane>`, as `L1-R1 · Review L1-T3` |

Labels carry `seatworks.project`, `seatworks.role`, and the lane and task a seat works for. Letters
name a seat as Paseo shows it, or by its role and id where Paseo shows no name.

A copy of its own is a Paseo workspace named `<project> <copy> · <work>`, for example
`shop S2 · L2 Filter results`, and renamed when it takes other work. The round's sweep knows the
desk's copies by the project's name leading theirs, and archives one that nothing in the ledger holds.

## Seat directories

One per role, agent and project: `<profileRoot>/sw2-<role>-<agent>-<slug>`. It is rebuilt when the
settings revision changes, its settings file is gone, or a login appeared since.

| Agent | Directory | Written there | Launch |
|---|---|---|---|
| Claude Code | `~/.claude/profiles/…` | `settings.json` (deny rules, sandbox), `.claude.json` (its own MCP servers cleared), `skills/`, a `projects` link, `CLAUDE.md` for working rules and, when the project has no `CLAUDE.md`, an import of its `AGENTS.md` | `bin/seat-room` with `--setting-sources user`, so the project's settings, hooks and skills stay out |
| Codex | `~/.codex/seats/…` | `config.toml` (`model_provider` and `model_providers` from your own `~/.codex/config.toml`; `workspace-write`, or `read-only` for the Reviewer, the Watcher and the Pager; `approval_policy = "never"`; subagents off), `model-catalog.json`, `rules/seatworks.rules`, `skills/`, an `auth.json` link, `AGENTS.md` | Paseo's Codex provider |
| Pi | `~/.pi/seats/…` | `settings.json` (`pi-mcp-adapter`, project trust off, tool lists for the Lead and Reviewer), `mcp.json`, `skills/`, links to login, models and npm | Paseo's Pi provider |
| OpenCode | `~/.config/opencode-seats/…` | `opencode/opencode.json` (your providers, permissions with command denials, subagents and questions off, autoupdate and sharing off), `opencode/AGENTS.md`, `opencode/skills/`, a link to your git config | Paseo's OpenCode provider, with its env given at each session |
| Oh My Pi | `~/.omp/seats/…` | `config.yml` (command denials in `bash.patterns`, tool denials, code eval, subagents, questions, memory and other agents' config off), `mcp.json`, `AGENTS.md`, `skills/`, links to its login and models | Paseo's omp provider |

- **Claude Code** still reads the project's `CLAUDE.md`: the working directory is passed as an
  additional directory. Claude never reads an added directory's `AGENTS.md`, so where the project
  has no `CLAUDE.md` the seat's own `CLAUDE.md` imports the project's `AGENTS.md`, as Claude Code
  reads it outside a seat.
- **Codex** needs the `codex` CLI to build a seat, because the build asks it for its models.
- **Oh My Pi** reads `config.yml` as YAML; the plugin writes it as JSON, which YAML reads too. The
  seat's session also names that file in `PI_CONFIG_FILES`, the overlay omp ranks above a
  repository's own `.omp/config.yml`, which would otherwise replace the seat's command denials.
- **OpenCode** uses `XDG_CONFIG_HOME` as its config variable, and Paseo runs one OpenCode server for
  every seat, so a seat's own env reaches it only through the session. It keeps a failed command's
  exit code beside the call, where the watch reads it.

## MCP servers

| Server | Kind | What it gives |
|---|---|---|
| `team` | Always there, for a seat with a tool set | The role's desk verbs |
| `intellij-index` | Proxy over HTTP to a JetBrains IDE. Needs `.idea` | Code-index tools |
| `code-search` | Proxy over stdio (`uvx … semble`) | One `search` tool |
| `context7` | Plain HTTP, no key | Library docs. Queries leave the machine |

Catalog servers are off until a settings layer turns them on. One that names no roles goes to every
role with desk tools. `mcp/code.mjs` can pin calls to the seat's git root, sync
changed files, open and close the working copy in the backend, wait out indexing, rewrite errors and
replace tool descriptions.

## Facts

**From a seat's turn**, in code:

| Fact | Level | Fires when |
|---|---|---|
| `destructive` | page | A shell command matches the destructive pattern, checked per segment. Removing scratch files under the temp directory doesn't count |
| `stuck` | attend | In the last 20 steps: the same action and result 4 times, the same action failing 3 times, the same words 3 times, or two actions alternating 3 times |
| `no-recovery` | attend | Ten steps after a failed command, neither that program nor the gate has passed |
| `test-weakened` / `suppressed` | attend | An edit removes assertions from a test or adds a skip, or adds a suppression like `@ts-ignore` |
| `unverified` | attend | A Peer hands back with no gate result after writing files it never ran the gate on. Needs a gate |
| `claim-contradicted` | attend | A Peer hands back complete, though the gate it last ran, after its last edit, failed. Needs a gate |
| `long-turn` | attend | A turn runs past `longTurnMinutes`, or past three times this seat's median turn, whichever is longer |
| `call-failed` / `gate-failed` / `outside-scope` | note | Evidence only, never an incident alone |
| `edit-before-look` | note | A turn's first step, desk calls and Paseo's own steps aside, changed a file before it read, searched or ran anything since an instruction the watch still holds. It opens `instruction_kind` and nothing else |

**From a lane's record**, read by the patrol. Each names the lane's Lead:

| Fact | Fires when |
|---|---|
| `rework-loop` | One task was sent back `reworksAt` times |
| `patched-not-fixed` | That many sendings-back are spread over two or more tasks |
| `reviews-unconverged` | `reviewsAt` reviews of one target, none accepted or cut |
| `certainty-only` | A review's focus asks only for what the Reviewer is sure of |
| `brief-prewritten` | A code task's brief has a code fence, or steps naming a file and a member |
| `accepted-unfinished` | A task merged whose Peer handed it back `partial` or `blocked`, or never at all |

[ANTIPATTERNS.md](ANTIPATTERNS.md) says which pattern each fact answers.

## Holds

An incident is sent once. Until then it may be held:

| Held | Meaning |
|---|---|
| shadow | `attention.watch` is off, the default. Attention-level incidents are not sent; a page is |
| probation | The last ten of this kind that were marked, useful or noise, were mostly noise. It is recorded and not sent; seen again once the marks turn, it is |
| budget | `incidentsPerLane` attend-level incidents about this lane went out in the last 24 h; those about no lane share one budget |
| nobody | Nobody to tell, or the only candidate is the watched seat. The patrol retries |

A page is held only while nobody is there to tell, and it also reaches the Human's phone: the desk starts a Pager, a role with no tools, whose
one reply is two lines the desk writes, and Paseo pushes an agent's first finished turn. Paseo pushes an agent
once until someone opens it, so each page has a Pager of its own. A sighting whose exact words were already marked `noise` for that seat and kind
opens nothing. Archiving a seat closes its incidents, and they still wait to be marked.

The watch also asks what a code fact cannot read, one condition at a time, at the moment it matters:

| Question | Asked when | Of |
|---|---|---|
| `asked_for` | a command cannot be undone, a test is weakened or a check silenced | the seat's latest instruction, and its task's goal and acceptance: did they ask for that act? |
| `instruction_kind` | the first thing a turn did was change a file, before any read or run | the instruction, when a sender the catalog names sent it: a new requirement, a claimed bug, a question, an approval? |
| `summary_admits_gap` | a task is handed back complete | its summary: does it say something asked for was not done? |
| `claims_checks_pass` | a hand-back the desk did not gate is `unverified` or `claim-contradicted` | the hand-back: does it say the checks pass? |
| `review_ran_invariant` | a review accepts a change a risk rule reaches | its report, once per invariant: was it checked by running code? |

`attention.judge` names who answers: `off`, a sensor in `catalog/sensor/` asked over HTTP (the preset's `jev`), or a
role that can `judge`, the Watcher, a seat. Each question in `catalog/checks.json` has its wording, thresholds and
mode. Every question ships `shadow`: the answer is kept in the project's `assessments.log`, and no seat reads it. The Flow tab says who answers and how that stands: nobody, a sensor with no
key, nothing asked yet, the last answer, or the last failure. A question that reads the instruction is not asked once
the watch's window has lost it.

Judged by the Watcher, the desk seats one per project when a case first needs it, in the project's own workspace and
always under its Supervisor (a seat with no parent would have its first reply pushed to the Human's phone), and mails
it each case as a CASE letter: the fields the desk read, and the questions with what each answer means. It answers
with `judge`, and `record` lets it read the seat a case is about. On Claude and Pi it has no other tool; on Codex,
Oh My Pi and OpenCode it keeps the harness's read-only tools. It has no MCP server unless one names it. A case
unanswered 15 minutes after it was sent, or whose Watcher is gone, is kept as unasked; the patrol lets an idle
Watcher go once no lane is open or the watch is judged by something else. With no Supervisor seated, no Watcher is.

## Settings

There are two layers: `~/.local/share/seatworks-v3/settings.json` for the machine, and
`projects/<slug>/settings.json` for a project. The project layer wins per value.

| Setting | Where |
|---|---|
| Each role's agent, model and thinking | panel |
| MCP servers: on or off, roles, options, pasted snippets | panel |
| `attention.watch`, the mail switch | panel (*Mail incidents*) |
| The Flow switch | panel |
| Rules per role, or for every seat | by hand |
| The Flow interval, and the other attention values | by hand |
| `attention.judge`, who answers the watch's questions | panel (Team › Watcher, *Answered by*) |
| A sensor's key, `sensor.<id>.key`, which the panel never reads back and a Claude seat is denied reading | panel (Machine defaults › Watcher); a project's by hand |

`tickSeconds` is read from the machine layer only. A seat runs as you: a Claude seat is denied reading either
settings file and the copies beside it (Migrate's backups, a save's staging copy), but a seat on another harness can
read them all, a sensor's key included. On Linux, Claude's sandbox skips every rule with a glob in it, so there its
shell is kept off only the machine's settings file itself; its file tools still honour every rule.

<!-- drawn from the code: attention -->
| Attention value | Default |
|---|---|
| `tickSeconds` | 30 |
| `leadIdleMinutes` | 12 |
| `askRemindMinutes` | 15 |
| `maxReminders` | 2 |
| `watch` | false |
| `repeatsAt` | 3 |
| `reworksAt` | 3 |
| `reviewsAt` | 3 |
| `longTurnMinutes` | 30 |
| `incidentsPerLane` | 2 |
| `questionsPerDay` | 3 |
| `judge` | `jev` |
| `destructive` | a pattern in `catalog/ecosystem.json` |
| `testPath` | a pattern in `catalog/ecosystem.json` |
| `suppressed` | a pattern in `catalog/ecosystem.json` |
<!-- end -->

A `roles.json` in `~/.local/share/seatworks-v3/` replaces the preset whole. A role names `defaults`
or `follows`, never both. A follower takes the agent, model and thinking of the role it follows until
it is given its own. Each role still needs its settings files under `harness/<agent>/settings/`.

## Panel

| Tab | What it holds |
|---|---|
| **Team** | The agent per role, its model and thinking. The Supervisor's chip also holds *Mail incidents* |
| **Flow** | First what waits for you: each question the Supervisor put to you, answered there with an option or declined, with a note; and each landing that waits for your approval. Then supervisors, lanes, tasks and open asks, live, each seat opening its chat in Paseo and an open lane its diff. A lane says whether it works in your checkout or a copy of its own; a task whether it runs in parallel, in which copy, and what a waiting one waits for; each Peer kept after its accepted task, and a Lead kept after its lane closed, show until they are released. Then the incidents not yet marked |
| **Report** | The project's last day, read from the record with no agent's words in it: what needs you, what went ahead on a recommendation, what landed, what could not be undone, and the counts |
| **Orders** | What you settled for the project, read only: the paths asked about first, the risk rules, where lanes work, and `CONTEXT.md`. You change them by telling the Supervisor |
| **MCP** | Servers on or off, their roles and options, and adding one from a snippet |
| **Health** | The machine's checks and, on a project, its lanes' status |
| **Plugin** | Updates, Migrate and Clean up, for the whole machine |

Models and modes come from Paseo, which asks each agent. The plugin lists them once a load, and **Refresh**
under the Team tab asks again. A role's chosen model is written as that provider's default in
Paseo (`additionalModels`), so Paseo's own picker offers every model and starts on the role's.


The panel talks to the server only through the `seatworks.*` RPCs in `shared/rpc.ts`. Detaching a
project keeps its ledger and logs, and is refused while a lane is open or a working copy is out.

## State on disk

```
~/.paseo/config.json                      providers sw2-<role>-<agent>, agent profiles
~/.local/share/seatworks-v3/
  roles.json                              optional; replaces the shipped preset
  settings.json                           machine settings
  settings.json.bak-<time>                what Migrate repaired, as it was; can hold a pasted token
  kit.json                                which kit runs, and since when
  content.json                            the shipped prompts, skills and guides you have taken in
  own/                                    your own copies, kept over the shipped ones
  models.json                             each agent's models as Paseo lists them
  outbox.json                             waiting letters, all projects
  intents.json                            seats to archive when their turn ends; answers promised as mail
  spool/requests/  spool/replies/         seat tool calls
  content/<name>-<hash>/                  copies of the guides and skills seats read; safe to delete
  guides -> content/guides-<hash>
  worktrees/<slug>/S<n>/                  isolated working copies
  projects/<slug>/                        slug = repo folder name + 6 hex chars of sha1(root)
    meta.json  settings.json  project.json
    ledger.json  incidents.json
    events.log  attention.log  assessments.log  status.md
    handbacks/  gates/  notebook.md  CONTEXT.md
<profileRoot>/sw2-<role>-<agent>-<slug>/  one seat directory per role, agent and project
```

`events.log` is the provenance record: one JSON line per tool call and per lane, task, merge, gate
and slot event. Every kind and its fields are one type, `DeskEvent` in `desk/events.ts`; a kind only
gains fields, and a field that changes meaning takes a new kind. The watch writes these kinds there:

| Group | Kinds |
|---|---|
| Watch | `watch.fact`, `watch.finding`, `watch.unbriefed`, `watch.unasked`, `watch.offline`, `watcher.seated` |
| Incidents | `incident.open`, `incident.held`, `incident.told`, `incident.read`, `incident.ack`, `incident.lookup-failed`, `incident.post-failed` |
| Pages | `page.sent`, `page.failed` |

`call.malformed` is logged when a seat's own harness rejected a tool call before it reached the desk.

## Evals

`npm run check` needs no key and launches no seat. This one calls a real model, so it sits outside
it:

| Command | What it measures |
|---|---|
| `npm run eval:triggers -- --agent "claude -p"` | Whether a real agent opens each skill on the briefs it should |

## Known limits

- **Oh My Pi can't be steered through Paseo.** Mail to a running omp seat waits for its turn to end.
- **Pi, Oh My Pi and OpenCode have no sandbox.** Pi has no command rules either, so a Pi seat is held
  by its tools and by what its `PATH` refuses: the desk's git commands, `gh` and `paseo`, but not
  another agent's command, since the seat's own agent starts through that same `PATH`. Oh My Pi and
  OpenCode have command denials, such as `git push` and `gh`, but no path rules, so a seat there can
  write the desk's records and the spool its tool calls travel through.
- **A seat's `PATH` holds spelling, not a sandbox.** Its `git`, `gh` and `paseo` refuse however the
  command is written (`-C`, an alias, `env gh`), but a program called by its full path runs.
- **A repository's own omp hooks, extensions and tools run in an Oh My Pi seat.** No setting keeps
  `.omp/hooks`, `extensions` or `tools` out.
- **Reading an archived seat's history leaves its agent running.** Paseo resumes the agent to serve
  it and never closes it; `paseo logs` or the app's history view does this. The watch stops rather
  than read a seat once it is archived.
- **A Codex seat can call only the tools the kit can name.** Codex refuses any MCP call not
  approved ahead, so the desk's tools and proxied servers are approved at launch; a server you add
  whose tools the kit doesn't know stays out of reach on Codex.
- **Codex command rules match argument prefixes**, so `git -C <path> push` gets past them; the
  seat's own `git` refuses it instead.
- **A steer Paseo can't hand over replaces the turn.** A Claude seat that is compacting refuses a
  steer the same way.
- **A turn running before a daemon restart** is never steered, and is read as having started
  30 minutes ago.
- **A project-layer save** doesn't rewrite the Paseo providers.
- **The watch can't see a sub-agent's work.** It isn't on the seat's timeline.
