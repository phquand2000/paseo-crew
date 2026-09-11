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
  `PI_CODING_AGENT_DIR`, Pi reads `~/.pi/agent`. Neither carries the seat's prompts, and nothing
  reports an error.
- **Response:** the "Verify that each seat reads its own prompt" step in SETUP.md catches this.

## The Peer's model list comes from Pi

- **Symptom:** `pi-peer-SLUG` offers every model your Pi login can reach.
- **Cause:** `pi-peer-SLUG` has no `models` list, so Paseo asks Pi. For the Claude seats, an empty
  `models` list likewise means the full runtime catalog, not "nothing to run".
- **Response:** name the Peer model in the repository's `.seatworks/WORKSPACE_PROTOCOL.md`, and list
  `models` explicitly on a provider to cap its model and effort.

## Paseo tool access is set per provider ID

- **Symptom:** a Peer can see `create_agent` or other Paseo tools.
- **Cause:** `paseoTools` applies to the exact provider ID and isn't inherited from `extends` or
  from the agent that creates the Peer. Pi receives Paseo tools only through the
  `pi-mcp-adapter` extension, and Paseo carries the profile's `mcp.json` into each launch.
- **Response:** keep `paseoTools.enabled: false` on `pi-peer-SLUG` (the setup script sets it), keep
  `pi-mcp-adapter` out of the Peer profile, and keep any `paseo` server out of its `mcp.json`.

## Running agents keep the old rules

- **Symptom:** after you change a prompt, a guard, or a deny list, some agents follow the old
  version.
- **Cause:** an agent keeps what it started with until its session ends. Seats spawned
  afterwards pick up prompts, settings, extensions, and skills immediately.
- **Response:** archive the old agents and delete their schedules and heartbeats, so that two
  versions of the rules don't run side by side.

## Kit template edits don't reach existing projects

- **Symptom:** after you edit `project/LEAD.md` or a skill under `project/skills/` in the kit, a
  project's seats still follow the old text.
- **Cause:** `setup/add-project.fish` copies the templates into `REPO/.seatworks/` once and
  never overwrites them, and the project's profiles link to that copy. The setup script finds a
  project's `.seatworks/` through `env.SEATWORKS_REPO` on its `claude-lead-SLUG` provider.
- **Response:** edit the project's copy, or carry kit changes in with
  `fish setup/add-project.fish REPO_DIR --refresh`. It replaces the seat prompts and skills with
  the kit's versions, keeps each replaced copy under `.seatworks/records/drafts/refresh-STAMP/`
  so the project's own edits can be carried back, and never touches `NOTEBOOK.md` or
  `WORKSPACE_PROTOCOL.md`. If the repository moves, update `SEATWORKS_REPO` on both of its
  providers and rerun the setup script.

## Claude seats: `settings.modeId` overrides the permission mode

- **Symptom:** a Claude seat stops to ask permission for every tool.
- **Cause:** Paseo passes `create_agent`'s `settings.modeId` straight to the SDK, overriding
  the seat's `permissions.defaultMode`. When the field is empty, the mode falls back to `auto`.
- **Response:** pass `settings.modeId: "bypassPermissions"` and a `thinkingOptionId` when you
  create a Claude seat.

## Pi seats reject `settings.modeId`

- **Symptom:** `create_agent` on `pi-peer-SLUG` fails with "Invalid mode … Available modes: (none)".
- **Cause:** Pi has no modes, so Paseo rejects any mode ID for it.
- **Response:** pass only `settings.thinkingOptionId` for Pi agents.

## Enforcement differs between Claude and Pi

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** prompts are guidance. For Claude seats, blocking happens in the provider's
  `disallowedTools` and, for the Lead, in the `PreToolUse` hook `claude/lead-guard.sh`, which
  blocks writes to repository files outside `.seatworks/`, `docs/`, `AGENTS.md`, and
  `CLAUDE.md`. A seat's `permissions.deny` isn't equivalent, so the role settings in `claude/`
  leave it out. Pi has no permission system and ignores `disallowedTools`, so the Peer's only
  enforcement point is the `tool_call` hook in `pi/extensions/peer-guard.ts`.
- **Response:** put anything that must never happen in the deny lists, the Lead guard, or the
  guard extension.

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
- **Cause:** a Peer can read any file in the repository, including everything in `.seatworks/`:
  the Lead's prompt and skills and the workspace protocol. Pi also loads `APPEND_SYSTEM.md`
  verbatim: unlike Claude Code, it doesn't strip HTML comments.
- **Response:** keep maintainer notes out of `.seatworks/PEER.md` (the setup script fails on
  `<!--`). The hiding reduces noise; it doesn't keep secrets.

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

## Paseo's own skills reach the seats only through the setup script

- **Symptom:** a Lead or Supervisor doesn't know a Paseo feature such as workspace scripts or
  profiles, or a Peer starts talking about Paseo.
- **Cause:** Paseo's app installs its orchestration skills (`paseo`, `paseo-committee`, and
  others) into `~/.claude/skills` and `~/.agents/skills`. Claude seats read their own profiles
  and never see those copies, while Pi loads `~/.agents/skills` for every profile, the Peer's
  included.
