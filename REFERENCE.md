# Environment reference

This page lists behavior you can't infer from the config. Each entry gives the symptom, the
cause, and the response. Entries follow the order of the setup steps.

## Provider changes don't take effect

- **Symptom:** after you edit `~/.paseo/config.json`, agents still behave as before.
- **Cause:** Paseo has no file watcher; the daemon keeps the config it loaded.
- **Response:** run `paseo reload` after every edit to the file.

## The Lead and Supervisor have no Paseo tools

- **Symptom:** a Claude seat can't call `create_agent` or `list_models`.
- **Cause:** Paseo's tools reach agents only when `daemon.mcp.injectIntoAgents` is `true`.
- **Response:** set it to `true` and reload. It applies to every agent the daemon starts, which
  is why the setup script reports it instead of changing it.

## A seat runs normally without its profile

- **Symptom:** a seat works but ignores its prompt.
- **Cause:** without `CLAUDE_CONFIG_DIR`, Claude Code reads the shared `~/.claude`; without
  `PI_CODING_AGENT_DIR`, Pi reads `~/.pi/agent`. Neither carries the kit's prompts, and nothing
  reports an error.
- **Response:** the "Verify that each seat reads its own prompt" step in SETUP.md catches this.

## The Peer's model list comes from Pi

- **Symptom:** `pi-peer` offers every model your Pi login can reach.
- **Cause:** `pi-peer` has no `models` list, so Paseo asks Pi. For the Claude seats, an empty
  `models` list likewise means the full runtime catalog, not "nothing to run".
- **Response:** name the Peer model in the repository's `WORKSPACE_PROTOCOL.md`, and list
  `models` explicitly on a provider to cap its model and effort.

## Paseo tool access is set per provider ID

- **Symptom:** a Peer can see `create_agent` or other Paseo tools.
- **Cause:** `paseoTools` applies to the exact provider ID and isn't inherited from `extends` or
  from the agent that creates the Peer. Pi receives Paseo tools only through the
  `pi-mcp-adapter` extension, and Paseo carries the profile's `mcp.json` into each launch.
- **Response:** keep `paseoTools.enabled: false` on `pi-peer` (the setup script sets it), keep
  `pi-mcp-adapter` out of the Peer profile, and keep any `paseo` server out of its `mcp.json`.

## Running agents keep the old rules

- **Symptom:** after you change a prompt, a guard, or a deny list, some agents follow the old
  version.
- **Cause:** an agent keeps what it started with until its session ends. Seats spawned
  afterwards pick up prompts, settings, extensions, and skills immediately.
- **Response:** archive the old agents and delete their schedules and heartbeats, so that two
  versions of the rules don't run side by side.

## Claude seats: `settings.modeId` overrides the permission mode

- **Symptom:** a Claude seat stops to ask permission for every tool.
- **Cause:** Paseo passes `create_agent`'s `settings.modeId` straight to the SDK, overriding
  the seat's `permissions.defaultMode`. When the field is empty, the mode falls back to `auto`.
- **Response:** pass `settings.modeId: "bypassPermissions"` and a `thinkingOptionId` when you
  create a Claude seat.

## Pi seats reject `settings.modeId`

- **Symptom:** `create_agent` on `pi-peer` fails with "Invalid mode … Available modes: (none)".
- **Cause:** Pi has no modes, so Paseo rejects any mode ID for it.
- **Response:** pass only `settings.thinkingOptionId` for Pi agents.

## Enforcement differs between Claude and Pi

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** prompts are guidance. For Claude seats, blocking happens in the provider's
  `disallowedTools`; a seat's `permissions.deny` isn't equivalent, so `seat-settings.base.json`
  leaves it out. Pi has no permission system and ignores `disallowedTools`, so the Peer's only
  enforcement point is the `tool_call` hook in `pi/extensions/peer-guard.ts`.
- **Response:** put anything that must never happen in the deny lists in the setup script or in
  the guard extension.

## Command guards are guard rails, not sandboxes

- **Symptom:** a blocked command runs anyway in a different form.
- **Cause:** Claude's `Bash(git push:*)` and `Bash(gh:*)` match by prefix, so `git -C repo push`
  gets through. The Peer's guard catches that form and also blocks `gh`, but it ignores quoted
  strings, so `sh -c 'git push'` still runs. Neither guard blocks other network commands such
  as `curl`; the Supervisor's `seat-safety-review` skill checks for that.
- **Response:** treat both as protection against accidents. Keep credentials that could do
  damage out of the Peer's environment.

## Information hiding lives in the prompts

- **Symptom:** a Peer refers to coordination details, or to a note meant for maintainers.
- **Cause:** a Peer can read any file in the repository, including `WORKSPACE_PROTOCOL.md`. Pi
  also loads `APPEND_SYSTEM.md` verbatim: unlike Claude Code, it doesn't strip HTML comments.
- **Response:** keep maintainer notes out of `pi/PEER.md` (the setup script fails on `<!--`).
  The hiding reduces noise; it doesn't keep secrets.

## Pi reads `AGENTS.md` before `CLAUDE.md`

