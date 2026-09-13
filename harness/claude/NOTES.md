# Claude Code as a harness

Facts about this harness that `harness.json` encodes, and how each one was established. Every
entry here is Claude Code behavior; nothing in `project/` or the setup docs should repeat it.

Verified on Claude Code **2.1.236**. When `setup-seats.fish` finds another version it says so
and asks for `--probe`.

## Skills

- **Where they go:** `$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md`. `CLAUDE_CONFIG_DIR` relocates
  the whole `~/.claude` directory, so the personal skills directory moves with it.
- **Symlinks:** followed. A seat sees a skill whether its directory is real or a link into the
  project's `.seatworks/skills/<role>/`.
- **How it was established:** a scratch config directory with two sentinel skills, one real
  directory and one symlink, run through `claude -p`. Both appeared in the seat's skill list and
  the model invoked one.
- **Loading one:** the `Skill` tool, with `{"skill": "<name>"}`. A user-typed `/<name>` reaches
  the same tool. The transcript records it as `"name":"Skill","input":{"skill":"<name>"`, which
  is how `skill-guard.sh` tells a loaded skill from an unloaded one.
- **`SlashCommand` is not a tool.** A deny entry for it makes Claude Code print
  `Permission deny rule "SlashCommand" matches no known tool — check for typos.` The kit's deny
  list carried that dead entry until the harness layer removed it; `seat_deny` in
  `setup-seats.fish` now reports any deny entry `seats.json` no longer lists, so a future typo
  surfaces instead of silently protecting nothing.
- **Denying `Skill` would turn every skill off.** No intent maps to it, and none should.
- **Description budget:** Claude Code lists skill descriptions within about 1% of the context
  window, roughly 8,000 characters, and drops the least-used ones past that. Keep each role to
  about ten model-invocable skills, and mark the rest `disable-model-invocation: true`.
- **Bundled skills:** off, through `disableBundledSkills` in the role settings and
  `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` on the provider, so a seat's list holds only its own.

## Prompt

- **File:** `CLAUDE.md` in the profile directory, linked to the project's role prompt.
- **HTML comments are stripped** before loading, so a maintainer note in a prompt this harness
  reads would cost the seat nothing. The kit still forbids them: every `.md` has to load
  unchanged on every harness, so `setup-seats.fish` refuses `<!--` here too, and
  `promptComments: "stripped"` is now a fact for a safety review rather than a licence.

## Enforcement

- **Deny lists:** Paseo applies `disallowedTools` to its `claude` provider (and to `omp`), which
  is why `deny.mechanism` is `disallowedTools` here; a harness Paseo does not cover that way
  falls back to `hooks`.
- **Hooks:** one entry per guard in the role settings, under the event it answers: `PreToolUse`
  for a guard that can refuse, `PostToolUse` or `SessionStart` for a note. Every entry whose
  matcher matches runs, and any `PreToolUse` exit code 2 blocks the call, so the guards compose
  without chaining; this was confirmed with two overlapping matchers where the second refused.
- **Hook input:** `cwd`, `hook_event_name`, `permission_mode`, `prompt_id`, `session_id`,
  `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`. The transcript path is what makes
  a skill gate possible at all.
- **Hook protocol:** `exit-code` — stderr plus exit 2, the form `block` in
  `harness/common/hook-io.sh` writes. A harness that answers hooks another way needs its own
  guards, as `guards.hookProtocol` records and `harness/omp/extensions/` shows.
- **Notes to the model (`guards.noteProtocol`):** measured on 2.1.236 by pointing a seat at a
  local server that answered one Write tool call and captured the next request. The write ran in
  every case. `hookSpecificOutput.additionalContext` from `PostToolUse` or `PreToolUse` arrived in
  the next user message as a `<system-reminder>` reading "hook additional context"; `PostToolUse`
  exit 2 with stderr, and `decision: "block"` with `reason`, arrived too, but as a "hook blocking
  error". The first is the note channel `note` writes. `SessionStart` with matcher `compact`
  delivers `additionalContext` by the docs.
- **`permissions.deny` is not equivalent** to a provider deny list, so the role settings leave
  it out.

- **`AskUserQuestion` is offered only with `--permission-prompt-tool`,** which the orchestrator
  passes, and the call then becomes its pending question even under `bypassPermissions`.
  Measured on 2.1.236 with a local API stand-in: a `PreToolUse` hook matching it can deny with a
  reason the model reads, or answer through `updatedInput.answers`.

## MCP servers

- The seat's own `.claude.json` carries `mcpServers`, written from `seats.json`. Project-scoped
  servers stay cleared — `enabledMcpjsonServers` empty, `enableAllProjectMcpServers` deleted,
  every `projects[].mcpServers` emptied — so a repository cannot hand a seat a server the kit
  never chose.
- `claude mcp list` run with `CLAUDE_CONFIG_DIR` set to a built seat reported both servers
  connected, which is how the file location was confirmed.
- Tool names are `mcp__<server>__<tool>`, with the server name exactly as the config spells it.
  That is the documented form, not one read off a running seat here; a wrong name in a deny list
  answers `matches no known tool`, the way `deny.retired` records.

## Shared state

- `projects` and `plugins` in each profile are links to `~/.claude/projects` and
  `~/.claude/plugins`, so every seat on this harness shares your transcripts and plugins. On
  startup a seat deletes transcripts older than its own `cleanupPeriodDays`, yours included,
  which is why `setup-seats.fish` requires each role settings file to carry the same value as
  `~/.claude/settings.json`.
- Plugin skill paths carry a version number, so `claude plugin update` leaves the kit's skill
  symlinks dangling. Rerun `setup/setup-seats.fish` after an update.

## Role settings

`settings/<role>.settings.json` is tracked in git and edited by hand. `setup-seats.fish` links
each seat to its role's file and only checks it: that its JSON parses, that `cleanupPeriodDays`
matches yours, and that every guard `seats.json` gives the role has a `PreToolUse` entry running
it. It never writes these files.
