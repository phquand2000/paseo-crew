# Seatworks starter

Seatworks sets up three Claude Code seats on one machine, each with its own prompt and
settings, coordinated through [Paseo](https://getpaseo.com):

- `claude-supervisor` meets with you, relays settled decisions to Leads, watches how they
  coordinate, and keeps a notebook of failures.
- `claude-lead` breaks work down, delegates it to Peers, and accepts their results.
- `claude-peer` writes code and returns evidence.

The prompts live in this repository under git instead of in `~/.claude`, so every change has
a history.

## Get started

You need fish 3.5 or later, jq, the `claude` CLI, and a running Paseo daemon.

Open Claude Code in this directory and say:

> Read SETUP.md and set up the three seats exactly as it describes.

The agent asks you for an OAuth token and for confirmation of the model IDs, and does the rest.
The full procedure is in [SETUP.md](SETUP.md).

## How it works

Each seat is a Paseo provider whose `CLAUDE_CONFIG_DIR` points at its own profile directory.
The setup script fills that directory with symlinks back into this repository, so an edit to
`claude/LEAD.md` takes effect for the next Lead you spawn.

Each layer sees only what it needs. Peers don't know about the Lead or Paseo, and Leads don't
know about the Supervisor; only you and the Supervisor see the whole system. The hiding lives
in the prompts, not in the filesystem, and [REFERENCE.md](REFERENCE.md) describes where it
holds.

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
| [claude/PEER.md](claude/PEER.md) | Peer prompt (demo) |
| [notebook/NOTEBOOK.md](notebook/NOTEBOOK.md) | The Supervisor's append-only record of failures |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Builds or refreshes the seat profiles; idempotent, and `--check` only verifies |
| [setup/seat-settings.base.json](setup/seat-settings.base.json) | Settings shared by all seats |
| [examples/paseo-providers.json](examples/paseo-providers.json) | Provider entries to merge into `~/.paseo/config.json` |
| [examples/CLAUDE_MD_SNIPPET.md](examples/CLAUDE_MD_SNIPPET.md) | Template for the `CLAUDE.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a per-repository coordination protocol, read only by the Lead |

The script generates `claude/<seat>.settings.json`. To change those files, edit
`setup/seat-settings.base.json` or the `overlay_*` blocks in the script.