- **Symptom:** the Peer ignores constraints that the Lead follows.
- **Cause:** Pi takes one instruction file per directory, preferring `AGENTS.md` over
  `CLAUDE.md`, while Claude Code reads `CLAUDE.md`.
- **Response:** keep constraints in `AGENTS.md`, and make `CLAUDE.md` contain `@AGENTS.md`.

## Pi ignores an untrusted repository's `.pi/` directory

- **Symptom:** a repository's `.pi/` extensions, skills, or prompts don't reach the Peer, or,
  once trusted, replace the Peer prompt.
- **Cause:** in RPC mode Pi never shows its trust prompt, and with the default
  `defaultProjectTrust: "ask"` it silently skips project `.pi/` resources. In a trusted
  repository, `.pi/APPEND_SYSTEM.md` takes the place of the profile's.
- **Response:** leave project trust at `ask` for repositories the Peer works in.

## Pi loads `~/.agents/skills` for every profile

- **Symptom:** the Peer has skills that aren't in its allowlist.
- **Cause:** `~/.agents/skills` sits outside `PI_CODING_AGENT_DIR`, so every Pi profile loads
  it. The setup script prints how many skills it holds.
- **Response:** move skills the Peer shouldn't see out of `~/.agents/skills`.

## The Peer shares your Pi login

- **Symptom:** a login or logout in your normal Pi profile also affects the Peer.
- **Cause:** the Peer profile's `auth.json` links to `~/.pi/agent/auth.json`, and Pi rewrites the
  file in place, so both profiles use one set of credentials. Each profile keeps its own lock
  file, so two OAuth refreshes at the same moment can race. A Claude Pro or Max login used
  through Pi is billed per token as extra usage, not against the plan's limits.
- **Response:** prefer an API key for the Peer's provider. To separate the logins, replace the
  link with a real file and log in again with `PI_CODING_AGENT_DIR` pointing at the profile.

## Archiving a Lead archives its Peers

- **Symptom:** Peers disappear when their Lead is archived, or their results never reach a new
  Lead.
- **Cause:** archiving an agent cascades to its subagents in the same workspace, a Peer's
  notifications go only to the agent that created it, and only a person can detach a subagent,
  in the Paseo app.
- **Response:** hand off a Lead only after its Peers have finished and been accepted or
  archived, or detach a Peer that must survive before archiving its Lead.

## HTML comments are stripped from `CLAUDE.md`

- **Symptom:** none; this is useful behavior for the Claude seats.
- **Cause:** Claude Code removes `<!-- ... -->` comments before loading `CLAUDE.md`. Files read
  with a tool, and every file Pi loads, keep their comments.
- **Response:** put maintainer notes in the Claude seat prompts in HTML comments, and nowhere
  else.

## Claude seats drop skill descriptions past a budget

- **Symptom:** a Claude seat never uses a skill it has.
- **Cause:** Claude Code lists skill descriptions within about 1% of the context window
  (roughly 8,000 characters) and drops the least-used ones when the list is longer. Pi lists
  every skill without a cap.
- **Response:** keep each role to about ten model-invocable skills with descriptions of 200 to
  400 characters, and mark rarely used ones `disable-model-invocation: true`; they stay
  available as `/name` in Claude Code and `/skill:name` in Pi.

## Pi reads only three frontmatter fields

- **Symptom:** a skill behaves differently in Pi than in Claude Code, or doesn't load in Pi.
- **Cause:** Pi reads only `name`, `description`, and `disable-model-invocation` (the literal
  `true`). It doesn't substitute `$ARGUMENTS` or `${CLAUDE_SKILL_DIR}`, shows HTML comments,
  skips a skill with malformed YAML or an empty description, and lists skills only when the
  `read` or `bash` tool is enabled.
- **Response:** write skills by the rules in WRITING_GUIDE.md; the setup script checks the
  ones it can.

## Plugin updates break skill symlinks

- **Symptom:** a Claude seat loses a skill after `claude plugin update`.
- **Cause:** plugin skill paths contain the version number, so an update leaves the symlinks
  pointing at a directory that no longer exists.
- **Response:** rerun `setup/setup-seats.fish` after every plugin update.

## Claude seats clean up the shared transcript directory

- **Symptom:** your own old Claude Code transcripts disappear.
- **Cause:** every Claude seat's `projects` directory is a symlink to the shared
  `~/.claude/projects`. On startup, a seat deletes transcripts older than its own
  `cleanupPeriodDays`, including yours, and this can't be undone.
- **Response:** the script copies `cleanupPeriodDays` from your `~/.claude/settings.json` into
  every Claude seat's settings. Keep the key out of `setup/seat-settings.base.json`, and rerun
  the script after you change your own value.

## The 16 KB prompt budget is self-imposed

- **Symptom:** the script fails a prompt that the runtime would load without complaint.
- **Cause:** both runtimes load larger files. The budget exists because every line costs context
  on every turn, and rules at the end of a long file get skimmed.
- **Response:** when a prompt exceeds the budget, cut content rather than raising the limit.
