# Seatworks starter

Seatworks gives each project five agent seats, each with its own prompt, skills, and settings,
coordinated through [Paseo](https://getpaseo.com):

- `supervisor` meets with you, relays settled decisions to the Lead, answers the attention
  events the watcher raises, and keeps the project's notebook of failures.
- `lead` breaks work down, delegates it to Peers, and accepts their results.
- `peer` writes code and returns evidence. An Architect or Scout is the same seat with `Owned
  scope none` in its brief.
- `reviewer` has its edit and write tools and the git commands that change the repository
  refused, so it takes every read-only lane: reviewing a change, a council seat, an ultra-review
  scout, an audit reader. Every review starts from [Open Code Review](https://github.com/alibaba/open-code-review) in delegation mode,
  which resolves the scope and the standing rules without calling a model of its own; the seat
  answers them against the code it read.
- `watcher` reads the Lead's and Peers' activity when the kit's Paseo plugin wakes it, and
  raises attention events that the plugin brings to the Supervisor.

A seat gets the prompt, skills and MCP servers `seats.json` names, the tool limits its harness's
role settings set, and nothing a repository can add: both harnesses read skills from several
directories by default, including the repository's own, so the kit pins those roots per harness and reports any drift.

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

There are two scopes, and only one of them grows. Your Paseo config holds five providers and five
agent profiles, one per role, and adding a project only composes one that is missing. Everything a
seat reads lives in that project, under `REPO/.seatworks/`.

Inside `.seatworks/`, the first three are the kit's and `--refresh` replaces them; `records/` is
the project's and nothing replaces it. That split is the whole rule for what is safe to edit
where: a change meant for every project goes to the kit, and a change meant for this one goes to
its `AGENTS.md` for code, or `guides/WORKSPACE_PROTOCOL.md` for how its seats coordinate.

The Paseo plugin joins the two. Every time a seat's session opens, `plugin/` walks up from the
agent's working directory to the nearest `.seatworks/`, reads the project's slug from
`project.json`, and points the harness's config-directory variable at that project's profile
directory; `harness/common/bin/seat-room`, the command every provider launches, then forces the
manifest's flags and execs the coding agent. So a seat belongs to the workspace it starts in, and
a `lead` started where no `.seatworks/` is found is refused.

```
seats.json                      which harness hosts each role, its skills, its Paseo tools,
                                its model, and the MCP servers every seat gets
harness/<id>/harness.json       one harness: its config-directory variable, prompt file,
                                skills directory, settings format, and how a skill is loaded
                                and recognised there
harness/<id>/NOTES.md           that harness's behavior, and how each fact was established
harness/common/bin/seat-room    the room, launched by every provider
~/.paseo/config.json            five providers and five agent profiles, one per role, composed
                                from the two files above
<profileRoot>/<role>-<slug>/    one profile directory per role per project, named by each
                                harness manifest: the role's settings, and links
                                into that project's `.seatworks/`
REPO/.seatworks/project.json    this project's slug, and any model it pins per role
REPO/.seatworks/prompts/        one prompt per seat: SUPERVISOR, LEAD, PEER, REVIEWER, WATCHER
REPO/.seatworks/guides/         what a seat reads when it needs a shape: WORKSPACE_PROTOCOL,
                                DIRECTIVE, FEATURE_INTAKE, PLANS, BRIEF
REPO/.seatworks/skills/         supervisor/, lead/, peer/, reviewer/
REPO/.seatworks/records/        what the seats write: NOTEBOOK.md, attention/, lessons/, drafts/
```

`project.json` carries the slug, which keeps one project's profile directories apart from
another's, and may pin a model per role under `models`: the room rewrites the model argument
Paseo passes for that role, so one project can run its Lead on a larger model without touching
the global profile. A role the file doesn't name keeps its profile's model.

`setup/add-project.fish` copies the kit's `project/` templates into a repository and writes its
`project.json`; after that, the project's copies are its own until a `--refresh`.
`setup/setup-seats.fish` composes the providers and profiles and builds every profile
directory, so an edit to `REPO/.seatworks/prompts/LEAD.md` takes effect for the next Lead you start
there.

Twelve skills, and none of them is a step in the ordinary loop. What a Lead or Supervisor does
every session lives in its prompt, where nothing can skip it; a skill is for the situation that
doesn't come up every time. Four belong to the Lead and every one waits for you to ask by name
(`council`, `ultra-review`, `review-pack`, `repo-refresh`); four belong to the Peer and are
named in its brief (`test-first`, `diagnosing-bugs`, `security-check`,
`test-proof-debt-audit`); the Reviewer has `reviewing-a-change`; and the Supervisor has three that each end in something
you read (`pre-mortem` before a hard-to-reverse directive, `retrospective` to turn the logs into
one proposed change, `architecture-premise-audit` to ask whether the project is the right kind of
system at all). The Supervisor alone keeps its harness's auto memory, in its own
profile directory, as that project's organizational memory.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination. The Lead owns its workspace's
topology, integration, and acceptance. A Peer owns engineering judgment inside its scope.

Each layer sees only what it needs. Peers don't know about Paseo, and the Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Changing which agent runs a role

Edit that role's `harness` in `seats.json`, then rerun setup. The provider keeps its name, and
the prompts and skills are untouched.

One edit means one edit: setup moves the profile directory, sets and clears the harness's own
environment variables, tells the room which binary to exec and which config-directory variable
to set, and links or merges that harness's settings into the seat. Flipping the watcher to
another harness and back leaves the provider byte-identical.

The tool limits are the part that does not travel by itself, because each one is a native setting
of the coding agent: `permissions.deny` and `sandbox` in one harness's role settings, per-tool
`enabled` keys, `tools.approval` and `bash.patterns` in the other's. Paseo's own
`disallowedTools` never reaches every harness, so each keeps its own list. Before a move, give the
role its settings under the new harness's directory, in the keys its `NOTES.md` records as
verified.

A harness manifest carries `verified`, the version its facts were checked on. `--check` says so
when your installed version differs, and `--probe` settles it by asking each seat's harness which
skills it actually loads. A manifest with `verified: null` is a sketch: its `NOTES.md` lists what
is still open.

### A model from another provider

A harness runs whichever models it can reach, and `provider.defaultModel` in
`harness/<id>/harness.json` names the one a role gets when `seats.json` names none. A role that
wants its own says so in `seats.json` under `models`, and a single project overrides it in
`.seatworks/project.json`, which the room applies to the launch.

**The API key is never written anywhere**: `provider.baseCredential` in the manifest names the
environment variable the harness reads it from, you set that variable on the harness's base
provider in the Paseo config, and every seat inherits it through `extends`. Setup fails if a
literal token appears under a harness directory.

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
- Hard decisions go to sealed lanes when you ask for one: two or three read-only seats answer the
  same open question without seeing the Lead's view or each other's, and the Lead rules on them.
  The Lead cannot open that lane itself, because it costs several seats and rounds of waiting.
- When you're away, the Supervisor keeps attending and gives you a short report when you're
  back, and proposes a rule change only for a pattern the notebook has seen twice.

## Skills the seat has to load

A seat's harness offers a skill's name and description and leaves the loading to the model, which
often doesn't. Measured here: a byte-exact replica of a Peer seat sends all eight of its skills
in its own system prompt, under an instruction to read the matching one first, and not one
session on this machine ever did. The Lead skipped the skills its prompt named in two
evaluation runs.

The kit answers that in two ways, neither of which is a new mechanism. What a seat does every
session is in its prompt rather than in a skill, so there is nothing to skip; and what a Peer
does sometimes is named in the brief's `Skills` field by the Lead, because a Peer left to route
itself routes to none.

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
Keep one project's rules for code in its `AGENTS.md` and its coordination decisions in its
filled-in `.seatworks/guides/WORKSPACE_PROTOCOL.md`, which it never touches:

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
| [seats.json](seats.json) | Every seat: role, harness, prompt, skills, Paseo tools and model; plus the MCP servers every seat gets |
| [harness/](harness/) | One directory per harness: its manifest, the role settings that hold each seat's tool limits, and `NOTES.md`, which records what was verified and what is still open |
| [harness/common/bin/seat-room](harness/common/bin/seat-room) | The room: refuses a seat the Paseo plugin didn't open, forces the manifest's `forceFlags`, execs the agent |
| [plugin/](plugin/) | The Paseo plugin: gives every new seat its profile's model and mode and its project's seat directory, archives a seat its parent may not start or that runs outside the parent's project, sends the watcher `SWEEP` after activity, and logs and delivers attention events — the watcher's blocks plus `DECISION:`/`DETOUR:`/`HANDOFF` lines, unanswered pushback and failed turns — to the Supervisor |
| [project/](project/) | Templates copied into each project's `.seatworks/`: the seat prompts, the notebook, the skills |
| [project/WATCHER.md](project/WATCHER.md) | Watcher prompt with the trigger table, read by the watcher on every sweep |
| [project/skills/](project/skills/) | Each role's skill set, at its own altitude |
| [setup/add-project.fish](setup/add-project.fish) | Gives one repository its `.seatworks/` and its `project.json`, then builds its profiles |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Composes the five providers and profiles and builds every project's profile directories; idempotent, `--check` only verifies, `--probe` asks each harness |
| [examples/paseo-providers.json](examples/paseo-providers.json) | The base provider per harness, added once per machine |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a project's coordination protocol, read only by the Lead |

The role settings each manifest names under `settings.source` are tracked in git and edited by
hand; the script links or merges a seat's file and only checks it, never writes it. Their
`"language": "vietnamese"` is the kit owner's setting: change or remove it for your own. The Lead
and the watcher keep a 1-hour prompt cache, since the watcher sweeps every 15 minutes.
