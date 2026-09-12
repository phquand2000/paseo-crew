# Seatworks starter

Seatworks gives each project six agent seats, each with its own prompt, skills, and settings,
coordinated through [Paseo](https://getpaseo.com):

- `supervisor` meets with you, relays settled decisions to the Lead, answers the attention
  events the watcher raises, and keeps the project's notebook of failures.
- `lead` breaks work down, delegates it to Peers, and accepts their results.
- `peer` writes code and returns evidence; `peer-ro` runs the same prompt and skills
  with edits blocked, for Architect, Scout, and council work.
- `reviewer` reviews changes read-only: it runs
  [Open Code Review](https://github.com/alibaba/open-code-review) as a first pass and confirms
  every finding in the code before reporting it.
- `watcher` reads the Lead's and Peers' activity on a heartbeat and raises attention events
  for the Supervisor.

A seat is named for its role alone: not for the tool that runs it, and not for a project. Which
coding agent hosts a role is one line in [seats.json](seats.json), so the prompts, skills, and
docs never name a vendor. Every `.md` a seat loads lives in the project, under `.seatworks/`, so
each project carries its own rules under its own git history.

## Get started

You need fish 3.5 or later, jq, a running Paseo daemon, and the coding agents `seats.json`
assigns to the roles, each logged in to a model provider and at or above the version its
`harness/<id>/harness.json` records under `verified`.

Open a coding agent in this directory and say:

> Read SETUP.md and set up the seats exactly as it describes for the project REPO_DIR.

The agent asks you for an OAuth token and the Peer model, and does the rest. The full procedure
is in [SETUP.md](SETUP.md).

## How it works

There are two scopes, and only one of them grows. Your Paseo config holds six providers and six
agent profiles, one per role, and adding a project only composes one that is missing. Everything a seat reads
lives in that project, under `REPO/.seatworks/`.

The room joins the two. `harness/common/bin/seat-room` is the command every provider launches:
it walks up from the agent's working directory to the nearest `.seatworks/`, reads the project's
slug from `project.json`, points the harness's config-directory variable at that project's
profile directory, and execs the coding agent with every argument untouched. So a seat belongs
to the workspace it starts in, and a `lead` started where no `.seatworks/` is found is just the
plain coding agent.

```
seats.json                      which harness hosts each role, its skills, its guards, its
                                deny list, its model, and the skill gates it must pass
harness/<id>/harness.json       one harness: its config-directory variable, prompt file,
                                skills directory, settings format, guards, and how a skill is
                                loaded and recognised there
harness/<id>/NOTES.md           that harness's behavior, and how each fact was established
harness/common/bin/seat-room    the room, launched by every provider
~/.paseo/config.json            six providers and six agent profiles, one per role, composed
                                from the two files above
<profileRoot>/<role>-<slug>/    one profile directory per role per project, named by each
                                harness manifest: the role's settings and guards, and links
                                into that project's `.seatworks/`
REPO/.seatworks/                project.json, SUPERVISOR.md, LEAD.md, PEER.md, REVIEWER.md,
                                WATCHER.md, WORKSPACE_PROTOCOL.md, NOTEBOOK.md, records/,
                                skills/{supervisor,lead,peer,reviewer}/
maintenance/                    kit tools no seat loads: seat-safety-review audits the kit's
                                seats, not a project
```

`project.json` carries the slug, which keeps one project's profile directories apart from
another's, and may pin a model per role under `models`: the room rewrites the model argument
Paseo passes for that role, so one project can run its Lead on a larger model without touching
the global profile. A role the file doesn't name keeps its profile's model.

`setup/add-project.fish` copies the kit's `project/` templates into a repository and writes its
`project.json`; after that, the project's copies are its own until a `--refresh`.
`setup/setup-seats.fish` composes the providers and profiles and builds every profile
directory, so an edit to `REPO/.seatworks/LEAD.md` takes effect for the next Lead you start
there.

Each role has its own skill set: strategy for the Supervisor (interviews, pre-mortems,
retrospectives, patches), macro for the Lead (intake, decomposition, council, review
orchestration, rollout), micro for the Peer (test-first work, debugging, proof audits), and
review for the Reviewer (Open Code Review, change review). The Supervisor
alone keeps its harness's auto memory, in its own profile directory, as that project's
organizational memory.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination. The Lead owns its workspace's
topology, integration, and acceptance. A Peer owns engineering judgment inside its scope.

Each layer sees only what it needs. Peers don't know about Paseo, and the Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Changing which agent runs a role

Edit that role's `harness` in `seats.json`, then rerun setup. The provider keeps its name, the
prompts and skills are untouched, and the guards follow: `harness/common/hook-io.sh` writes
whichever refusal form the new harness expects, so one guard body serves all of them.

One edit means one edit: setup moves the profile directory, sets and clears the harness's own
environment variables, tells the room which binary to exec and which config-directory variable
to set, and switches the guards' refusal form. Flipping the watcher to another harness and back
leaves the provider byte-identical.

A harness manifest carries `verified`, the version its facts were checked on. `--check` says so
when your installed version differs, and `--probe` settles it by asking each seat's harness which
skills it actually loads. A manifest with `verified: null` is a sketch: its `NOTES.md` lists what
is still open, and setup refuses to send a gated role to a harness that cannot enforce its gates.

### A model the harness doesn't ship with

A harness can run a model from another provider, and every part of that is data in
`harness/<id>/harness.json` under `provider.env`: the provider name, its base URL, the wire
protocol, and the model. One edit changes them. Where a manifest names `settings.materialize`,
the room runs that harness's materializer first, which builds the seat's config from your shared
one, the kit's provider block, and the role's overlay, plus a model catalog with every
native-subagent version nulled, so the seat starts no subagents outside Paseo.

**The API key is never written anywhere**: the harness's own config names the environment
variable it reads the key from, and you export that variable where the Paseo daemon can see it.
Setup fails if a literal token appears under a harness's `config/`.

## Attention, not polling

An agent writing fluently rarely stops to check what it is most likely to get wrong, such as a
test that invents an API nobody decided, or a trade-off made just to hit a number. Asked the
right question at that moment, it usually sees the problem itself. The kit is built around
that question:

- The Supervisor keeps a watcher running while a Lead works, and checks it before every
  directive. The watcher is a small-model seat with a short prompt of its own; it reads the
  Lead's and Peers' activity every 15 minutes and sends the Supervisor an `ATTENTION:` event
  when it sees a trigger, such as a major decision, a struggle, a change of direction, a
  trade-off nobody approved, or a minted API.
- The Supervisor logs most events. For the rest it sends a neutral `CHECK:` question through
  the Lead ("which of the names your new tests call existed before this task?"), because asking
  an agent to look again at a named source catches more than telling it that it is wrong.
- Hard decisions go to sealed lanes: two or three Peers answer the same open question without
  seeing the Lead's view or each other's, and the Lead rules on them.
- When you're away, the Supervisor keeps attending and gives you a short report when you're
  back. Once a week it proposes rule changes from what the log recorded.

## Skills the seat has to load

A seat's harness offers it a skill's name and description and leaves the loading to the model,
which does not always do it. Two evaluation runs recorded a Lead skipping `review-orchestration`
and `integration` though its prompt said to load them, and the Reviewer brief that followed was
missing the fields the Lead needed to rule.

So three of the Lead's skills are gated rather than advised. `seats.json` lists them under
`skillGates`: `intake` before creating a Peer, `review-orchestration` before briefing a Reviewer,
`integration` before a merge. The guard reads the session's own transcript, and a call made
without its skill is refused with the skill's name and the reason. Loading the skill first costs
one tool call and the gate is invisible.

Gates are declared per role, not per harness, and both the hook guard and the guard extension
read the same list, so a gated role keeps its gates wherever it runs. No Peer skill is gated: no
evaluation run recorded a Peer skipping one, and the kit adds a rule only after an observed
failure.

## Daily use

Talk to the Supervisor rather than to the Lead. In the Paseo app, open the project and start
an agent on `supervisor`, settle the outcome with it, and have it create a Lead and relay
the decision. For a small, well-defined task, you can talk to a Lead directly. A Peer has
no context for questions, so give it only assigned work. When you step away, tell the
Supervisor; it holds everything but irreversible risks for the report you get when you return.

After you edit a prompt or the settings, rebuild the profiles of every project:

```fish
fish setup/setup-seats.fish
```

To verify without writing anything, or to work on one project only:

```fish
fish setup/setup-seats.fish --check
fish setup/setup-seats.fish --project REPO_DIR
```

To make each seat's harness prove which skills it loads, which costs one cheap model call per
seat that needs one:

```fish
fish setup/setup-seats.fish --check --probe
```

When the kit's templates change, carry them into a project that already has its files. This
replaces the project's seat prompts and skills, and its workspace protocol while that is still
the unfilled template, keeping the old copies under the git-ignored `.seatworks/records/drafts/`.
Keep one project's own rules in its `AGENTS.md` or its filled-in
`.seatworks/WORKSPACE_PROTOCOL.md`, which it never touches:

```fish
fish setup/add-project.fish REPO_DIR --refresh
```

The real work is replacing the demo rules with your own, the last step in SETUP.md. The rules
grow each time the system misses a failure: the Supervisor records each miss in the project's
notebook, and a miss becomes a rule only when it recurs.

## Contents

| Path | Purpose |
|---|---|
| [SETUP.md](SETUP.md) | Setup procedure, written for an agent to execute |
| [REFERENCE.md](REFERENCE.md) | Paseo and kit behavior that you can't infer from the config |
| [WRITING_GUIDE.md](WRITING_GUIDE.md) | Rules for writing and editing the prompts and docs in this kit |
| [NOTICE.md](NOTICE.md) | Where the skills' ideas come from, with licenses |
| [seats.json](seats.json) | Every seat: role, harness, prompt, skills, guards, deny intents, model, and the skill gates it must pass |
| [harness/](harness/) | One directory per harness: its manifest, role settings, guards or guard extensions, the custom-model data, and `NOTES.md`, which records what was verified and what is still open |
| [harness/common/bin/seat-room](harness/common/bin/seat-room) | The room: resolves the project from the working directory, points the config-directory variable at its profile, applies a model pin, execs the agent |
| [harness/common/hook-io.sh](harness/common/hook-io.sh) | Reads a guard's hook input and writes its refusal in the form the seat's harness expects |
| [harness/common/guards/lead-guard.sh](harness/common/guards/lead-guard.sh) | Blocks writes to repository files outside what the role owns, so Peers write all code |
| [harness/common/guards/profile-guard.sh](harness/common/guards/profile-guard.sh) | Blocks creating, prompting, scheduling, or switching an agent onto a model, mode, or workspace other than its own |
| [harness/common/guards/skill-guard.sh](harness/common/guards/skill-guard.sh) | Refuses a gated call until its skill is loaded in this session |
| [harness/common/guards/watcher-guard.sh](harness/common/guards/watcher-guard.sh) | Lets the watcher's `send_agent_prompt` reach only its own project's Supervisor |
| [project/](project/) | Templates copied into each project's `.seatworks/`: the seat prompts, the notebook, the skills |
| [project/WATCHER.md](project/WATCHER.md) | Watcher prompt with the trigger table, read by the watcher on every sweep |
| [project/skills/](project/skills/) | Each role's skill set, at its own altitude |
| [setup/add-project.fish](setup/add-project.fish) | Gives one repository its `.seatworks/` and its `project.json`, then builds its profiles |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Composes the six providers and profiles and builds every project's profile directories; idempotent, `--check` only verifies, `--probe` asks each harness |
| [examples/paseo-providers.json](examples/paseo-providers.json) | The base provider per harness, added once per machine |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a project's coordination protocol, read only by the Lead |

The role settings each manifest names under `settings.source` are tracked in git and edited by
hand; the script links or merges a seat's file and only checks it, never writes it. Their
`"language": "vietnamese"` is the kit owner's setting: change or remove it for your own. The Lead
and the watcher keep a 1-hour prompt cache, since the watcher sweeps every 15 minutes, and each
hook runs its guard through the seat's own profile, so no file holds a path specific to one
machine.
