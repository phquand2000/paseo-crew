# Seatworks starter

Seatworks gives each project three agent seats, each with its own prompt and settings,
coordinated through [Paseo](https://getpaseo.com):

- `claude-supervisor-SLUG` ([Claude Code](https://code.claude.com)) meets with you, relays
  settled decisions to the Lead, watches how work is coordinated, and keeps the project's
  notebook of failures.
- `claude-lead-SLUG` (Claude Code) breaks work down, delegates it to Peers, and accepts their
  results.
- `pi-peer-SLUG` ([Pi](https://pi.dev)) writes code and returns evidence.

Profiles, settings, and models are global. Every `.md` a seat loads lives in the project, under
`.seatworks/`, so each project carries its own rules under its own git history.

## Get started

You need fish 3.5 or later, jq, the `claude` CLI, Pi 0.84.4 or later logged in to a model
provider, and a running Paseo daemon.

Open Claude Code in this directory and say:

> Read SETUP.md and set up the seats exactly as it describes for the project REPO_DIR.

The agent asks you for an OAuth token and the Peer model, and does the rest. The full procedure
is in [SETUP.md](SETUP.md).

## How it works

Each seat is a Paseo provider that points at its own profile directory: `CLAUDE_CONFIG_DIR`
for the Claude seats, `PI_CODING_AGENT_DIR` for the Pi seat. The profiles hold settings and
symlinks into the project's `.seatworks/`, so an edit to `REPO/.seatworks/LEAD.md` takes effect
for the next Lead you spawn there.

```
~/.paseo/config.json               claude-supervisor-SLUG, claude-lead-SLUG, pi-peer-SLUG
~/.claude/profiles/<seat>/         settings and deny lists; CLAUDE.md and skills/ are links
~/.pi/profiles/pi-peer-SLUG/       guard and login links; APPEND_SYSTEM.md and skills/ are links
REPO/.seatworks/                   SUPERVISOR.md, LEAD.md, PEER.md, WORKSPACE_PROTOCOL.md,
                                   NOTEBOOK.md, records/, skills/{supervisor,lead,peer}/
```

`setup/add-project.fish` copies the kit's `project/` templates into a repository and creates its
providers; after that, the project's copies are its own.

Each role has its own skill set: strategy skills for the Supervisor (interviews, pre-mortems,
retrospectives, protocol patches), macro skills for the Lead (intake, decomposition, council,
review orchestration, rollout), and micro skills for the Peer (test-first work, debugging,
proof audits, reviews). The Supervisor alone keeps Claude Code's auto memory, as the project's
organizational memory.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination. The Lead owns its workspace's
topology, integration, and acceptance. A Peer owns engineering judgment inside its scope.

Each layer sees only what it needs. Peers don't know about Paseo, and the Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Daily use

Talk to the Supervisor rather than to the Lead. In the Paseo app, open the project and start
an agent on `claude-supervisor-SLUG`, settle the outcome with it, and have it create a Lead and
relay the decision. For a small, well-defined task, you can talk to a Lead directly. A Peer has
no context for questions, so give it only assigned work.

After you edit a prompt or the settings, rebuild the profiles:

```fish
fish setup/setup-seats.fish
```

To verify without writing anything:

```fish
fish setup/setup-seats.fish --check
```

The real work is replacing the demo rules with your own, the last step in SETUP.md. The rules
grow each time the system misses a failure: the Supervisor records each miss in the project's
notebook, and a miss becomes a rule only when it recurs.

## Contents

| Path | Purpose |
|---|---|
| [SETUP.md](SETUP.md) | Setup procedure, written for an agent to execute |
| [REFERENCE.md](REFERENCE.md) | Environment behavior that you can't infer from the config |
| [WRITING_GUIDE.md](WRITING_GUIDE.md) | Rules for writing and editing the prompts and docs in this kit |
| [NOTICE.md](NOTICE.md) | Where the skills' ideas come from, with licenses |
| [project/](project/) | Templates copied into each project's `.seatworks/` |
| [project/SUPERVISOR.md](project/SUPERVISOR.md) | Supervisor prompt (demo) |
| [project/LEAD.md](project/LEAD.md) | Lead prompt (demo) |
| [project/PEER.md](project/PEER.md) | Peer prompt (demo), loaded by Pi as `APPEND_SYSTEM.md` |
| [project/skills/](project/skills/) | Strategy skills for the Supervisor, macro skills for the Lead, micro skills for the Peer |
| [project/NOTEBOOK.md](project/NOTEBOOK.md) | A project's append-only record of failures |
| [pi/extensions/peer-guard.ts](pi/extensions/peer-guard.ts) | Pi extension that blocks `git push` and agent CLIs for every Peer |
| [pi/settings.json](pi/settings.json) | Keys merged into each Peer's Pi settings |
| [setup/add-project.fish](setup/add-project.fish) | Gives one repository its `.seatworks/`, its three providers, and their profiles |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Builds or refreshes every seat profile; idempotent, and `--check` only verifies |
| [setup/seat-settings.base.json](setup/seat-settings.base.json) | Settings shared by the Claude seats |
| [examples/paseo-providers.json](examples/paseo-providers.json) | The base `claude` provider, plus the per-project `SLUG` templates |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a project's coordination protocol, read only by the Lead |

The script generates `claude/<role>.settings.json`. To change those files, edit
`setup/seat-settings.base.json` or the `overlay_*` blocks in the script.
