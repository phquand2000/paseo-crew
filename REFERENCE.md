# Environment reference

This page lists behavior you can't infer from the config. Each entry gives the symptom, the
cause, and the response. Entries follow the order of the setup steps.

## Provider changes don't take effect

- **Symptom:** after you edit `~/.paseo/config.json`, agents still behave as before.
- **Cause:** Paseo has no file watcher; the daemon keeps the config it loaded.
- **Response:** run `paseo reload` after every edit to the file.

## A provider without `CLAUDE_CONFIG_DIR` runs normally

- **Symptom:** a seat works but ignores its prompt.
- **Cause:** without `CLAUDE_CONFIG_DIR`, Claude Code reads the shared `~/.claude`, which
  carries none of the kit's prompts. Nothing reports an error.
- **Response:** the "Verify that each seat reads its own prompt" step in SETUP.md catches this.

## An empty `models` list allows every model

- **Symptom:** a seat offers models and effort levels you didn't list.
- **Cause:** an empty `models` list means the full runtime catalog, not "nothing to run".
- **Response:** list `models` explicitly to cap a seat's model and effort.

## Running agents keep the old rules

- **Symptom:** after you change a prompt or deny list, some agents follow the old version.
- **Cause:** an agent keeps the prompt and deny list it started with until its session ends.
  Seats spawned afterwards pick up prompts, settings, and skills immediately.
- **Response:** archive the old agents and delete their schedules and heartbeats, so that two
  versions of the rules don't run side by side.

## `settings.modeId` overrides the seat's permission mode

- **Symptom:** a seat stops to ask permission for every tool.
- **Cause:** Paseo passes `create_agent`'s `settings.modeId` straight to the SDK, overriding
  the seat's `permissions.defaultMode`. When the field is empty, the mode falls back to `auto`.
  For `claude-peer` this is a dead end, because its deny list includes both `EnterPlanMode`
  and `ExitPlanMode`.
- **Response:** pass `settings.modeId: "bypassPermissions"` and a `thinkingOptionId` to every
  `create_agent`.

## Prompts are guidance; provider deny lists are enforcement

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** Claude Code treats `CLAUDE.md` as guidance. Blocking happens only in the
  provider's `disallowedTools`; a seat's `permissions.deny` isn't equivalent, so
  `seat-settings.base.json` deliberately leaves it out.
- **Response:** put anything that must never happen in the deny lists in
  `setup/setup-seats.fish`.

## Bash deny rules match by prefix

- **Symptom:** a denied command runs anyway in a different form.
- **Cause:** `Bash(git push:*)` blocks commands that start with `git push`, but not
  `git -C repo push`.
- **Response:** treat Bash deny rules as guard rails against accidents, not as a sandbox.

## Information hiding lives in the prompts

- **Symptom:** a Peer refers to coordination details.
- **Cause:** `PEER.md` doesn't mention the Lead or Paseo, and the deny list blocks
  `mcp__paseo`, but a Peer can still read any file in the repository, including
  `WORKSPACE_PROTOCOL.md`.
- **Response:** none needed. The hiding reduces noise; it doesn't keep secrets.

## HTML comments are stripped from `CLAUDE.md`

- **Symptom:** none; this is useful behavior.
- **Cause:** Claude Code removes `<!-- ... -->` comments before loading `CLAUDE.md`. Files read
  with a tool, such as `WORKSPACE_PROTOCOL.md`, keep their comments.
- **Response:** put maintainer notes in the seat prompts in HTML comments; they cost the seat
  no context.

## Plugin updates break skill symlinks

- **Symptom:** a seat loses a skill after `claude plugin update`.
- **Cause:** plugin skill paths contain the version number, so an update leaves the symlinks
  pointing at a directory that no longer exists.
- **Response:** rerun `setup/setup-seats.fish` after every plugin update.

## Seats clean up the shared transcript directory

- **Symptom:** your own old Claude Code transcripts disappear.
- **Cause:** every seat's `projects` directory is a symlink to the shared
  `~/.claude/projects`. On startup, a seat deletes transcripts older than its own
  `cleanupPeriodDays`, including yours, and this can't be undone.
- **Response:** the script copies `cleanupPeriodDays` from your `~/.claude/settings.json` into
  every seat's settings, so a seat never keeps fewer days than you do. Keep the key out of
  `setup/seat-settings.base.json`, and rerun the script after you change your own value.

## The 16 KB prompt budget is self-imposed

- **Symptom:** the script fails a prompt that Claude Code would load without complaint.
- **Cause:** the runtime loads larger files. The budget exists because every line costs context
  on every turn, and rules at the end of a long file get skimmed.
- **Response:** when a prompt exceeds the budget, cut content rather than raising the limit.
