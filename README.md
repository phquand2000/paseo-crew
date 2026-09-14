# Seatworks starter

Seatworks gives each project five agent seats on [Paseo](https://getpaseo.com), each with its own
prompt, skills and settings:

- `supervisor` works with you, decides everything short of the project's concept, relays directives
  to the Lead, answers attention events, and keeps the project's notebook of failures.
- `lead` breaks work down, briefs Peers, and accepts their results.
- `peer` writes code and returns evidence. An Architect or Scout is a Peer with `Owned scope none`.
- `reviewer` takes every read-only lane: change reviews, council seats, ultra-review scouts, audit
  readers. A review starts from [Open Code Review](https://github.com/alibaba/open-code-review) in
  delegation mode, which resolves scope and rules without calling a model.
- `watcher` sweeps Lead and Peer activity when the kit's Paseo plugin wakes it, and raises
  attention events for the Supervisor.

A seat is named for its role alone. Which coding agent hosts a role is one line in
[seats.json](seats.json), so no prompt, skill or doc names a vendor. Everything a seat reads lives
in the project under `.seatworks/`, in that project's git history.

## Get started

You need fish 3.5 or later, jq, a running Paseo 0.8 daemon, and the coding agents `seats.json`
names, logged in and at or above the `verified` version in `harness/<id>/harness.json`. Open a
coding agent in this directory and say:

> Read SETUP.md and set up the seats exactly as it describes for the project REPO_DIR.

## How it works

Your Paseo config holds five providers and five agent profiles, one per role, shared by every
project. When a seat's session opens, the plugin in `plugin/` finds the nearest `.seatworks/` above
the working directory, reads the project's slug, and points the harness at that project's profile
directory. `harness/common/bin/seat-room`, the command every provider runs, forces the manifest's
flags and execs the coding agent. A seat started outside a project is refused.

```
seats.json                      each role's harness, skills, Paseo tools and model; the MCP servers
harness/<id>/harness.json       one harness: config directory, prompt file, skills directory, settings
harness/<id>/NOTES.md           that harness's verified behavior
~/.paseo/config.json            five providers and five profiles, composed from the two above
<profileRoot>/<role>-<slug>/    one profile directory per role per project
REPO/.seatworks/project.json    slug, models pinned per role, attention settings
REPO/.seatworks/prompts/        SUPERVISOR, LEAD, PEER, REVIEWER, WATCHER
REPO/.seatworks/guides/         shapes a seat reads when it needs one: WORKSPACE_PROTOCOL, BRIEF, PLANS…
REPO/.seatworks/skills/         supervisor/, lead/, peer/
REPO/.seatworks/records/        what the seats write: NOTEBOOK.md, attention/, lessons/, drafts/
```

`prompts/`, `guides/` and `skills/` are the kit's, and `add-project.fish --refresh` replaces them;
`project.json` and `records/` are the project's. A change meant for every project goes to the kit.
For one project, code rules go in its `AGENTS.md` and coordination decisions in
`guides/WORKSPACE_PROTOCOL.md`. `project.json` can pin a model per role under `models` and tune
`attention` (`sweepMinutes`, `pushbackMinutes`, `escalateAfter`); the plugin reads it on every use.

**Authority** is split by concern. You own the concept: what the project does and how it behaves.
The Supervisor decides the rest on your behalf. The Lead owns its workspace's topology, integration
and acceptance; a Peer owns engineering judgment inside its scope. Each layer sees only what it
needs: a Peer doesn't know about Paseo, and a Lead doesn't know who sends its owner directives. The
hiding lives in the prompts, not the filesystem.

**Skills** cover situations that don't come up every session; what a seat does every time is in its
prompt, where nothing can skip it. Seats often don't open a skill on their own, so the Lead names a
Peer's skills in the brief.

| Role | Skills |
|---|---|
| Lead | `council`, `ultra-review`, `repo-refresh` |
| Peer | `test-first`, `diagnosing-bugs`, `security-check`, `test-proof-debt-audit` (the Reviewer borrows the last three) |
| Supervisor | `pre-mortem`, `retrospective`, `architecture-premise-audit` |

## Attention, not polling

An agent writing fluently rarely stops to check what it most likely got wrong, such as a test that
calls an API nobody decided on. Asked the right question at that moment, it usually sees the
problem itself. The kit is built around that question:

- The plugin wakes the watcher after Lead and Peer activity, and the watcher raises `ATTENTION:`
  for its triggers: a major decision, a struggle, a change of direction, a trade-off nobody
  approved, a minted API. The plugin itself raises `DECISION:`, `DETOUR:` and `HANDOFF` lines,
  unanswered pushback, and failed turns.
- The Supervisor logs most events. For the rest it sends a neutral `CHECK:` through the Lead,
  because asking an agent to look again at a named source catches more than telling it it's wrong.
- A hard, expensive decision goes to a `council`: sealed read-only seats answer the same open
  question, and the Lead rules.
- A question goes one level up: an agent ends its turn with it and the agent that started it
  answers. Only the Supervisor opens a question prompt for you, and only about how the project
  behaves.
- The Supervisor proposes a rule change only for a pattern the notebook has seen twice.

## Changing which agent runs a role

Edit the role's `harness` in `seats.json` and rerun setup; prompts and skills stay as they are.
Tool limits don't travel, because each is a native setting of one coding agent: first give the
role its settings under the new harness's directory, in keys its `NOTES.md` records as verified.
`--check` reports a harness whose installed version differs from `verified`, and `--probe` asks it
which skills it really loads.

A role's models are listed under `models` in `seats.json`, or pinned for one project in
`project.json`. An API key is never written into the kit: the manifest's
`provider.baseCredential` names the variable, you set it on the base provider in the Paseo config,
and every seat inherits it.

## Daily use

Talk to the Supervisor: start an agent on `supervisor` in the project, settle the outcome with it,
and let it create the Lead. Talk to a Lead directly only for a small, well-defined task, and give a
Peer only assigned work.

| When | Run |
|---|---|
| After editing a prompt or settings | `fish setup/setup-seats.fish` |
| To verify without writing, or for one project | `fish setup/setup-seats.fish --check`, `--project REPO_DIR` |
| To make each harness prove which skills it loads | `fish setup/setup-seats.fish --check --probe` |
| After the kit's templates change | `fish setup/add-project.fish REPO_DIR --refresh` |
| After a plugin change | `paseo plugin reload seatworks` |

`--refresh` keeps the replaced copies under `.seatworks/records/drafts/`, and never touches
`records/`, `project.json`, or a filled-in `WORKSPACE_PROTOCOL.md`. The real work is replacing the
demo rules with your own, the last step in SETUP.md.

## Contents

| Path | Purpose |
|---|---|
| [SETUP.md](SETUP.md) | Setup procedure, written for an agent to execute |
| [REFERENCE.md](REFERENCE.md) | Paseo and kit behavior the config doesn't show |
| [WRITING_GUIDE.md](WRITING_GUIDE.md) | Rules for writing the prompts, skills and docs |
| [NOTICE.md](NOTICE.md) | Where the skills come from, with licenses |
| [seats.json](seats.json) | Every seat, plus the MCP servers every seat gets |
| [harness/](harness/) | One directory per harness: manifest, role settings holding each seat's tool limits, `NOTES.md` |
| [plugin/](plugin/) | The Paseo plugin: profiles and project directories at launch, launch refusals, watcher sweeps, attention delivery |
| [project/](project/) | Templates copied into each project's `.seatworks/` |
| [setup/](setup/) | `add-project.fish` sets up one repository; `setup-seats.fish` composes providers and profiles, idempotent |
| [examples/](examples/) | The base provider per harness, the `AGENTS.md` snippet, the workspace protocol template |

The role settings under `harness/` are tracked and edited by hand; setup links or merges them and
never writes them. Their `"language": "vietnamese"` is the kit owner's: change it for your own.
