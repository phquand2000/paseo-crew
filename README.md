# Seatworks starter

Seatworks gives each project six agent seats, each with its own prompt and settings,
coordinated through [Paseo](https://getpaseo.com):

- `claude-supervisor-SLUG` ([Claude Code](https://code.claude.com)) meets with you, relays
  settled decisions to the Lead, answers the attention events the watcher raises, and keeps
  the project's notebook of failures.
- `claude-lead-SLUG` (Claude Code) breaks work down, delegates it to Peers, and accepts their
  results.
- `pi-peer-SLUG` ([Pi](https://pi.dev)) writes code and returns evidence; `pi-peer-ro-SLUG`
  runs the same prompt and skills with edits blocked, for Architect, Scout, and council work.
- `pi-reviewer-SLUG` (Pi) reviews changes read-only: it runs
  [Open Code Review](https://github.com/alibaba/open-code-review) as a first pass and confirms
  every finding in the code before reporting it.
- `claude-watcher-SLUG` (Claude Code on Haiku) reads the Lead's and Peers' activity on a
  heartbeat and raises attention events for the Supervisor.

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
for the Claude seats, `PI_CODING_AGENT_DIR` for the Pi seats. The profiles hold links to the
kit's settings and guards and into the project's `.seatworks/`, so an edit to
`REPO/.seatworks/LEAD.md` takes effect for the next Lead you spawn there.

```
~/.paseo/config.json               the six SLUG providers, each Claude seat's deny list in its
                                   disallowedTools, and one agent profile per seat
~/.claude/profiles/<seat>/         links: settings.json, guard scripts, CLAUDE.md, skills/
~/.pi/profiles/<seat>/             guard and login links; APPEND_SYSTEM.md and skills/ are links
REPO/.seatworks/                   SUPERVISOR.md, LEAD.md, PEER.md, REVIEWER.md, WATCHER.md,
                                   WORKSPACE_PROTOCOL.md, NOTEBOOK.md, records/,
                                   skills/{supervisor,lead,peer,reviewer}/
```

`setup/add-project.fish` copies the kit's `project/` templates into a repository and creates its
providers; after that, the project's copies are its own until a `--refresh`.

Each role has its own skill set: strategy skills for the Supervisor (interviews, pre-mortems,
retrospectives, protocol patches), macro skills for the Lead (intake, decomposition, council,
review orchestration, rollout), micro skills for the Peer (test-first work, debugging, proof
audits), and review skills for the Reviewer (Open Code Review, change review). The Supervisor
alone keeps Claude Code's auto memory, as the project's organizational memory.

Authority is split by concern rather than stacked in one chain. You hold intent and priorities.
The Supervisor interprets intent and watches coordination. The Lead owns its workspace's
topology, integration, and acceptance. A Peer owns engineering judgment inside its scope.

Each layer sees only what it needs. Peers don't know about Paseo, and the Lead receives the
Supervisor's messages labeled as owner directives or advice, without knowing who sends them.
The hiding lives in the prompts, not in the filesystem; [REFERENCE.md](REFERENCE.md)
describes where it holds.

## Attention, not polling

An agent writing fluently rarely stops to check what it is most likely to get wrong, such as a
test that invents an API nobody decided, or a trade-off made just to hit a number. Asked the
right question at that moment, it usually sees the problem itself. The kit is built around
that question:

- The Supervisor keeps a watcher running while a Lead works, and checks it before every
  directive. The watcher is a Haiku seat with a short prompt of its own; it reads the Lead's and
  Peers' activity every 15 minutes and sends the Supervisor an `ATTENTION:` event when it sees
  a trigger, such as a major decision, a struggle, a change of direction, a trade-off nobody
  approved, or a minted API.
- The Supervisor logs most events. For the rest it sends a neutral `CHECK:` question through
  the Lead ("which of the names your new tests call existed before this task?"), because asking
  an agent to look again at a named source catches more than telling it that it is wrong.
- Hard decisions go to sealed lanes: two or three Peers answer the same open question without
  seeing the Lead's view or each other's, and the Lead rules on them.
- When you're away, the Supervisor keeps attending and gives you a short report when you're
  back. Once a week it proposes rule changes from what the log recorded.

## Daily use

Talk to the Supervisor rather than to the Lead. In the Paseo app, open the project and start
an agent on `claude-supervisor-SLUG`, settle the outcome with it, and have it create a Lead and
relay the decision. For a small, well-defined task, you can talk to a Lead directly. A Peer has
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
| [REFERENCE.md](REFERENCE.md) | Environment behavior that you can't infer from the config |
| [WRITING_GUIDE.md](WRITING_GUIDE.md) | Rules for writing and editing the prompts and docs in this kit |
| [NOTICE.md](NOTICE.md) | Where the skills' ideas come from, with licenses |
| [project/](project/) | Templates copied into each project's `.seatworks/` |
| [project/SUPERVISOR.md](project/SUPERVISOR.md) | Supervisor prompt (demo) |
| [project/LEAD.md](project/LEAD.md) | Lead prompt (demo) |
| [project/PEER.md](project/PEER.md) | Peer prompt (demo), loaded by Pi as `APPEND_SYSTEM.md` |
| [project/REVIEWER.md](project/REVIEWER.md) | Reviewer prompt (demo), loaded by Pi as `APPEND_SYSTEM.md` |
| [project/WATCHER.md](project/WATCHER.md) | Watcher prompt with the trigger table, read by the Haiku watcher on every sweep |
| [project/skills/](project/skills/) | Strategy skills for the Supervisor, macro skills for the Lead, micro skills for the Peer, review skills for the Reviewer |
| [project/NOTEBOOK.md](project/NOTEBOOK.md) | A project's append-only record of failures |
| [pi/extensions/peer-guard.ts](pi/extensions/peer-guard.ts) | Pi extension that blocks `git push` and agent CLIs for every Pi seat, and file edits for the read-only seats (Reviewer and read-only Peer) |
| [claude/lead-guard.sh](claude/lead-guard.sh) | Lead, Supervisor, and watcher hook that blocks writes to repository files outside what the role owns (coordination records, `.seatworks/`, the attention log), so Peers write all code |
| [claude/profile-guard.sh](claude/profile-guard.sh) | Supervisor and Lead hook that blocks creating, prompting, scheduling, or switching an agent onto a model or mode other than its profile's |
| [claude/watcher-guard.sh](claude/watcher-guard.sh) | Watcher hook that lets `send_agent_prompt` reach only the Supervisor |
| [pi/settings.json](pi/settings.json) | Keys merged into each Peer's Pi settings |
| [setup/add-project.fish](setup/add-project.fish) | Gives one repository its `.seatworks/`, its six providers, and their profiles |
| [setup/setup-seats.fish](setup/setup-seats.fish) | Builds or refreshes every seat profile; idempotent, and `--check` only verifies |
| [claude/](claude/) `lead`, `supervisor`, `watcher` `.settings.json` | Your settings for each Claude role, shared by every seat of that role |
| [examples/paseo-providers.json](examples/paseo-providers.json) | The base `claude` provider, plus the per-project `SLUG` templates |
| [examples/AGENTS_MD_SNIPPET.md](examples/AGENTS_MD_SNIPPET.md) | Template for the `AGENTS.md` of a repository you work in |
| [examples/WORKSPACE_PROTOCOL.md](examples/WORKSPACE_PROTOCOL.md) | Template for a project's coordination protocol, read only by the Lead |

The role settings in `claude/<role>.settings.json` are tracked in git and edited by hand; the
script links every seat to its role's file and only checks it, never writes it. Their
`"language": "vietnamese"` is the kit owner's setting: change or remove it for your own. The
Lead and the watcher keep a 1-hour prompt cache, since the watcher sweeps every 15 minutes.
Each hook runs its guard through the seat's own profile, so the files hold no path specific to
one machine.
