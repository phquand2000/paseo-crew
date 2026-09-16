# Claude Code as a harness

Facts about this harness that `harness.json` and the settings encode, and how each one was
established. Every entry here is Claude Code behavior; the prompts and the README should not repeat
it.

Verified on Claude Code **2.1.236**.

## Launch

- **Credential:** `CLAUDE_CODE_OAUTH_TOKEN`, made with `claude setup-token` and set by you on the
  base `claude` provider, so every seat inherits it through `extends`. The kit never reads it.
- **`--setting-sources user`:** `bin/seat-room` forces it (`provider.forceFlags`). It drops the
  repository's own `.claude/settings.json` and `.claude/skills/` while keeping the seat's
  `settings.json`, which is the user source. Measured from this harness's debug log: `user,project,local`
  loads 2 skills (user: 1, project: 1) and `user` loads 1 (user: 1, project: 0). Without it a
  repository adds skills, settings and permission rules to a seat.
- **`ENABLE_TOOL_SEARCH=false`** on the provider loads MCP tools upfront instead of behind a search.
- **1-hour prompt cache:** `ENABLE_PROMPT_CACHING_1H=1` on the provider. There is no settings key
  for it; `promptCacheTtl` appears nowhere in the 2.1.236 binary.

## Skills

- **Where they go:** `$CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md`. `CLAUDE_CONFIG_DIR` relocates
  the whole `~/.claude` directory, so the personal skills directory moves with it.
- **Symlinks:** followed. A seat sees a skill whether its directory is real or a link into the kit.
- **How it was established:** a scratch config directory with two sentinel skills, one real
  directory and one symlink, run through `claude -p`. Both appeared in the seat's skill list and
  the model invoked one.
- **Loading one:** the `Skill` tool, with `{"skill": "<name>"}`. A user-typed `/<name>` reaches
  the same tool. The transcript records it as `"name":"Skill","input":{"skill":"<name>"`.
- **`SlashCommand` is not a tool.** A deny entry for it makes Claude Code print
  `Permission deny rule "SlashCommand" matches no known tool — check for typos.`, which is how a
  typo in `permissions.deny` surfaces instead of silently protecting nothing.
- **Denying `Skill` would turn every skill off.** No settings deny it, and none should.
- **Description budget:** Claude Code lists skill descriptions within about 1% of the context
  window, roughly 8,000 characters, and drops the least-used ones past that. Keep each role to
  about ten model-invocable skills, and mark the rest `disable-model-invocation: true`.
- **Bundled skills:** off through `disableBundledSkills`, so a seat's list holds only its own. The
  binary names `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` as the same switch, so the provider doesn't set it.

## Prompt

- **Role prompt:** passed as the launch system prompt (`systemPrompt: "config"`).
- **Rules:** `CLAUDE.md` in the seat directory holds the rules the plugin generates from the
  enabled MCP servers, and is removed when there are none.
- **HTML comments are stripped** before loading. The kit still keeps every `.md` free of them, so
  each loads unchanged on every harness.

## Enforcement

Every limit is in the settings, verified on 2.1.236 with
`claude -p --setting-sources user --permission-mode bypassPermissions` against a scratch config
directory. The parts below hold in `bypassPermissions`, the mode Paseo launches these seats in.

- **`permissions.deny`:** a bare tool name (`Agent`, `Workflow`, `EnterPlanMode`, `EnterWorktree`,
  the Cron tools, `SendMessage`, `Monitor`, `Artifact`, `NotebookEdit`) takes the tool out of the
  model's context. A Bash rule such as `Bash(git push *)`, `Bash(gh *)`, `Bash(paseo *)` or
  `Bash(claude *)` matches the command text, so each git rule is listed with and without `-C *`.
  An `Edit` rule refused a Write to its path; the rules name `~/.paseo`, `~/.claude/settings.json`
  and each seat profile's `settings.json` and `.claude.json`.
- **One switch in one place:** Workflows are off through `disableWorkflows` (the binary names
  `CLAUDE_CODE_DISABLE_WORKFLOWS` as the same) and the `Workflow` deny; Cron through its denied
  tools. No seat installs a plugin, so there is no `LSP` tool and no `enabledPlugins` to clear.
