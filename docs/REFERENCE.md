# Reference

Lookups, not reading: each section says what a name means or what a verb does. For how the parts work together, phase
by phase, see [ARCHITECTURE.md](ARCHITECTURE.md#the-workflow-in-code). Paths are under `plugin/` unless they start
with `~`.

- **The work:** [desk verbs](#desk-verbs) · [records](#records) · [letters](#letters) · [mail](#mail) · [permission requests](#permission-requests) · [gate detection](#gate-detection)
- **The Human:** [questions for the Human](#questions-for-the-human)
- **The watch:** [facts](#facts) · [holds](#holds) · [questions to a model](#questions-to-a-model)
- **Seats:** [hooks and events](#hooks-and-events) · [harness fields](#harness-fields) · [seat names](#seat-names) · [seat directories](#seat-directories) · [MCP servers](#mcp-servers)
- **Setup and files:** [settings](#settings) · [panel](#panel) · [state on disk](#state-on-disk) · [evals](#evals) · [known limits](#known-limits)

## Desk verbs

A seat calls a verb through its own `team` server, which carries the call to the desk
([tool calls in, letters out](ARCHITECTURE.md#tool-calls-in-letters-out)). The desk carries a call out only when:

1. it knows the key the seat was started with;
2. the seat's provider maps to a role whose tool set in `mcp/tools.json` holds the verb;
3. the seat's `team` server names that same role;
4. the arguments fit the verb's schema.

Otherwise it refuses the call and says what is wrong. A field that takes one of a set the kit fixes (roles that write
and their skills, roles that review or lead, a role's page folders) shows that set as its choices. Each verb carries a
title and hints (reads only, may destroy, safe to repeat, reaches outside the desk), each field a description, and
`mcp/instructions.json` says per tool set what the server is for, shown where a harness keeps tools behind a search. A
verb acts on the caller's capabilities (`supervise`, `lead`, `work`, `write`, `review`, `watched`, `judge`, `page`),
never on its role's name.

<!-- drawn from the code: verbs -->
| Role | Tools |
|---|---|
| Supervisor | `open_lane` `message` `answer` `land_lane` `drop_lane` `amend_lane` `hold_lane` `resume_lane` `ask_human` `record_human_answer` `replace_lead` `release` `set_project` `status` `incidents` `mark_incident` `record` |
| Lead | `add_tasks` `start_review` `message` `answer` `accept` `rework` `amend_task` `cut` `release` `ask` `report` `status` `incidents` `mark_incident` `record` `note` |
| Peer, Backup Peer, Reviewer, Senior Reviewer | `done` `ask` |
| Watcher | `judge` `record` |
<!-- end -->

| Verb | Effect |
|---|---|
| `set_project` | Sets the project's base branch, its gate and how it runs, its one-writer paths, how lanes land, and the Human's standing orders: [the fields](#set_project-fields). Refused while `project.json` cannot be read, which only the Human can repair |
| `open_lane` | Records a lane, takes it a working copy and seats a Lead, whose directive is the lane's fields and names `CONTEXT.md` once the Supervisor has written one. It can read a GitHub issue into the directive; one it cannot read never refuses the lane. See [where a lane works](#where-a-lane-works) |
| `amend_lane` | Changes what an open or waiting lane is asked, keeping what it was asked before, and why. Its Lead gets AMENDED, and the lane counts as not reported ready. For an open lane, a write set or `contracts` that would meet another open lane's, or reach a one-writer path it may write, is refused |
| `replace_lead` | Seats another Lead on an open lane whose Lead is gone, where the lane stands, and moves to it the asks that waited on the gone one. A Lead Paseo already started for the lane is taken on instead |
| `add_tasks` | Records tasks in the caller's lane in one call, and starts what can start. Each task gets a Peer and a branch of its own, and the lane counts as not reported ready. See [laying out tasks](#laying-out-tasks) |
| `amend_task` | Changes what a task asks until it is accepted or cut (goal, acceptance, out of scope, context, hints), keeping what it asked before, and why; the Peer reads it at its next turn. A parallel task's `holds` change too, never to none, checked as a start checks them. A changed goal sends TURNING, and widened `holds` ARCHITECTURE, to whoever supervises |
| `done` | A Peer hands its task back: an outcome (`complete`, `partial` or `blocked`), a summary and its checks. A Reviewer hands back its verdict. Refused once the task is in the merge queue, merged or cut. See [a hand-back](#a-hand-back) |
| `accept` | Queues a handed-back task for merging, the only way the lane branch takes work: see [a merge](#a-merge). Its Peer stays until the Lead releases it or the lane closes, and never takes another task. Refused while the lane is on hold, for a review or a task not handed back, while the task's copy is off its branch or has work uncommitted, and over a red gate on the same commit without `overGate` and a `reason` |
| `rework` | Sends a task back to its Peer with REWORK, a merged one too while that Peer is kept: it goes back onto its branch with the lane brought in, and the lane counts as not reported ready. Refused for a Peer that is gone, a parallel task whose copy is being put away, and a task in the lane's copy while another holds it (or, merged, while it has work uncommitted). A second rework sends STRUGGLING to whoever supervises |
| `cut` | Stops a task and archives its Peer: none of its work reaches the lane branch. A task in the lane's copy leaves it on the lane branch, its uncommitted work gone, save on the Human's own branch, where nothing uncommitted is discarded and git may refuse the switch. The task's branch stays only if it holds commits nothing else has. Refused while its merge runs. Cutting a review lets its Reviewer go |
| `release` | The Lead lets go of the Peer kept from a merged task: it is archived, a parallel task's copy and merged branch with it. Refused for a task not merged, a parallel task a review still reads, and a review. The Supervisor lets go of the Lead kept from a closed lane: it is archived after its turn, and its copy put away once nobody writes there, a landed lane's branch with it. A kept Lead archived in Paseo has its copy put away by the next round |
| `start_review` | Seats a read-only reviewing role, in the task's own copy while a parallel task still has it, else in the lane's. With `task`, it reads the change from where the task's branch meets the lane's to its last hand-back, or its head while its Peer works; a merged task as its merge; one whose copy is gone, from its branch. Without, it answers the `focus` over the lane branch. Its brief asks the question of every risk rule the change reaches |
| `ask` | Asks the seat above, with what goes on meanwhile. A Lead asks the Supervisor (`need`, `blocked` or `question`) and works on its `default`. A Peer asks its Lead with its `bestGuess`, which the letter shows as its default; a Reviewer asks with what it `tried`. Either goes to whoever supervises when the Lead is gone, and each round moves an open ask whose reader is gone the same way |
| `answer` | Closes an open ask. The Supervisor may answer any ask, and the seat it was put to gets ANSWERED FOR YOU; other seats answer only asks put to them |
| `message` | The Supervisor messages a lane's Lead, a Lead kept from a closed lane included, or a task's Peer, whose Lead must be seated and gets RECONCILE first. A Lead messages a Peer of its own lane. A seat that is gone, or a task merged or cut, takes no message |
| `report` | The Lead reports its lane to the Supervisor as REPORT; with nobody supervising seated, it is kept in `events.log`. Without `ready`, it takes back an earlier ready report. For `ready`, see [ready and landing](#ready-and-landing) |
| `land_lane` | Lands a lane on its base as the project's `landAs` says, or holds it for the Human when it touches `askFirst`: see [ready and landing](#ready-and-landing) |
| `drop_lane` | Closes a lane without landing, with a reason, and keeps its branch for the Human; it works on a lane on hold. A waiting lane is dropped before anything starts. See [closing a lane](#closing-a-lane) |
| `hold_lane` | Stops a lane where it stands, with a reason: its Lead and each Peer and Reviewer still at work get HOLD past the outbox, which cuts a running turn short where the agent allows. Until `resume_lane`, mail to the lane's seats waits, their permission requests are refused, `add_tasks`, `accept` and `land_lane` are refused, nothing waiting starts, and a landing waiting to finish or waiting for the Human is called off; one the Human approved stands. `start_review`, `rework`, a ready `report` and `replace_lead` are refused too, and a task accepted before the hold waits queued until it resumes |
| `resume_lane` | Lifts a hold: each seat of the lane gets RESUMED, with the Supervisor's `note` and the mail held for it, and what waited may start |
| `ask_human` | Puts a decision only the Human can make on their question queue, with a recommendation and what goes ahead while they are silent: see [Questions for the Human](#questions-for-the-human) |
| `record_human_answer` | Records an answer the Human gave in the Supervisor's chat: an option, `decline` or `cancel`, with their own words, which the desk must find in that chat |
| `incidents` | Lists the 50 most recent incidents that are open or not yet marked, with what each seat was asked. With `closed`, it adds the 20 most recently marked. A Lead sees only those about the other seats of its open lane |
| `mark_incident` | Marks an incident `useful`, `noise` or `unknown`, with an optional note, and closes it. `noise` also silences the same words on that seat and kind, at attention level; a page is never silenced |
| `judge` | The Watcher answers a case: see [Questions to a model](#questions-to-a-model) |
| `record` | A seat's steps, one numbered line each, without output or diffs: the last 40, or up to 200 with `limit`. A Lead reads the tasks of its own lane; the Supervisor and the Watcher read any lane's Lead or task. For a seat already archived it shows what the desk kept, since Paseo starts an archived agent again to read its history |
| `status` | For the Supervisor: lanes, tasks, working copies, open asks, open questions, the Leads kept after their lane closed, and the project's own checkout, with whether the Human must say where the next lane works. A Lead sees its own lane and asks, with the Peers kept from its merged tasks; a kept Lead, only that it is kept. Asked again within the minute with nothing changed, it says only that |
| `note` | Writes a page into a folder the caller's role keeps pages in under the project's state (the Lead's: `plans`, `council`, `ultra-review`, `repo-refresh`), replacing one of the same name, and answers with its path. It never writes into the repository. The Lead has no file-editing tools, except on Codex, where only its prompt keeps it from editing |

`message`, `rework`, `answer`, `amend_task` and `amend_lane` are also refused when their text names an open incident
about the seat it goes to, or quotes its words.

### set_project fields

Every field is optional; one left out keeps its value.

| Field | Sets | Default |
|---|---|---|
| `base` | The branch lanes start from and land on. It must exist | set by the first lane not carried on the Human's branch |
| `gate` | The command that proves a lane works, run in its copy. An empty string is an answer: no gate, and the desk never detects one over it | [detected](#gate-detection) |
| `gateTimeoutMinutes` | How long a gate run may take before it counts as failed | 30 |
| `gateOn` | `task` also gates each hand-back and each merge, unless the gate already ran on that commit. `lane` gates only the ready report and the landing, for a slow suite | `task` |
| `serialOnly` | Globs only one writer at a time may write. Replaces the kit's list | the kit's |
| `landAs` | How a lane goes onto its base: `squash` one commit, `merge` a merge commit, `ff` a fast-forward | `squash` |
| `laneHome` | Where lanes work when a call does not say: `onBranch`, `newBranch` or `isolate` | none: asked when it matters |
| `askFirst` | Paths no landing touches before the Human looks. A path covers what is under it. The whole list each time | empty: nothing waits |
| `riskRules` | Rules that replace the kit's: each has `paths`, an `invariant`, a `reviewQuestion` and an optional `rehearse` command | the kit's one rule, for migrations, schemas and SQL |

### Local files

For a project that keeps its agent instructions and plans out of git, two values in `projects/<slug>/project.json` are
set by hand. `set_project` keeps them and cannot change them: they widen what seats may write, so they are the Human's.

| Value | Default | What it does |
|---|---|---|
| `links` | `[]` | Paths, relative to the project root, that each copy of its own a lane or task works in gets as a symlink to the project's copy. A path is linked only if it exists in the project, stays inside it, is not already in the copy, and git ignores it. A path git would see as a change is skipped, since it would leave the copy dirty and fail the gate. Each skip is logged and written to `events.log` as `link.skipped` |
| `writable` | `[]` | Paths, relative to the project root, that seats may write through their agent's sandbox (`writable_roots` for Codex, `sandbox.filesystem.allowWrite` for Claude Code). They are granted as real paths, which is what a write through a link in a copy resolves to |

A role that can `work` or `write` is also granted the repository's git directory: a copy keeps its index and refs there,
and a sandboxed agent could not commit without it.

Git matches a link as a file, so an ignore rule with a trailing slash (`docs/plans/`) does not cover it: write
`docs/plans`.

```json
{
  "links": ["AGENTS.md", "docs/WORKFLOW.md", "docs/plans", "docs/patterns"],
  "writable": ["docs/plans", "docs/patterns"]
}
```

### Where a lane works

By default a lane works on a lane branch it starts in the project's own checkout; with `isolate`, in a copy of its own.
With `onBranch` it carries on the branch the checkout is on, or with `newBranch` too, on a branch it first starts there
that takes the uncommitted work along; landing such a lane merges nothing anywhere. With `after` it waits, and opens by
itself once every lane it names has landed, checked again against the lanes open then. A letter says if it cannot, or
if one of those lanes closes without landing; waiting for an `onBranch` lane takes `onBranch` too. With `detourOf` it
clears a missing prerequisite of another open lane, and does not wait for the checkout: it takes a copy of its own when
another lane holds it. When it lands, that lane's Lead gets CLEARED; dropped, DETOUR DROPPED, since the way is not
cleared.

Before a lane takes the checkout while that holds uncommitted work or sits on a branch other than the base, the Human
decides where it works. The call says so (`onBranch`, `isolate` true or false, or a `base`), or the project's
`laneHome` does; else the call is refused with the choices. Over uncommitted work only `onBranch` or `isolate` settles
it. A lane that waits with `after` is not asked: when it opens into a free checkout, anything uncommitted or untracked
there stops it, and it waits again until a lane closes. One whose `after` has all landed opens at once, and is asked
like any other.

`open_lane` is refused when its write set meets an open lane's write set or `contracts`, or its `contracts` meet an open
lane's write set. It is refused when its write set reaches a one-writer path an open lane may write; an open lane with
no write set counts as reaching them all. It is refused while another lane works in the checkout, unless it passes
`isolate`, is a detour or waits with `after`; with `onBranch`, until that lane closes. A lane that declares no write set
opens anyway, and it and its Supervisor are told which one-writer paths open lanes may be writing.

### Laying out tasks

- A task waits for what it names in `after`, keys of this call or tasks of the lane, and starts once all are merged. One
  that waits for a task that is cut is held, to be cut and started again.
- Tasks in the lane's copy given in one call wait each for the one before. Such a task works in the lane's copy on a
  branch of its own, one at a time: it waits while another holds the copy, until that one is merged or cut.
- A `parallel` task works in a copy of its own and names in `holds` what it writes while others run beside it; only it
  may write those. `hints` say where a Peer might start reading, and fence nothing.
- Each brief names the tasks written beside it and what they hold. A Peer at work in the lane's copy gets BESIDE when a
  parallel task starts after its brief was written.

The whole call is refused while the lane is on hold. It is also refused when two tasks that may run at once hold one
path, a parallel task holds nothing or a one-writer path, a task in the lane's copy names `holds`, or a held path lies
outside the lane's write set. And it is refused when a task holds a path a running task still holds without waiting for
it, names a skill its role does not have, waits for a task that is missing or cut, or has a key that repeats, names a
task on record, or waits on others in a loop.

### A hand-back

| Part | What the desk does |
|---|---|
| The lane first | Brings the lane into the task's branch, so the gate runs on what the lane would become. Conflicts stop the hand-back and are left in the copy for the Peer to settle and commit; the Lead gets SETTLING. A copy with work uncommitted is left as it is, and the hand-back says so |
| What changed | Names the commit, read from the branch, and the files the task changed, counting only its own commits. A note marks each file in what a task beside it holds, outside the lane's write set, or, for a parallel task, outside what it holds, a one-writer path called so. MERGED carries the same notes |
| The gate | On a project gating each task, the default when it has a gate: runs the gate, then rehearses each risk rule the change reaches, stopping at the first that fails |
| A review | Takes the verdict (`accept`, `changes` or `reopen`), the answer to the focus, each finding (severity, place, failure, fix; at least one for `changes` or `reopen`), and an answer to each risk-rule question of the brief, in order; refuses it without them |
| Where it goes | Keeps it whole in `handbacks/`, and sends HANDBACK to the Lead, or to whoever supervises once the Lead is gone |

### A merge

A lane's merges run one at a time. Each brings the lane into the task's copy again if it moved. Conflicts are left in
that copy and the task goes back to `done`, its Lead's like a red one; the Lead gets MERGE CONFLICT, to send its Peer
back to settle them or cut the task. When the
project gates tasks, the gate and its rehearsals run there as at a hand-back, unless they already ran on that commit,
and a red task goes back to its Lead as MERGE RED unless the Lead accepted that very run with `overGate`. The lane
branch then moves to a merge commit of the tree the gate saw, and only from the tip it saw. A task in the lane's copy
leaves it back on the lane branch.

The task stays queued, and its Lead gets MERGE WAITS once per reason, when its copy cannot take the lane in (work
uncommitted there, or git fails), when the lane's copy is on the lane branch with work uncommitted, or, asking nothing of
the Lead, when the lane moved under the gate. It is tried again as each turn ends, and before a ready report or a
landing. Other failures, a merge that stops on an error included, are MERGE FAILED.

### Ready and landing

`report` with `ready` first lets the merges accepted before it land; it is refused while a Peer is mid-turn in the
lane's copy or that copy is on a task's branch, until that task is merged or cut. It runs the lane gate: the gate, then
a rehearsal of each risk rule the lane's change reaches. Any red is a red gate, and so is a lane copy with anything
uncommitted or untracked, without a run: on a lane carried on the Human's branch, their own work in progress. The lane
stands reported ready all the same, and landing over the gate is the Supervisor's call. An open `costly` question about
the lane puts it on hold. The report says whether landing will wait for the Human, what the desk read of the change,
and what the reviews leave standing: no review of the whole lane; a latest review that did not accept; a task accepted
over its own review's changes, or handed back again after them and accepted with no review since. Its `Next:` asks, the
first that applies: tell the Human the lane waits on a question; land over the red gate or not; check with the Lead
before landing, where review changes stand that nothing on record answers; land.

`land_lane` is refused for a waiting lane, which is dropped instead, and for a lane on hold. Otherwise, in order:

1. It waits for queued merges; a project lands one lane at a time.
2. If the base moved on, it merges the base into the lane in the lane's copy. With a seat mid-turn there it stops, and
   CAN LAND comes when that turn ends. Conflicts are left in the copy, the Lead gets BASE CONFLICT, and the lane counts
   as not reported ready. It is refused while a task holds the lane's copy on its own branch, until that task is merged
   or cut.
3. It runs the lane gate. A red gate lands only with `overGate` and a `reason`.
4. A lane that changes a path in `askFirst`, or whose standing orders cannot be read, or whose change cannot be read
   while `askFirst` is set, waits for the Human: its Lead gets LAND HELD, and LANDED or SENT BACK comes to the
   Supervisor as mail.
5. It lands the head the gate saw, as `landAs` says; a lane that moved after its gate lands nothing, and neither does
   one whose base has uncommitted changes where it is checked out, or is checked out in another copy. A lane carried on
   the Human's own branch merges nowhere, and its work stays there.

A lane not reported ready as it stands lands all the same, with that and the review facts as evidence. A ready report
stands until the lane changes under it: an amendment, new tasks, a task merged or sent back after it, a base conflict
while landing, or a landing the Human sends back. A landing the Human approved while the lane stood ready waits for
the next report if the lane lost it since; one they approved before it was reported ready lands.

### Closing a lane

Landed or dropped, a lane first waits for its queued merges. Closing answers its open asks as closed, cancels its open
questions for the Human, cuts its leftover tasks and names them in its reply, and archives every Peer of it, kept ones
too. A ready report and a landing's evidence name each task that is not settled yet, since landing cuts it. Its Lead stays, with any copy of its own, until `release`, and gets
LANE CLOSED. A lane in the project's own copy puts it back on base once no seat is mid-turn there. A copy a task still
held comes off that task's branch once no seat is mid-turn there (a copy kept with its Lead, only if none is at the
close), the Human's own branch taking their uncommitted work along; the task's branch goes unless it holds commits
nothing else has. Then waiting lanes may open.

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

A lane works on `lane/l<n>-<title>`, unless it carries on the Human's own branch, and a task on
`task/l<n>-t<n>-<title>`: the title in lower case with dashes, cut at a word break to at most 24 characters. Every
landing onto a base keeps the lane's own commits at `refs/seatworks/lanes/<lane>`, which `git branch` does not list.

## Letters

The desk writes every letter, in `desk/letters/`: `envelope.ts` holds what every letter goes out in; `work-letters.ts`,
`seat-letters.ts`, `message-letters.ts` and `watch-letters.ts` hold a task's and a lane's course, what the desk sees of
a seat, messages and answers by mail, and the watch's; and for asks and questions, merges, landings, the Watcher's
cases and a kept Lead, `ask-letters.ts`, `merge-letters.ts`, `land-letters.ts`, `case-letters.ts` and `kept-letters.ts`.
First prompts come from `briefs.ts` (Peer, Reviewer) and `directive.ts` (Lead) beside them, and `desk/watch/pager.ts`
(a Pager's two lines); a
Watcher starts from its first case. A letter mailed carries a key made of its kind and the ids that make it
that letter, never written by hand where it is posted, and ends with one `Next:` line: what it asks of its reader,
picked from what the desk knows (a red gate, the kind of an ask, whether the reader is the Lead or whoever supervises
because the Lead is gone, whether the task merged was the lane's last). OWNER DIRECTIVE, TASK and REVIEW are a seat's
first prompt, not mail, and carry neither.

| Kind | Letters |
|---|---|
| A seat's first prompt | OWNER DIRECTIVE, TASK, REVIEW |
| Starting and waiting | OPENED, NOT OPENED, WAITING, NOT STARTED, BESIDE |
| Between seats | MESSAGE, RECONCILE, ASK, ANSWER to your ask, ANSWERED FOR YOU, STILL OPEN, UNANSWERED |
| Work coming back | HANDBACK, REWORK, AMENDED, SETTLING |
| Merging | MERGED, MERGE RED, MERGE WAITS, MERGE FAILED, MERGE CONFLICT |
| Landing | REPORT, BASE CONFLICT, CAN LAND, CLEARED, DETOUR DROPPED, LANE CLOSED |
| A landing held for the Human | LAND HELD, LANDED, HELD AGAIN, CHANGED, APPROVED, SENT BACK, LAND SENT BACK |
| The Human | HUMAN WROTE, HUMAN ANSWERED |
| A lane stopped | HOLD, RESUMED |
| The desk noticing | SILENT, FAILED, WAITING FOR PERMISSION, LANE IDLE, LEAD GONE, INCIDENT, the bare nudge |
| A moment to look | ARCHITECTURE, STRUGGLING, TURNING |
| A question for the Watcher | CASE |
| Answering late | ANSWER to your `<tool>` call, NO ANSWER to your `<tool>` call |

| Letter | Tells its reader |
|---|---|
| BESIDE | The Peer at work in the lane's copy: a task started beside it after its brief was written, and what it holds. A Peer that has handed back reads it with its next letter |
| SETTLING | A Lead, in passing: bringing its lane into a task's branch at hand-back stopped on conflicts, which that task's Peer settles before it hands back |
| RECONCILE | A Lead: what the Supervisor sent its Peer |
| ANSWERED FOR YOU | A seat: someone else answered an ask put to it |
| MERGE CONFLICT, BASE CONFLICT | A Lead: the desk began a merge no seat may run, and left its conflicts in the copy of whoever settles them (the task's own, or the lane's) for a Peer to settle and commit |
| CAN LAND | Whoever tried to land a lane under a seat mid-turn: the turn has ended |
| HUMAN WROTE, HUMAN ANSWERED | Whoever supervises: what the Human typed straight into a Lead's or Peer's chat; what they chose for a question on the panel |
| HOLD | The seats of a lane: stop. The one letter sent past the outbox, cutting a running turn short where the agent allows |
| ARCHITECTURE, STRUGGLING, TURNING | Whoever supervises, at the three moments SLP names, as the desk sees them: a Lead widening what a parallel task holds; a task sent back a second time, or stalled; a Lead changing what a task is for |
| NO ANSWER | A seat: the plugin stopped before a call it was told to wait for by mail had finished |

Some letters ask nothing of their reader, so they wait for the next letter that does. For the Supervisor: OPENED,
WAITING for a lane that opened by itself, LANDED and SENT BACK. For a Lead: WAITING for a task that started by itself,
LAND HELD, LANE CLOSED, SETTLING, a MERGE WAITS the desk clears by itself, and a MERGED with nothing to note while other
tasks remain.

## Mail

One outbox, `outbox.json`, holds every project's letters. The desk tries a seat's mail when a letter is posted to it,
when its turn ends, and each round. The first row that fits decides:

| Situation | What happens |
|---|---|
| Nobody to send it to, such as no Supervisor seated | Not kept. LANE IDLE, LEAD GONE, UNANSWERED and a held incident are tried again next round |
| Paseo can't look the seat up | Held |
| The seat is archived | Never sent, nor passed to another seat. `status.md` lists them, with when each is given up on, until they age out |
| The seat has a pending permission | Held |
| The seat's lane is on hold | Held until `resume_lane`, or until the lane is dropped |
| Running, its agent `steers`, the turn started at least 60 s ago, and it waits on no desk call | **Steered** into the turn |
| Running or starting | Held |
| Mailed less than 10 minutes ago, with no turn end since | Held |
| Every letter for it asks nothing of it | Held until one that does |
| Otherwise | Sent: every letter waiting for it in one message, with the open asks put to it |

| Timing | Value |
|---|---|
| A call's answer goes by mail | After 240 s, when the seat is told the answer arrives as mail; at once when its harness stops the call or its line to the desk drops. After a plugin reload, a call first waits for Paseo to reach the plugin, and its 240 s count from then |
| The same call again while the first still runs | Joins that run, and waits up to 240 s of its own before it is told the answer arrives as mail |
| A harness that asked for progress hears a call still runs | Every 20 s |
| A seat's dropped line to the desk is tried again | After 2 s, or at its next call |
| A duplicate letter: same kind, same ids, same reader | Dropped while the first waits, and for 30 minutes after it is sent while the plugin runs |
| A letter nobody took | Given up on after 7 days, and dropped the next time any letter is posted |

## Permission requests

| Seat | Where the request goes |
|---|---|
| Lead | A letter to whoever supervises; with none seated, only Paseo |
| Peer or Reviewer on a task | A letter to its Lead, or to whoever supervises once the Lead is gone; with neither, only Paseo |
| Supervisor | `attention.log`, and `status.md` under "Waiting on the Human". The Human answers it in Paseo |
| Peer or Reviewer with no task, the Watcher, the Pager | Only Paseo |

While a seat's lane is on hold, its requests are refused with the hold's reason. A question that would stop a turn (such
as AskUserQuestion or `request_user_input`) from a seat with desk tools is refused, with where to ask instead by the
tools it holds: `ask_human`, or its reply at the end of its turn, for the Supervisor; `ask` for a Lead, Peer or
Reviewer; and for the Watcher, which holds neither, to settle it from what it has. On Claude, the Lead, the Watcher and
the Pager are denied AskUserQuestion outright, so theirs never reaches the desk. Only the Human can answer any other
permission.

## Gate detection

A project with no gate on record gets one at its next `open_lane`, found in the project root by the rules in
`catalog/ecosystem.json`, the first that matches. Finding none records nothing, and the next `open_lane` looks again. A
gate set empty with `set_project` is the Human's answer, and nothing is detected over it.

| Found | Gate |
|---|---|
| `package.json` with a real `test` script, not the placeholder npm writes | `pnpm test`, `yarn test`, `bun run test` or `npm test`, by lockfile |
| `mvnw` | `./mvnw -q test` |
| `pom.xml` | `mvn -q test` |
| `gradlew` | `./gradlew test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pyproject.toml` or `pytest.ini` | `pytest -q` |

A gate runs in the lane's or the task's copy through `/bin/sh -c`, with `CI=1` set. Whatever it leaves running is killed
when it ends, and a run past `gateTimeoutMinutes` is killed and counts as failed. Each run writes its output to
`gates/<lane or task>-<ms>.log` (a task's rehearsals add `-<n>`), and a failure is told with its last 40 lines, at most
3,000 characters.

`catalog/ecosystem.json` also holds the paths only one writer at a time may write (a project's own `serialOnly` replaces
them), the kit's risk rule for migrations, schemas and SQL (a project's own `riskRules` replace it), how test and docs
files are named, and the watch's default patterns. A file of the same name in the state root replaces it, as one does
`roles.json`, `catalog/refused.json` and `catalog/paseo.json`.

## Questions for the Human

A question is a decision only the Human can make: a behaviour the concept leaves open, a risk only they may take. The
Supervisor puts it on their queue with `ask_human`, and its turn goes on; no seat stops a turn to ask
([permission requests](#permission-requests), [the Human in the loop](ARCHITECTURE.md#the-human-in-the-loop)).

| Field | Holds |
|---|---|
| `question` | The decision, in the Human's words where the Supervisor has them |
| `why` | Why only the Human can answer it, in a line |
| `lane` | The lane it concerns, if one does. It must be open or waiting |
| `options` | 2 to 4 choices, each a `label` of at most 60 characters and an `effect`: what the user sees if it is chosen, and for anything that cannot be undone, what it costs. Labels differ, case aside, and none is `decline` or `cancel` |
| `recommend`, `reason` | The label of the choice the Supervisor recommends, and why |
| `ifSilent` | What goes ahead while the Human has not answered, and until when it can still be undone |
| `class` | What goes ahead while they are silent, below |

| Class | While the Human is silent |
|---|---|
| `reversible` | The lane goes on as recommended. Nothing waits, and the Human can turn it back |
| `costly` | The lane goes on as recommended until its Lead reports it ready. The desk then puts it on hold, and the REPORT says it waits for the Human |
| `irreversible` | Nothing it decides goes ahead: the desk puts its lane on hold at once |

- A `reversible` question about a lane whose write set, or whose change so far, reaches a path in `askFirst` is recorded
  as `costly`, and the reply says why. A question with no lane holds nothing, whatever its class.
- A lane on hold for a question stays on hold until the Supervisor calls `resume_lane`: an answer does not lift it.
- A `costly` question stops its lane at the ready report made while it is open, or at once when the lane already stands
  reported ready. `land_lane` does not look at questions.
- Nothing times a question out. It stays `open` until it is settled, or until its lane closes, which cancels it
  (`question.answered` by `desk`); it settles once. A lane stays on record while any of its questions is under a day
  old, since the daily count reads the ledger.
- `ask_human` is refused once `questionsPerDay` questions (3 by default) were put in the last 24 h across every project
  on the machine. The refusal names them, and tells the Supervisor to decide it itself if it is its to decide, fold it
  into a question still open, or ask once the day turns.

**On the panel**, each open question is a card on the Flow tab while the tab follows the team live: its options, the
recommendation and why, and what goes ahead meanwhile. The Human chooses an option (`answered`) or declines
(`declined`), with an optional note; the panel cannot cancel. The seat that asked, or whoever supervises if it is gone,
gets HUMAN ANSWERED: the choice, the note in the Human's own words, and whether the lane is still on hold.

**In the Supervisor's chat**, the Supervisor records the answer with `record_human_answer`: the question's id, the
`choice` (an option's label, `decline`, or `cancel` for the Human's "not now", which makes it `canceled`), the Human's
words as `quote`, and optional `text`. The desk looks for the quote among the Human's own messages in the last 200
entries of that chat, spacing, case and a closing stop aside; a quote it cannot find refuses the call. Messages from
before a daemon restart carry no sender, so they cannot be quoted.

What the Supervisor is told:

- By `ask_human`: the id; that the class was raised to `costly`, and why, when it was; what goes ahead while the Human is
  silent; whether the lane is on hold; and that an answer given in the chat goes on record with `record_human_answer`.
- By HUMAN ANSWERED, in its `Next:`: after a decline, the call is the Supervisor's; after an `irreversible` question,
  carry the choice into the lane; after a choice other than the recommendation, turn round what went ahead. All but a
  decline add: write the choice into `CONTEXT.md` if it settles the concept. A lane still on hold adds `resume_lane`.
- By `record_human_answer`: the question's status and, while its lane is still on hold for it, to call `resume_lane`
  once the answer is carried into the lane. By a REPORT that stops at a `costly` question: the lane is on hold, and to
  tell the Human it waits for them.

Open questions also show in the Supervisor's `status` and in `status.md`, under "Questions for the Human". The Report
tab lists an open question under "Needs you" when nothing it decides goes ahead (an `irreversible` one, or a `costly`
one that stopped its lane at the ready report), even after `resume_lane`, and every other under "Went ahead on its
recommendation", with the count of the last 24 h across every project, the one `questionsPerDay` limits. `events.log` has `question.asked` and `question.answered`.

## Facts

What the watch reads in code, from a seat's turn as it runs and from a lane's record each round
([the watch](ARCHITECTURE.md#the-watch)). A fact from a turn goes to `events.log` as `watch.fact`, and every `page` or
`attend` fact, which can open an incident, as `watch.finding`; a `note` opens none. Only live turns are read: what a
seat did before the watch followed it, as across a plugin reload, is never judged.

**From a seat's turn**, for the roles that can be `watched` (Lead, Peer):

| Fact | Level | Fires when |
|---|---|---|
| `destructive` | page | A shell command matches the destructive pattern, checked one command at a time. Removing only scratch files, under the temp directory or made by the same command, does not count |
| `stuck` | attend | In the last 20 steps since the seat's latest instruction, ending with the newest: the same action and result `repeatsAt` + 1 times (4 by default), the same action failing `repeatsAt` times, the same words `repeatsAt` times, or two actions alternating `repeatsAt` times |
| `no-recovery` | attend | Ten calls after a failed shell command, neither that program nor the gate has passed. Another command failing starts the count again |
| `test-weakened` / `suppressed` | attend | An edit removes assertions from a test or adds a skip, or adds a suppression such as `@ts-ignore` |
| `unverified` | attend | A Peer hands back, with no gate result from the desk, after writing files in its copy, prose aside, that it never ran the gate on. Needs a gate |
| `claim-contradicted` | attend | A Peer hands back `complete`, with no gate result from the desk, though the gate it last ran, after its last edit, failed. Needs a gate |
| `long-turn` | attend | A turn runs past `longTurnMinutes`, or, once the seat has finished five turns, past three times its median turn, whichever is longer |
| `call-failed` / `gate-failed` / `outside-scope` | note | A call other than a desk call failed; a run of the gate failed; a file was written outside the seat's copy, or outside what its task may write. Evidence only, never an incident alone |
| `edit-before-look` | note | A turn's first step, desk calls and Paseo's own steps aside, changed a file before it read, searched or ran anything since an instruction the watch still holds. It opens only the `instruction_kind` question |

**From a lane's record**, read each round and filed against the lane's Lead:

| Fact | Fires when |
|---|---|
| `rework-loop` | One task not yet merged or cut was sent back `reworksAt` times (3 by default) |
| `patched-not-fixed` | That many sendings-back are spread over two or more tasks not yet merged or cut |
| `reviews-unconverged` | `reviewsAt` reviews (3 by default) of one task not yet merged or cut, whatever their verdicts |
| `certainty-only` | A review's focus asks only for what the Reviewer is sure of |
| `brief-prewritten` | A code task not yet merged or cut has a brief with code in a fence, or numbered steps that name a file and a member or chain one change after another |
| `accepted-unfinished` | A task merged whose Peer handed it back `partial` or `blocked` |

`unverified`, `claim-contradicted` and `edit-before-look` are read at the end of a completed turn only. A lane fact adds
to its open incident each round until that is told; once it is told, or closed in the same words, it is not raised
again. [ANTIPATTERNS.md](ANTIPATTERNS.md) says which pattern each lane fact answers.

## Holds

An incident is what the desk books from `page` and `attend` facts: one per seat and kind while it is open, a later
sighting adding to it. It is sent once: an attention-level incident about a Peer to its Lead while that is seated, any
other to whoever supervises, never to the seat it is about. Until then it may be held (a lane on hold is another thing:
`hold_lane`):

| Held | Meaning |
|---|---|
| shadow | `attention.watch` is off, the default. Attention-level incidents are recorded, not sent; a page is sent |
| probation | At least ten of this kind are marked `useful` or `noise`, and fewer than half of the last ten were useful. Recorded, not sent; seen again once the marks turn, it is sent |
| budget | `incidentsPerLane` attention-level incidents about this lane (2 by default) went out in the last 24 h. Those about no lane share one budget |
| nobody | Nobody to tell, or the only one is the seat it is about. Each round tries again: a page always, an attention-level incident while `attention.watch` is on |

- A page is held only while nobody is there to tell, and it also reaches the Human's phone. As it opens, the desk starts
  a Pager for it: a role with no tools but, on Codex, a read-only shell. Its one reply is two lines the desk writes: the
  repository, the seat and the command, whether its Supervisor was told, and whether the lane is on hold. Paseo pushes
  an agent's first finished turn, and pushes an agent once until someone opens it, so each page has a Pager of its own.
- An attention-level sighting in words already marked `noise` for that seat and kind opens nothing; a page always does.
- A seat's incidents close when it is archived, when its task merges, and when the lane it leads closes; closed, they
  still wait to be marked. `incidents.json` keeps the open ones and the newest 500 closed.

## Questions to a model

The watch also asks what a code fact cannot read, one condition at a time, at the moment it matters:

| Question | Asked when | Of |
|---|---|---|
| `asked_for` | A command cannot be undone, a test is weakened or a check silenced | The seat's latest instruction, and its task's goal and acceptance, or its lane's for a Lead: did they ask for that act? |
| `instruction_kind` | The first thing a turn did was change a file, before any read or run | The instruction: what does it mainly do, `new_requirement`, `claims_code_bug`, `asks_question`, `approves` or `other`? |
| `summary_admits_gap` | A task is handed back `complete` | Its summary: does it say something asked for was not done? |
| `claims_checks_pass` | A hand-back the desk did not gate is `unverified` or `claim-contradicted` | The hand-back: does it say the checks pass? |
| `review_ran_invariant` | A review accepts a change a risk rule reaches | Its report, once per invariant: was it checked by running code? |

- `catalog/checks.json` holds each question's wording, what each answer means, and its thresholds: the shipped
  yes-or-no questions hold at 0.8 or more and fail at 0.2 or less, unclear between; the choice is taken at 0.6 or more.
  A question's `mode` is `off` or `shadow`; only a `shadow` one is asked, and every shipped one is.
- `instruction_kind` is asked only when the instruction came from a sender its `after` names: a REWORK, MESSAGE,
  AMENDED or LAND SENT BACK letter, an ANSWER to an ask, or the Human. No question reads an instruction the watch's
  window has lost.
- Who answers is `attention.judge`, set on the panel (Team › Watcher, *Answered by*):
  - `off`: nothing is asked.
  - A sensor in `catalog/sensor/`, asked over HTTPS with its key; without the key, nothing is asked. The preset's is
    `jev`: `typesafe/jev-1.13` through OpenRouter, with data collection denied, 5 s a try and one retry.
  - A role that can `judge`: the Watcher seat, below.
- **Shadow:** each answer, and each failure to get one, is appended to the project's `assessments.log` with the case,
  the questions, who answered and the verdicts; a failure also writes `watch.unasked` to `events.log`. No seat is sent
  it, and nothing acts on it. The Flow tab says who answers and how that stands: nobody, a sensor with no key, nothing
  asked yet, the last answer or the last failure, and how long ago.

**The Watcher seat.** The desk seats one per project when a case first needs it, in the project's own workspace and
always under its Supervisor: a seat with no parent would have its first reply pushed to the Human's phone. With no
Supervisor seated, no Watcher is, and the case goes unasked. Each case comes as CASE: the fields the desk read, and the
questions with what each answer means. The Watcher answers with `judge`, every question once, by name, with `yes`, `no`,
`unsure` or a choice's name, and a why; anything else is refused and nothing is kept. `record` lets it read any lane's
Lead or task, the seat a case is about among them. On every agent but Codex it has no other tool; Codex cannot take its
shell away, so there it keeps a read-only one. It has no MCP server unless one names it. A case unanswered 15 minutes
after it was sent, or whose Watcher is gone, is kept as unasked. The round lets an idle Watcher go once no lane is
open, or once something else judges the watch.

## Hooks and events

| Hook or event | What the plugin does |
|---|---|
| before `agent.create` | For a `sw2-` provider: builds the seat directory, sets the launch's model, mode, thinking and system prompt, and its MCP servers where the harness takes them at launch, and gives a seat with desk tools its key. A seat that cannot be built refuses the launch, with the reason |
| before `agent.session_open` | Seeds the project's records, rebuilds the seat directory if needed, points the agent's config directory at it, gives the seat back its key, and puts the kit's `git`, `gh` and `paseo` first on its `PATH`. A seat directory that cannot be rebuilt refuses the session |
| `agent.created` | Follows the seat's timeline, if its role can be `watched` |
| `agent.turn_started` | Notes when the turn started, for reading turns and steering |
| `agent.turn_ended` | Archives a seat that waited for its turn to end, finishes teardowns that waited on it, sends CAN LAND to whoever waited to land under it, retries queued merges, reads the turn (a failure, a Peer or Reviewer silent without `done` or `ask`, a call its harness rejected as not JSON), and tries the seat's mail |
| `agent.permission_requested` | Refuses it while the seat's lane is on hold, and refuses a question with where to ask; otherwise mails the request to the seat's owner, or logs it |
| `agent.archived` | Forgets the seat's key and timing, marks it gone on record, stops its watch, and closes its open incidents |

## Harness fields

`harness/<agent>/harness.json` is read against a schema. A field it does not know, at any depth, fails the load and is
named, except inside the blocks passed to the agent as they are: `mcp.seed`, `mcp.desk`, what `mcp.clear` sets,
`provider.env`, `forceFlags` and `files`, which take any key.

| Field | Drives |
|---|---|
| `id`, `label` | The harness's name, and the agent half of a provider's label |
| `baseProvider` | The Paseo provider it extends: `claude`, `codex`, `pi`, `omp` or `opencode` |
| `configDirEnv`, `profileRoot` | The variable that points the agent at its seat directory, and where seat directories live |
| `contextFile` | The file in the seat directory that holds the working rules |
| `projectInstructions` | Which of the project's instruction files the agent reads, which it imports into the seat's rules file when the project has none of those, and how an import is written |
| `skillsDir` | Where skills are linked, each to a copy under the state root's `content/` |
| `settings` | The kit's base settings and per-role overlay. `inherits`: keys taken from the Human's own config for that agent. `overlayEnv`: a variable that also names the seat's settings file. The plugin writes the seat's settings file whole |
| `mcp` | The MCP file and the `key` its servers go under; whether they are delivered at launch or in the file; transports; whether the seat's tools are approved at launch (`preapprove`); seed and clear rules; and `desk`, fields added to the `team` server |
| `links`, `files` | Files linked from the Human's own setup (logins, history), and files composed per role |
| `modelCatalog` | A command whose model list is written as the agent's catalog |
| `stateWrites` | The sandbox setting that lets a role write the paths it keeps under the project's state |
| `hideSkills` | The Human's own skill folders the agent would load anyway, and the settings path where each skill found there is written as `{ path, enabled: false }` |
| `projectContextOption` | The provider option that receives the working directory |
| `steers` | Whether mail may be steered into a running turn |
| `mcpCall`, `mcpServerField` | How the agent names a call to an MCP server, or the field that holds the server's name, so a call to the desk is known as one |
| `timeline` | Where the agent's timeline differs: where it keeps a command's exit code when not in the call, calls it sends that are not the seat's, and the marks of a call input that was not JSON |
| `checks` | Files the Health tab looks for |
| `provider` | Env, launch command, `forceFlags`, and the starting mode |

Required: `id`, `label`, `baseProvider`, `configDirEnv`, `profileRoot`, `skillsDir`, `settings`, `mcp` and `provider`.
Beside it, `delta/<role>.md` holds what a role's prompt needs said against that agent's own instructions, such as who
"the user" is, or a habit of implementing that a Lead must not follow. It is added after the role's prompt, in the same
place, and held to the same checks; a role with none gets nothing added.

## Seat names

A seat has one duty for life, and a plugin cannot rename an agent, so the name Paseo shows is fixed when the seat starts
and says that duty.

| Seat | Name |
|---|---|
| Lead | `<lane> · <role> · <lane title>`, as `L1 · Lead · Cart`. A Lead that replaces one gone gets the same name |
| Peer | `<task> · <role> · <task title>`, as `L1-T3 · Peer · Cart total` |
| Reviewer | `<review> · Review <task or lane>`, as `L1-R1 · Review L1-T3` |
| Watcher | `Watcher` |
| Pager | `Page: <the start of the page>` |

A name is cut at 60 characters. Labels carry `seatworks.project`, `seatworks.role`, `seatworks.concern` for a role that
names one, and `seatworks.lane` and `seatworks.task` for the work a seat does. Letters name a seat by its work (the Lead
of L1, the Peer on L1-T3) or by its agent id; a failed turn's FAILED and WAITING FOR PERMISSION use the name Paseo
shows, or the seat's role and id where Paseo shows none.

A copy of its own is a Paseo workspace named `<project slug> <copy> · <work>`, as
`shop-3f9a1c S2 · L2 Filter results`. The round's sweep knows the desk's workspaces by the project's slug leading their
names. It archives one that nothing in the ledger holds, and the project's own workspace once no lane is open and no
seat with desk tools works in the project. It also removes working copies under `worktrees/<slug>/` that no slot holds.

## Seat directories

One per role, agent and project: `<profileRoot>/sw2-<role>-<agent>-<slug>`. It is brought up to date the first time a
seat starts after the plugin loads, and again when the settings revision, the team or the agents' model lists change.
The same happens when its settings file is gone, when a login appears, and, on Claude, when the project gains or loses
its own `CLAUDE.md` or `AGENTS.md`. Its rules file (`CLAUDE.md` on Claude, `AGENTS.md` elsewhere) holds the working
rules, each enabled MCP server's and the Human's, and is written only when there are some, or on Claude an import.

- **Claude Code**, under `~/.claude/profiles/`: `settings.json` (deny rules, the sandbox, replies in Vietnamese in the
  `Concise` style, no commit attribution), `.claude.json` (its own MCP servers cleared), `skills/`, a `projects` link,
  and `CLAUDE.md`, which, when the project has no `CLAUDE.md`, imports its `AGENTS.md`. It launches through
  `bin/seat-room` with `--setting-sources user`, so the project's settings, hooks and skills stay out.
  It still reads the project's `CLAUDE.md`, since the working directory is passed as an additional directory; Claude
  never reads an added directory's `AGENTS.md`, hence the import, as Claude Code reads it outside a seat. Claude Code
  keeps its login per config dir; a seat sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` empty, so it reads the one login made
  outside any seat and never needs one of its own.
- **Codex**, under `~/.codex/seats/`: `config.toml` (`model_provider` and `model_providers` from the Human's own
  `~/.codex/config.toml`; `workspace-write`, or `read-only` for the Reviewer, the Watcher and the Pager;
  `approval_policy = "never"`; subagents off), `model-catalog.json`, `rules/seatworks.rules`, `skills/`, an `auth.json`
  link and `AGENTS.md`. Paseo's Codex provider launches it. Building a seat needs the `codex` CLI, which lists its
  models.
- **Pi**, under `~/.pi/seats/`: `settings.json` (`pi-mcp-adapter`, project trust off, tool lists for the Lead and the
  Reviewer and none for the Watcher and the Pager), `mcp.json`, `AGENTS.md`, `skills/`, and links to its login, models
  and npm. Paseo's Pi provider launches it.
- **Oh My Pi**, under `~/.omp/seats/`: `config.yml` (command denials in `bash.patterns`, tool denials, and code eval,
  subagents, questions, memory and other agents' config off), `mcp.json`, `AGENTS.md`, `skills/`, and links to its login
  and models. The plugin writes `config.yml` as JSON, which YAML reads too. The session also names it in
  `PI_CONFIG_FILES`, the overlay omp ranks above a repository's own `.omp/config.yml`, which would otherwise replace the
  seat's command denials. Paseo's omp provider launches it.
- **OpenCode**, under `~/.config/opencode-seats/`: `opencode/opencode.json` (the Human's providers, permissions with
  command denials, subagents and questions off, autoupdate and sharing off), `opencode/AGENTS.md`, `opencode/skills/`
  and a link to the git config. Its config variable is `XDG_CONFIG_HOME`. Paseo's OpenCode provider launches it, with its
  env given at each session: Paseo runs one OpenCode server for every seat, so a seat's own env reaches it only that
  way. It keeps a failed command's exit code beside the call, where the watch reads it.

## MCP servers

| Server | Kind | What it gives |
|---|---|---|
| `team` | Always there, for a seat with a tool set | The role's desk verbs |
| `intellij-index` | Proxy over HTTP to a JetBrains IDE, port 29170 by default. Needs `.idea` in the project | Code-index tools, a set per role |
| `code-search` | Proxy over stdio (`uvx … semble`) | One `search` tool |
| `context7` | Plain HTTP, no key | Library docs. Queries leave the machine |

Catalog servers are off until a settings layer turns one on. One that names no roles goes to every role with desk tools
but one that can `judge`. With `intellij-index` on, the desk itself opens in the IDE each copy a lane or task works in,
the project's own checkout included, closes a copy of its own when it is put away, and adds `.idea/` to the
repository's `.git/info/exclude`.

A proxied server runs through `mcp/code.mjs`. It can pin calls to the seat's git root, sync changed files, open the
working copy in the backend when a call finds it closed, wait out indexing, rewrite errors and replace tool
descriptions. It speaks to its backend with the official MCP client, so a backend that keeps a session or streams its
answers works, and it shows each tool with the backend's own title and hints. A backend that answers only after the
session started has its tools listed at once as not reachable, then shown as the backend gives them, as a changed list.
Progress passes through to a harness that asks for it, a stopped call is stopped at the backend too, and changed files
are synced one call at a time, before the call that follows. Stopped by its harness, closing its input or with a
signal, it closes its backend first, a stdio one sent the end of its input and then a signal if it stays, so no backend
is left running.

A desk call can take minutes (a gate), and the desk answers within 240 s, "arrives as mail" past that. A seat must wait
longer: a harness that gives up without a word to its server loses the answer, and one that stops the call gets it only
by mail. omp gives up after 30 s and Pi's adapter after 60 s unless told, so omp seats get `OMP_MCP_TIMEOUT_MS=600000`
and Pi's `team` server `requestTimeoutMs: 600000`. Claude Code waits hours, and Codex 300 s by default.

## Settings

Two layers: `~/.local/share/seatworks-v3/settings.json` for the machine, and `projects/<slug>/settings.json` under the
state root for a project ([how they combine](ARCHITECTURE.md#settings)). The project layer wins value by value, except
rules: both layers' rules are given, the machine's first. A project that puts a role on another agent drops the
machine's model and thinking for it.

| Setting | Where |
|---|---|
| Each role's agent, model and thinking | Panel, Team tab |
| MCP servers: on or off, roles, options, pasted snippets | Panel, MCP tab |
| `attention.watch`, whether incidents are mailed | Panel, Team › Supervisor, *Mail incidents* |
| `attention.judge`, who answers the watch's questions | Panel, Team › Watcher, *Answered by* |
| A sensor's key, `sensor.<id>.key`, which the panel never reads back | Panel, Machine defaults › Watcher; a project's by hand |
| The Flow switch, `flow.live` | Panel, Flow tab |
| The Flow interval, `flow.everySeconds`, 5 s by default | By hand |
| Rules for every seat, `rules`, or for a role, `roles.<role>.rules` | By hand |
| The attention values the panel does not set | By hand |

A layer that cannot be read, or fails its schema, counts as empty, and the panel says why. A save is refused when it
leaves the team with errors, or makes a seat that cannot be built. A machine-layer save rewrites the Paseo providers and
reloads the daemon when they change.

`tickSeconds` is read from the machine layer only. A seat runs as the Human. A Claude seat is denied reading either
settings file and the copies beside it (Migrate's backups, a save's staging copy), but a seat on another agent can read
them all, a sensor's key included. On Linux, Claude's sandbox skips every rule with a glob in it, so there its shell is
kept off only the machine's settings file itself; its file tools still honour every rule.

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
| `judge` | `off` |
| `destructive` | a pattern in `catalog/ecosystem.json` |
| `testPath` | a pattern in `catalog/ecosystem.json` |
| `suppressed` | a pattern in `catalog/ecosystem.json` |
<!-- end -->

`tickSeconds` is the round, 5 s at least ([the patrol](ARCHITECTURE.md#the-patrol)). A Lead idle `leadIdleMinutes`
with no task at work or queued, no ask of its own open, no hold, no ready report and no landing held brings LANE IDLE,
once per idle spell. An ask waiting on an idle seat gets STILL OPEN every `askRemindMinutes`, `maxReminders` times;
then a Peer's ask to its Lead goes to whoever supervises as UNANSWERED. The rest act where [facts](#facts),
[holds](#holds), [questions for the Human](#questions-for-the-human) and [to a model](#questions-to-a-model) name them.

A `roles.json` in `~/.local/share/seatworks-v3/` replaces the preset whole. A role names `defaults` or `follows`, never
both. A follower takes the agent, model and thinking of the role it follows until it is given its own. Each role still
needs its settings file under `harness/<agent>/settings/`, and on Codex its `rules/<role>.rules`; an agent missing one
is not offered for that role.

## Panel

| Tab | What it holds |
|---|---|
| **Team** | The agent per role, its model and thinking. The Supervisor's chip also holds *Mail incidents*; the Watcher's, *Answered by* and a sensor's key |
| **Flow** | Live while its switch is on. First what waits for the Human: each open question, answered with an option or declined, and each landing held for approval, approved or sent back, each with a note. Then the supervisors, lanes and tasks. Then the watch: who answers and how that stands, the open incidents (at most 200, pages first), and trouble nobody is mailed about. Then the open asks |
| **Report** | The project's last 24 h, read from the record, not written by an agent: what needs the Human, what went ahead on a recommendation, what landed, what could not be undone, and the counts |
| **Orders** | What the Human settled, read only: the paths asked about first, the risk rules, where lanes work, and `CONTEXT.md`. The Human changes them by telling the Supervisor |
| **MCP** | Servers on or off, their roles and options, and adding one from a snippet |
| **Health** | The machine's checks and, on a project, its status page |
| **Plugin** | Update, Migrate and Clean up, for the whole machine |

On the Flow tab each seat opens its chat in Paseo, and an open lane its diff. A lane says whether it works in the Human's
checkout or a copy of its own; a task, whether it runs in parallel, in which copy, and what a waiting one waits for.
Each Peer kept after its accepted task, and each Lead kept after its lane closed, shows until released. A seat stopped
on a permission reads "waiting on you". The tab draws at most 50 lanes; the status page lists them all.

Models and their thinking options come from Paseo, which asks each agent; each agent's mode is fixed by its harness. The
plugin lists them once a load, and **Refresh** under the Team tab asks again. A role's chosen model is written as that
provider's default in Paseo (`additionalModels`), so Paseo's own picker offers every model and starts on the role's.

The panel talks to the server only through the `seatworks.*` RPCs in `shared/rpc.ts`. Detaching a project forgets its
settings and keeps its ledger and logs. It is refused while a seat with desk tools still works in it, a lane is open or
waiting, a closed lane's copy is not back on its base, or a working copy is out.

## State on disk

```
~/.paseo/config.json                      providers sw2-<role>-<agent>, agent profiles
~/.local/share/seatworks-v3/
  roles.json                              optional; replaces the shipped preset
  ecosystem.json                          optional; replaces catalog/ecosystem.json
  refused.json  paseo.json                optional; each replaces the one in catalog/
  settings.json                           machine settings
  settings.json.bak-<time>                what Migrate repaired, as it was; can hold a pasted token
  kit.json                                which kit runs, and since when
  content.json                            the shipped prompts, skills and guides the Human has taken in
  own/                                    the Human's own copies, kept over the shipped ones
  models.json                             each agent's models as Paseo lists them
  outbox.json                             waiting letters, every project
  intents.json                            seats to archive when their turn ends; answers promised as mail
  desk.sock                               where seats' team servers reach the desk
  keys.json                               which seat each key belongs to; readable, it lets one call as another
  bin/                                    the git, gh and paseo first on each seat's PATH
  content/<name>-<hash>/                  copies of the guides and skills seats read; safe to delete; 14 days unused, gone
  guides -> content/guides-<hash>
  worktrees/<slug>/S<n>/                  copies of their own
  projects/<slug>/                        slug: repository folder name, lower case and dashed, "-", 6 hex of sha1(root)
    meta.json                             root and slug; detaching removes it with settings.json
    settings.json  settings.json.bak-<time>
    project.json                          base, gate and standing orders, as set_project writes them
    ledger.json  incidents.json           the record; the incident book
    events.log  attention.log  assessments.log  status.md
    <log>.<n>.log[.gz]                    older rolls of each log
    handbacks/  gates/  archive/          hand-backs whole; gate output; closed lanes filed away
    notebook.md  CONTEXT.md               the Supervisor's notebook; the concept as the Human settled it
    plans/  council/  ultra-review/  repo-refresh/  pre-mortem/  architecture-premise-audit/
<profileRoot>/sw2-<role>-<agent>-<slug>/  one seat directory per role, agent and project
```

`events.log` is the provenance record: one JSON line per tool call and per lane, task, merge, gate and slot event.
`attention.log` holds the desk's own notes, a Supervisor waiting on the Human among them, and `assessments.log` the
watch's questions and their answers. Each of the three `.log` files rolls at 8 MB, rolls older than the last are
gzipped, and each keeps up to 24 MB of rolls. `gates/` keeps each lane's or task's last five gate runs, each run's
rehearsal logs with it. Closed lanes past the newest 20 move to `archive/` once nothing open names them: one
`L<n>.json.gz` each, with the last 1 MB of each hand-back and of each log of each owner's last gate run, up to 64 MB,
oldest dropped first. Gone seats, answered asks and settled questions that belong to no lane go to `archive/desk.log`.

Every kind in `events.log` and its fields are one type, `DeskEvent` in `desk/store/events.ts`: a kind only gains fields, and a
field that changes meaning takes a kind of its own. The watch writes these kinds there:

| Group | Kinds |
|---|---|
| Watch | `watch.fact`, `watch.finding`, `watch.unbriefed`, `watch.unasked`, `watch.offline`, `watcher.seated` |
| Incidents | `incident.open`, `incident.held`, `incident.told`, `incident.read`, `incident.ack`, `incident.lookup-failed`, `incident.post-failed` |
| Pages | `page.sent`, `page.failed` |

`call.malformed` is written at a turn's end when a seat's own harness rejected a tool call whose input was not JSON, so
it never reached the desk; only Claude marks such calls.

## Evals

`npm run check` needs no key and launches no seat. This one calls a real model, so it sits outside it:

| Command | What it measures |
|---|---|
| `npm run eval:triggers -- --agent "claude -p"` | Which skills a real agent says it would open for each brief, from their descriptions alone |

## Known limits

- **Oh My Pi can't be steered through Paseo.** Mail to a running omp seat waits for its turn to end.
- **Pi, Oh My Pi and OpenCode have no sandbox.** Pi has no command rules either: a Pi seat is held by its tools and by
  what its `PATH` refuses (the desk's git commands, `gh` and `paseo`), but not by another agent's command, since its own
  agent starts through that same `PATH`. Oh My Pi and OpenCode have command denials, such as `git push`, `gh` and every
  agent the kit can start, but no path rules: a seat there can write the desk's records, and read the key file that
  tells the desk which seat calls.
- **A seat's key says which seat calls; it is not a secret.** Claude takes its MCP servers on its command line, where
  this user's other processes can read the key. Every seat but a Claude one can read `keys.json`, since Codex's sandbox
  holds back writes, not reads; on Linux a Claude seat's shell can too. The key keeps one seat from being taken for
  another by mistake or by a stray script, not against a seat set on it. A seat started before keys has none, and the
  desk carries out nothing from it until it is archived and started again.
- **A seat's `PATH` holds spelling, not a sandbox.** Its `git`, `gh` and `paseo` refuse however the command is written
  (`-C`, an alias, `env gh`), but a program called by its full path runs.
- **A repository's own omp hooks, extensions and tools run in an Oh My Pi seat.** No setting keeps `.omp/hooks`,
  `extensions` or `tools` out.
- **Reading an archived seat's history leaves its agent running.** Paseo resumes the agent to serve it and never closes
  it; `paseo logs` or the app's history view does this. The watch stops rather than read a seat once it is archived.
- **A Codex seat can call only the tools the kit can name.** Codex refuses any MCP call not approved ahead, so the
  desk's tools and proxied servers are approved at launch. Any other server, the shipped Context7 or one added, stays
  out of reach on Codex.
- **Codex command rules match argument prefixes**, so `git -C <path> push` gets past them; the seat's own `git` refuses
  it instead.
- **A Codex seat hides the Human's `~/.agents/skills` only as they were when it was built.** Codex has no key that hides
  a whole folder, so the seat gets one `[[skills.config]]` entry per `SKILL.md` it finds there, by path; by name would
  hide the seat's own skill of that name too. A skill added later shows in the seat until it is rebuilt. A repository's
  own `.agents/skills` stays visible: it belongs to the repository.
- **A steer Paseo can't hand over replaces the turn.** A Claude seat that is compacting refuses a steer the same way.
- **A turn running before a daemon restart or a plugin reload** is never steered, and is read as having started 30
  minutes ago.
- **A project-layer save** does not rewrite the Paseo providers.
- **The watch can't see a sub-agent's work.** It is not on the seat's timeline.