- **Response:** leave that install off in the app. The setup script links `paseo` from
  Paseo's package into the Lead's and Supervisor's profiles, so it follows Paseo updates.

## `list_profiles` decides how the Lead launches Peers

- **Symptom:** a Lead picks a different model or thinking level for each Peer, or asks which
  provider to use.
- **Cause:** without agent profiles, `list_profiles` returns nothing and the Lead falls back to
  guessing from `list_models`. Profiles live in `daemon.agentProfiles` in the Paseo config.
- **Response:** `setup/add-project.fish` adds one profile per seat, with a single Peer profile
  whose notes say how the disposition and thinking level vary. Edit the notes rather than
  adding Peer profiles.

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

## An archived worktree takes its agents' timelines with it

- **Symptom:** `paseo logs` or `get_agent_activity` for a finished Peer fails with "Working
  directory does not exist".
- **Cause:** Paseo loads an agent's timeline from its working directory, and `archive_workspace`
  removes the worktree, so agents that ran there can no longer be read, even archived ones.
- **Response:** before archiving a worktree workspace, keep what a retrospective will need: the
  Peer's handoff, in the acceptance summary or the ExecPlan.

## A message to a running agent replaces its turn

- **Symptom:** a Peer stops mid-step, or a Lead gets a Peer's "finished" notification with a
  partial answer and never hears the real result.
- **Cause:** `send_agent_prompt` replaces a running turn; only finish notifications and
  heartbeats steer into it. A finish notification fires once, on the first idle, to whoever
  sent the prompt, so a prompt from anyone but the Lead ends the Lead's wait early and sends
  the Peer's next result to the sender.
- **Response:** send anything meant for a Peer through its Lead (the Supervisor's `CHECK:`
  questions work this way), and message a running agent only when it can't wait.

## The watcher has its own seat

- **Symptom:** the Supervisor finds no Watcher profile, or `setup-seats.fish` notes that a
  project has no `claude-watcher-SLUG` yet.
- **Cause:** the watcher runs on Haiku and reads its prompt on every sweep, so it has a seat of
  its own whose `CLAUDE.md` is the short `.seatworks/WATCHER.md`, with the trigger table in it,
  rather than the Supervisor's prompt. Projects added before the seat existed lack its
  provider, profile, and prompt. Paseo sets `PASEO_AGENT_ID` in every agent's environment,
  which is how the Supervisor gives the watcher its own ID.
- **Response:** run `fish setup/add-project.fish REPO_DIR --refresh`; it adds what is missing and
  reloads Paseo.

## The Reviewer runs Open Code Review in one of two modes

- **Symptom:** a Reviewer's handoff reports `OCR mode: delegation`, or OCR's comments come back
  in another language.
- **Cause:** the `ocr-review` skill runs Open Code Review's full review, on OCR's own model, only
  when `ocr llm test` succeeds; otherwise it uses delegation mode, where OCR selects the files
  and rules and the Reviewer's own model reviews. OCR's settings, including its model and key,
  are global, in `~/.opencodereview/config.json`, and the `language` key sets the comment
  language.
- **Response:** to give reviews a second model family, configure one with `ocr config provider`
  and check it with `ocr llm test`. That sends the code under review to that provider, which is
  the Human's call. `ocr config set language English` keeps comments in English.

## The Reviewer is read-only by guard

- **Symptom:** a Reviewer reports "Editing files is not available in a review."
- **Cause:** `pi-reviewer-SLUG` sets `SEATWORKS_READ_ONLY=1`, which makes `peer-guard.ts` block
  Pi's `write` and `edit` tools and git commands that change the repository. Shell redirection
  still works, so temporary files under `$TMPDIR` remain possible, and so does a determined
  write.
- **Response:** expected. The guard prevents accidents rather than sandboxing; the setup script
  checks that the variable stays on the provider.

## Heartbeats end with their agent

- **Symptom:** a watcher's sweeps stop, an old heartbeat seems to linger, or `list_schedules`
  doesn't show a heartbeat you created.
- **Cause:** a heartbeat targets one agent, and Paseo completes it when that agent is archived.
  `list_schedules` and `paseo schedule ls` show only schedules that start new agents, so no tool
  lists heartbeats; each one is a file in `~/.paseo/schedules/`, and there is no update tool.
- **Response:** name every heartbeat: creating one again with the same name for the same agent
  updates it instead of adding a second, so a seat that isn't sure a heartbeat exists can
  simply create it. Note the ID too, for `delete_heartbeat`. Archive the watcher to stop its
  sweeps.

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
- **Response:** each `claude/<role>.settings.json` must carry the same `cleanupPeriodDays` as
  your `~/.claude/settings.json`, or none when you set none. The script checks this and names
  the file to fix by hand; rerun it after you change your own value.

## The 16 KB prompt budget is self-imposed

- **Symptom:** the script fails a prompt that the runtime would load without complaint.
- **Cause:** both runtimes load larger files. The budget exists because every line costs context
  on every turn, and rules at the end of a long file get skimmed.
- **Response:** when a prompt exceeds the budget, cut content rather than raising the limit.
