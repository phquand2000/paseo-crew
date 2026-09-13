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
  the same tool. The transcript records it as `"name":"Skill","input":{"skill":"<name>"`.
- **`SlashCommand` is not a tool.** A deny entry for it makes Claude Code print
  `Permission deny rule "SlashCommand" matches no known tool — check for typos.`, which is how a
  typo in a role's `permissions.deny` surfaces instead of silently protecting nothing.
- **Denying `Skill` would turn every skill off.** No role settings deny it, and none should.
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

Every limit is in the role settings, verified on 2.1.236 with
`claude -p --setting-sources user --permission-mode bypassPermissions` against a scratch config
directory. The two parts below hold in `bypassPermissions`, the mode Paseo launches these seats
in, and load because the room forces `--setting-sources user`, which makes this file the user
source.

- **`permissions.deny`:** a bare tool name (`Agent`, `Task`, `Workflow`, `EnterPlanMode`,
  `EnterWorktree`, the Cron tools, `SendMessage`, `Monitor`, `Artifact`, `NotebookEdit`, `LSP`,
  the three `intellij-index` refactor tools) takes the tool out of the model's context. A Bash
  rule such as `Bash(git push *)`, `Bash(gh *)`, `Bash(paseo *)`, `Bash(claude *)` or
  `Bash(omp *)` matches the command text. An `Edit` rule refused a Write to its path; the rules
  name `~/.paseo`, `~/.omp`, `~/.claude/settings.json` and each seat profile's `settings.json`
  and `.claude.json`.
- **`sandbox`:** `enabled`, `failIfUnavailable: true` and `allowUnsandboxedCommands: false`, and
  the Lead also sets `network.allowLocalBinding`. It refused a Bash write outside the working
  directory and allowed one inside it, a git commit, and an HTTPS request.
- **No write allow-list inside the repository.** A `sandbox.filesystem.denyWrite` entry beats an
  `allowWrite` inside it, so which repository files the Supervisor and the Lead write is a line in
  their prompts.
- **Paseo's `disallowedTools` is not used.** Its OMP client never reads the list, so each harness
  keeps its own, and setup deletes one it finds on a provider.

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
  answers `matches no known tool`.

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
each seat to its role's file and only checks it: that its JSON parses and that
`cleanupPeriodDays` matches yours. It never writes these files.
