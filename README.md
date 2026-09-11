# Seatworks starter

Seatworks sets up three agent seats on one machine, each with its own prompt and settings,
coordinated through [Paseo](https://getpaseo.com):

- `claude-supervisor` ([Claude Code](https://code.claude.com)) meets with you, relays settled
  decisions to Leads, watches how they coordinate, and keeps a notebook of failures.
- `claude-lead` (Claude Code) breaks work down, delegates it to Peers, and accepts their
  results.
- `pi-peer` ([Pi](https://pi.dev)) writes code and returns evidence.

The prompts live in this repository under git instead of in `~/.claude` or `~/.pi`, so every
change has a history.

## Get started

You need fish 3.5 or later, jq, the `claude` CLI, Pi 0.84.4 or later logged in to a model
provider, and a running Paseo daemon.

Open Claude Code in this directory and say:

> Read SETUP.md and set up the three seats exactly as it describes.

The agent asks you for an OAuth token and for confirmation of the model IDs, and does the rest.
The full procedure is in [SETUP.md](SETUP.md).

## How it works

Each seat is a Paseo provider that points at its own profile directory: `CLAUDE_CONFIG_DIR`
for the Claude seats, `PI_CODING_AGENT_DIR` for the Pi seat. The setup script fills those
directories with symlinks back into this repository, so an edit to `claude/LEAD.md` takes
effect for the next Lead you spawn.

Each role also has its own skill set, linked from `skills/<role>/` into its profile: strategy
skills for the Supervisor (interviews, pre-mortems, retrospectives, protocol patches), macro
skills for the Lead (intake, decomposition, council, review orchestration, rollout), and micro
skills for the Peer (test-first work, debugging, proof audits, reviews). The Supervisor alone
keeps Claude Code's auto memory, as the organizational memory across projects.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination across workspaces. A Lead owns its
workspace's topology, integration, and acceptance. A Peer owns engineering judgment inside its
scope.

Each layer sees only what it needs. Peers don't know about Paseo, and a Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Daily use

Talk to the Supervisor rather than to a Lead. Spawn `claude-supervisor` with this directory as
its working directory, settle the outcome with it, and have it create a Lead and relay the
decision. For a small, well-defined task, you can talk to a Lead directly. A Peer has no
context for questions, so give it only assigned work.

After you edit a prompt or the settings, rebuild the profiles:

```fish
fish setup/setup-seats.fish
```

To verify without writing anything:

```fish
fish setup/setup-seats.fish --check
```

The real work is replacing the demo rules with your own, the last step in SETUP.md. The frame
takes ten minutes to build. The rules grow each time the system misses a failure: the
Supervisor records each miss in the notebook, and a miss becomes a rule only when it recurs.

## Contents

| Path | Purpose |
|---|---|
| [SETUP.md](SETUP.md) | Setup procedure, written for an agent to execute |
| [REFERENCE.md](REFERENCE.md) | Environment behavior that you can't infer from the config |
| [WRITING_GUIDE.md](WRITING_GUIDE.md) | Rules for writing and editing the prompts and docs in this kit |
| [claude/SUPERVISOR.md](claude/SUPERVISOR.md) | Supervisor prompt (demo) |
| [claude/LEAD.md](claude/LEAD.md) | Lead prompt (demo) |
| [pi/PEER.md](pi/PEER.md) | Peer prompt (demo), loaded by Pi as `APPEND_SYSTEM.md` |
| [pi/extensions/peer-guard.ts](pi/extensions/peer-guard.ts) | Pi extension that blocks `git push` and agent CLIs for the Peer |
| [pi/settings.json](pi/settings.json) | Keys merged into the Peer's Pi settings |
| [skills/supervisor/](skills/supervisor/) | Strategy skills for the Supervisor |
| [skills/lead/](skills/lead/) | Macro skills for the Lead |
| [skills/peer/](skills/peer/) | Micro skills for the Peer, loaded by Pi |
| [skills/NOTICE.md](skills/NOTICE.md) | Where the skills' ideas come from, with licenses |
| [notebook/NOTEBOOK.md](notebook/NOTEBOOK.md) | The Supervisor's append-only record of failures |
| `records/` | Created by the Supervisor's skills: directives, timelines, audits, and the safety, integration, and strategy documents. Drafts and questionnaires are ignored by git |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Builds or refreshes the seat profiles; idempotent, and `--check` only verifies |
| [setup/seat-settings.base.json](setup/seat-settings.base.json) | Settings shared by the Claude seats |
| [examples/paseo-providers.json](examples/paseo-providers.json) | Provider entries to merge into `~/.paseo/config.json` |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a per-repository coordination protocol, read only by the Lead |

The script generates `claude/<seat>.settings.json`. To change those files, edit
`setup/seat-settings.base.json` or the `overlay_*` blocks in the script.