- **`sandbox`:** `enabled`, `failIfUnavailable: true` and `allowUnsandboxedCommands: false`, and
  the Lead also sets `network.allowLocalBinding`. It refused a Bash write outside the working
  directory and allowed one inside it, a git commit, and an HTTPS request. The plugin adds the
  project's state directory to `sandbox.filesystem.allowWrite` at launch.
- **`permissions.ask` on a skill:** `Skill(skill:NAME)` holds in `bypassPermissions`, while
  `Skill(NAME)` matches nothing. Through Paseo the call waits as a permission request for the
  agent that started the seat, and a deny's message reaches the seat. `disable-model-invocation`
  can't do this job: the skill then opens only from a message that starts with `/NAME`. The kit
  sets none: a role uses its own skills on its own judgment.
- **`AskUserQuestion` in `permissions.deny`:** the tool leaves the session, and a seat told to use it
  says so and asks in its reply instead; verified on a Lead and a Supervisor seat through Paseo. The
  kit denies it on the Lead, so its question ends the turn and the Supervisor answers; the
  Supervisor keeps it, with `askUserQuestionTimeout: "never"`, for questions about how the project
  behaves.
- **`AskUserQuestion` is offered only with `--permission-prompt-tool`,** which the orchestrator
  passes, and the call then becomes its pending question even under `bypassPermissions`.
- **No write allow-list inside the repository.** A `sandbox.filesystem.denyWrite` entry beats an
  `allowWrite` inside it, so which repository files the Supervisor and the Lead write is a line in
  their prompts.
- **Paseo's `disallowedTools` is not used.** The kit keeps the harness's own deny list instead.

## Compaction

`autoCompactWindow` is 558000 so compaction lands at 525000. Read from the 2.1.236 binary, the
runner compacts past `min(modelWindow, autoCompactWindow)` minus `min(max output, 20000)` minus
13000; `claude-opus-5` reports a 1M window and a 64000 output default, so the offset is a flat 33000.
The setting can only shrink the window, and a `CLAUDE_CODE_MAX_OUTPUT_TOKENS` under 20000 on a
provider would move the real point.

## MCP servers

- The plugin passes the enabled servers in the launch config. The seat's own `.claude.json` keeps
  `mcpServers` empty and project-scoped servers cleared — `enabledMcpjsonServers` empty,
  `enableAllProjectMcpServers` deleted, every `projects[].mcpServers` emptied — so a repository
  cannot hand a seat a server the kit never chose.
- **An OAuth login belongs to one config directory.** `claude mcp list` showed an OAuth server
  connected under the user's own config and `! Needs authentication` with `CLAUDE_CONFIG_DIR` at a
  scratch directory holding the same entry, so a server that signs in needs
  `CLAUDE_CONFIG_DIR=SEAT_DIR claude mcp login NAME` once per seat directory.
- Tool names are `mcp__<server>__<tool>`, with the server name exactly as the config spells it; a
  wrong name in a deny list answers `matches no known tool`.

## Shared state

- `projects` in each seat links to `~/.claude/projects`, so every seat shares your transcripts. On
  startup a seat deletes transcripts older than its own `cleanupPeriodDays`, yours included. The
  settings don't set it, so seats keep the default 30 days; if you set another value in
  `~/.claude/settings.json`, set the same in `settings.json` here.

## Settings files

`settings.json` holds what every Claude role shares and `settings/<role>.settings.json` only what
that role adds. Lists add up and nothing can be taken back, so a rule belongs in the shared file
only when every role on this harness must be denied it. That is why the shared file denies every git
command that moves a branch or rewrites history, which the desk does for the whole team, while
`Bash(git commit *)` sits in the Supervisor, Lead and Reviewer files: the Peer is the one role that
commits. The Reviewer file also denies `Edit`, `Write`, `MultiEdit`, `WebSearch` and the git commands
that stage or restore files, because it only reads. A role with nothing to add still needs its file, because the plugin offers a role
on a harness only when that file exists. The plugin writes the two layered into the seat's
`settings.json`: objects merge, lists such as `permissions.deny` add up, and the seat file is
replaced whole, so an edit made there is gone on the next launch.
