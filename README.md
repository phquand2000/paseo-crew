# Seatworks starter

Seatworks gives each project six agent seats, each with its own prompt, skills, and settings,
coordinated through [Paseo](https://getpaseo.com):

- `supervisor-SLUG` meets with you, relays settled decisions to the Lead, answers the attention
  events the watcher raises, and keeps the project's notebook of failures.
- `lead-SLUG` breaks work down, delegates it to Peers, and accepts their results.
- `peer-SLUG` writes code and returns evidence; `peer-ro-SLUG` runs the same prompt and skills
  with edits blocked, for Architect, Scout, and council work.
- `reviewer-SLUG` reviews changes read-only: it runs
  [Open Code Review](https://github.com/alibaba/open-code-review) as a first pass and confirms
  every finding in the code before reporting it.
- `watcher-SLUG` reads the Lead's and Peers' activity on a heartbeat and raises attention events
  for the Supervisor.

A seat is named for its role, not for the tool that runs it. Which coding agent hosts a role is
one line in [seats.json](seats.json), so the prompts, skills, and docs never name a vendor.
Profiles, settings, and models are global. Every `.md` a seat loads lives in the project, under
`.seatworks/`, so each project carries its own rules under its own git history.

## Get started

You need fish 3.5 or later, jq, a running Paseo daemon, and the coding agents the roles in
`seats.json` are assigned to. As shipped that means the `claude` CLI for the Supervisor, Lead,
and watcher, and Pi 0.84.4 or later, logged in to a model provider, for the Peers and Reviewer.

Open a coding agent in this directory and say:

> Read SETUP.md and set up the seats exactly as it describes for the project REPO_DIR.

The agent asks you for an OAuth token and the Peer model, and does the rest. The full procedure
is in [SETUP.md](SETUP.md).

## How it works

Each seat is a Paseo provider pointed at its own profile directory, through whichever
environment variable its harness uses for that. The profiles hold links to the kit's settings
and guards and into the project's `.seatworks/`, so an edit to `REPO/.seatworks/LEAD.md` takes
effect for the next Lead you spawn there.

```
seats.json                         which harness hosts each role, its skills, its guards, its
                                   deny list, its model, and the skill gates it must pass
harness/<id>/harness.json          one harness: its config-directory variable, prompt file,
                                   skills directory, settings format, guards, and how a skill
                                   is loaded and recognised there
harness/<id>/NOTES.md              that harness's behavior, and how each fact was established
~/.paseo/config.json               the six SLUG providers, composed from those two files
~/.claude/profiles/<seat>/         links: settings.json, guard scripts, CLAUDE.md, skills/
~/.pi/profiles/<seat>/             guard and login links; APPEND_SYSTEM.md and skills/ are links
REPO/.seatworks/                   SUPERVISOR.md, LEAD.md, PEER.md, REVIEWER.md, WATCHER.md,
                                   WORKSPACE_PROTOCOL.md, NOTEBOOK.md, records/,
                                   skills/{supervisor,lead,peer,reviewer}/
```

`setup/add-project.fish` copies the kit's `project/` templates into a repository and composes its
providers; after that, the project's copies are its own until a `--refresh`.

Each role has its own skill set: strategy skills for the Supervisor (interviews, pre-mortems,
retrospectives, protocol patches), macro skills for the Lead (intake, decomposition, council,
review orchestration, rollout), micro skills for the Peer (test-first work, debugging, proof
audits), and review skills for the Reviewer (Open Code Review, change review). The Supervisor
alone keeps its harness's auto memory, as the project's organizational memory.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination. The Lead owns its workspace's
topology, integration, and acceptance. A Peer owns engineering judgment inside its scope.

Each layer sees only what it needs. Peers don't know about Paseo, and the Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Changing which agent runs a role

Edit that role's `harness` in `seats.json`, then rerun setup for each project. The provider keeps
its name, the prompts and skills are untouched, and the guards follow: `harness/common/hook-io.sh`
writes whichever refusal form the new harness expects, so one guard body serves all of them.

One edit means one edit: setup moves the profile directory, sets and clears the harness's own
environment variables and its config-directory variable, installs or removes a launcher command,
and switches the guards' refusal form. Flipping the watcher to Codex and back leaves the provider
byte-identical.

A harness manifest carries `verified`, the version its facts were checked on. `--check` says so
when your installed version differs, and `--probe` settles it by asking each seat's harness which
skills it actually loads. A manifest with `verified: null` is a sketch: `harness/codex/NOTES.md`
lists what is still open for Codex, and setup refuses to send a gated role to a harness that
cannot enforce its gates.

### A non-OpenAI model on Codex

A Codex seat gets its own `CODEX_HOME`, built by `harness/codex/bin/materialize-room`: a
`config.toml` merged from your shared one, the kit's provider block, and the role's overlay, plus
a model catalog with every `multi_agent_version` nulled so the seat cannot start Codex-native
subagents. `harness/codex/bin/codex-room` is the provider's command; it re-materializes the room
and `exec`s Codex, so a launch never disagrees with a build.

The model and provider are data in `harness/codex/harness.json` under `provider.env`, so one edit
changes them. **The API key is never written anywhere**: Codex's `env_key` names an environment
variable it reads the key from, so the kit writes `env_key = "ZAI_API_KEY"` and you export the
key where the Paseo daemon can see it. Setup fails if a literal token appears under
`harness/codex/config/`. There is no room for Claude Code or Pi, and there should not be: both
already relocate their whole config directory and merge settings natively, and Claude Code
reloads settings files mid-session — a launcher would reimplement that and lose the reload.

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
an agent on `supervisor-SLUG`, settle the outcome with it, and have it create a Lead and relay
the decision. For a small, well-defined task, you can talk to a Lead directly. A Peer has
no context for questions, so give it only assigned work. When you step away, tell the
Supervisor; it holds everything but irreversible risks for the report you get when you return.

After you edit a prompt or the settings, rebuild the profiles:

```fish
fish setup/setup-seats.fish
```

To verify without writing anything:

```fish
fish setup/setup-seats.fish --check
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

If you are coming from a kit whose providers were named `claude-lead-SLUG` and `pi-peer-SLUG`,
archive every running agent and rename them in place:

```fish
fish setup/migrate-seat-names.fish
```

It prints what it would change and does nothing until you add `--apply`.

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
| [harness/claude/](harness/claude/) | Claude Code as a harness: manifest, role settings, guards, and [NOTES.md](harness/claude/NOTES.md) |
| [harness/pi/](harness/pi/) | Pi as a harness: manifest, settings, guard extensions, and [NOTES.md](harness/pi/NOTES.md) |
| [harness/codex/](harness/codex/) | Codex as a harness, unverified: manifest, the room, the custom-model data, and the open questions in [NOTES.md](harness/codex/NOTES.md) |
| [harness/codex/bin/materialize-room](harness/codex/bin/materialize-room) | Builds one Codex seat's `CODEX_HOME`: merged `config.toml`, model catalog, links |
| [harness/codex/bin/codex-room](harness/codex/bin/codex-room) | The Codex seat's launcher: re-materializes the room, then execs Codex |
| [harness/codex/models.json](harness/codex/models.json) | The custom model's catalog entry, with the provider's model filled in at build time |
| [harness/codex/config/](harness/codex/config/) | `base.config.toml` (provider block) and one `<role>.config.toml` overlay per role |
| [harness/common/hook-io.sh](harness/common/hook-io.sh) | Reads a guard's hook input and writes its refusal in the form the seat's harness expects |
| [project/](project/) | Templates copied into each project's `.seatworks/` |
| [project/SUPERVISOR.md](project/SUPERVISOR.md) | Supervisor prompt (demo) |
| [project/LEAD.md](project/LEAD.md) | Lead prompt (demo) |
| [project/PEER.md](project/PEER.md) | Peer prompt (demo) |
| [project/REVIEWER.md](project/REVIEWER.md) | Reviewer prompt (demo) |
| [project/WATCHER.md](project/WATCHER.md) | Watcher prompt with the trigger table, read by the watcher on every sweep |
| [project/skills/](project/skills/) | Strategy skills for the Supervisor, macro skills for the Lead, micro skills for the Peer, review skills for the Reviewer |
| [project/NOTEBOOK.md](project/NOTEBOOK.md) | A project's append-only record of failures |
| [harness/pi/extensions/peer-guard.ts](harness/pi/extensions/peer-guard.ts) | Blocks `git push` and agent CLIs for every Pi seat, and file edits for the read-only seats |
| [harness/pi/extensions/skill-gate.ts](harness/pi/extensions/skill-gate.ts) | Enforces `seats.json`'s skill gates on a Pi seat; installed only for a role that has one |
| [harness/common/guards/lead-guard.sh](harness/common/guards/lead-guard.sh) | Blocks writes to repository files outside what the role owns, so Peers write all code |
| [harness/common/guards/profile-guard.sh](harness/common/guards/profile-guard.sh) | Blocks creating, prompting, scheduling, or switching an agent onto a model or mode other than its profile's |
| [harness/common/guards/skill-guard.sh](harness/common/guards/skill-guard.sh) | Refuses a gated call until its skill is loaded in this session |
| [harness/common/guards/watcher-guard.sh](harness/common/guards/watcher-guard.sh) | Lets the watcher's `send_agent_prompt` reach only the Supervisor |
| [setup/add-project.fish](setup/add-project.fish) | Gives one repository its `.seatworks/`, its six providers, and their profiles |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Builds or refreshes every seat profile; idempotent, `--check` only verifies, `--probe` asks each harness |
| [setup/migrate-seat-names.fish](setup/migrate-seat-names.fish) | Renames `<harness>-<role>-<slug>` providers and profiles to `<role>-<slug>`; dry run by default |
| [examples/paseo-providers.json](examples/paseo-providers.json) | The base provider per harness, added once per machine |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a project's coordination protocol, read only by the Lead |

The role settings in `harness/claude/settings/<role>.settings.json` are tracked in git and edited
by hand; the script links every seat to its role's file and only checks it, never writes it. Their
`"language": "vietnamese"` is the kit owner's setting: change or remove it for your own. The
Lead and the watcher keep a 1-hour prompt cache, since the watcher sweeps every 15 minutes.
Each hook runs its guard through the seat's own profile, so the files hold no path specific to
one machine.
