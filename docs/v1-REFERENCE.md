# Environment reference

Behavior you can't infer from the config, as symptom, cause and response. Facts about one coding
agent live in that harness's `NOTES.md` under [harness/](harness/), so this page names none.

## A harness fact isn't here

- **Symptom:** you need where a seat's skills go, which file it reads as a prompt, or what blocks a
  tool for it.
- **Cause:** those differ per coding agent, so they are data in `harness/<id>/harness.json`, with
  how each was established in `NOTES.md`.
- **Response:** read `configDirEnv`, `promptFile`, `skillsDir`, `contextFile`,
  `settings.limitsNote` or `skillLoad` there; `seats.json` says which harness a role uses.

## Config edits don't take effect

- **Symptom:** after editing `~/.paseo/config.json`, agents behave as before.
- **Cause:** the daemon keeps the config it loaded. A reload updates known providers but builds
  nothing for a new one, which then fails with "Provider … is not available".
- **Response:** `paseo reload` after an edit, and `paseo daemon restart` after adding a provider.
  Running agents keep what they started with: archive them after a prompt, skill or settings
  change, and archive every agent before moving a role to another harness.

## A seat belongs to the project it starts in

- **Symptom:** a seat ignores its prompt and skills.
- **Cause:** the five providers carry no project. When a session opens, the plugin finds the
  nearest `.seatworks/`, reads the slug, and sets the harness's `configDirEnv` to
  `<profileRoot>/<role>-<slug>` plus `SEATWORKS_REPO`, `SEATWORKS_SLUG` and `SEATWORKS_SEAT`. It
  refuses an interactive session outside a project or without that directory. Without the plugin
  the room execs the agent on its shared config, which has none of the seat's files.
- **Response:** start seats in the project's workspace, and check `paseo plugin ls` shows
  `seatworks` running.

## The room rewrites the argv Paseo built

- **Symptom:** a seat runs with a flag no provider names.
- **Cause:** Paseo appends its own arguments after the provider's command, and a harness takes the
  last value of a repeated flag. `seat-room` applies the manifest's `provider.forceFlags`, replacing
  `--flag value` or `--flag=value` in place or appending it.
- **Response:** put a flag the kit needs in `provider.forceFlags`, not in the provider.

## Models and modes come from the profile

- **Symptom:** a launch on another model is refused, a hand-edited profile changes back, or a
  harness rejects a mode with "Available modes: (none)".
- **Cause:** agent profiles are global, one per role, rewritten on every setup run from the role's
  `byHarness` entry for its current harness, else the manifest's `provider.defaultModel`. The
  plugin sets each launch's model from a project pin or the profile and its mode from the profile,
  fills a missing thinking option, drops one where the manifest's `hasThinking` is false, and
  refuses a model the role doesn't offer.
- **Response:** change a model for every project under `byHarness` in `seats.json`, for one project
  under `models` in `project.json`; never pass another model to `create_agent`.

## Paseo tools reach seats through two switches

- **Symptom:** a coordinating seat has no `create_agent`, or a Peer sees Paseo tools.
- **Cause:** `daemon.mcp.enabled` and `daemon.mcp.injectIntoAgents` give Paseo tools to every agent
  the daemon starts. A provider's `paseoTools` trims them per role, and `extends` doesn't inherit it.
- **Response:** setup sets both switches and copies each role's `paseoTools` to its provider. It is
  a catalog limit, not a boundary: role settings also refuse the `paseo` CLI.

## Limits are native settings

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** a prompt is guidance. What holds is the coding agent's own settings in the manifest's
  `settings.source` and `settings.roleSource`, linked or merged unchanged. Paseo's
  `disallowedTools` isn't read by every provider, so setup deletes it. Not every harness has a
  filesystem sandbox; without one, where a seat writes rests on command rules and its brief. On
  some harnesses a refused call ends the seat's turn instead of returning an error; `NOTES.md` says.
  Neither can allow-list writes inside the repository, so which files the Supervisor and the Lead
  write is a prompt line. The plugin enforces launches: model, project, and the parent's `mayStart`.
  The files that set limits (`seats.json`, the Paseo config, seat settings) live outside the
  repository, and the sandboxed harness's settings deny edits to them.
- **Response:** put a tool limit in the role's settings under `harness/<id>/` in verified keys, a
  Paseo-tool limit in `paseoTools`, and a launch rule in the plugin, and leave enforced limits out
  of the prompt. Kit changes reach the Human as a diff; no seat runs setup.

## Command rules match text

- **Symptom:** a refused command runs in another form.
- **Cause:** a rule matches command text: `git -C repo push` slips a prefix rule, and `python -c`
  slips any pattern. Nothing blocks network commands.
- **Response:** treat command rules as protection against accidents, and keep damaging credentials
  out of every seat's environment.

## A harness offers more tools than seats.json names

- **Symptom:** a seat calls a tool no prompt mentions.
- **Cause:** a deny list removes only what it names, harnesses add tools between versions, and a
  feature's env switch doesn't always remove its tool.
- **Response:** measure the seat. Point it at a local listener that captures one request and answers
  400, launch it the way Paseo does (stream-json, not `-p`, which offers fewer tools) with the
  seat's config, and read `tools[].name`. A lead seat measured 26 tools, nine of which the role
  settings now deny. Redo it when `verified` moves.

## A seat gets only the skills seats.json chose

- **Symptom:** a repository's own skills don't reach a seat.
- **Cause:** harnesses discover skills from several roots by default, including the repository's.
  The kit turns off every root a harness lets it, through that harness's settings or forced flags,
  and setup reports drift. A root a harness can't turn off is under `sharedSkillDirs` in its
  manifest and in its `NOTES.md`.
- **Response:** expected; a skill the kit didn't choose was never checked against the role's
  `hidesWords`. Paseo's own orchestration skills reach a seat only through a role's `extraSkills`,
  and no role names them.

## A seat opens a skill only if it decides to

- **Symptom:** a seat works without the skill its task needs.
- **Cause:** a harness lists skill names and descriptions and leaves opening them to the model. A
  replica Peer seat carried all its skills in its system prompt and no session opened one; two
  evaluation runs saw a Lead skip skills its prompt named.
- **Response:** every-session behavior goes in the prompt; the Lead names a Peer's skills in the
  brief; a skill that keeps being missed can be forced with the manifest's `skillLoad.force` form.

## The instruction file depends on the harness

- **Symptom:** one seat ignores constraints another follows.
- **Cause:** harnesses read different files, named by the manifest's `contextFile`.
- **Response:** keep constraints in `AGENTS.md`; `add-project.fish` writes an `@AGENTS.md` pointer
  where `contextFileNeedsPointer` is true.

## Information hiding lives in the prompts

- **Symptom:** a Peer mentions coordination details.
- **Cause:** a Peer or Reviewer can read all of `.seatworks/`; no setting hides a path. A harness
  whose `promptComments` is `shown` would read an HTML comment as a rule.
- **Response:** setup fails on an HTML comment in any prompt or skill and checks each against its
  role's `hidesWords`. The hiding reduces noise; it keeps no secrets.

## Template edits don't reach existing projects

- **Symptom:** a project's seats follow old prompt or skill text.
- **Cause:** `add-project.fish` copies templates once; seat directories link to the copy.
- **Response:** `fish setup/add-project.fish REPO_DIR --refresh` replaces `prompts/`, `guides/`
  and `skills/`, keeps the old copies in `.seatworks/records/drafts/refresh-STAMP/`, and leaves
  `records/`, `project.json` and a filled-in `WORKSPACE_PROTOCOL.md` alone. A project missing a
  newer seat gets it from a plain rerun. After moving a repository, rerun at the new path with the
  same `--slug`.

## The Lead cannot make a workspace

- **Symptom:** a Lead can't open a worktree for a parallel slice.
- **Cause:** its `paseoTools` disables the workspace tools and its settings deny the harness's
  worktree tools: in practice worktrees gave three writers one worktree and three timelines.
- **Response:** one writer per scope in the Lead's checkout. When parallel writers are worth it, the
  Human or Supervisor makes the workspace and hands over its ID; the Supervisor makes one per
  `DETOUR:`.

## Archiving loses agents and timelines

- **Symptom:** Peers vanish with their Lead, or a finished Peer's log fails with "Working directory
  does not exist".
- **Cause:** archiving an agent cascades to its subagents, only a person can detach one, and an
  agent's timeline is read from its working directory, which `archive_workspace` removes.
- **Response:** hand off a Lead after its Peers are accepted or detached, and keep a Peer's handoff
  in the acceptance or review record before archiving its worktree.

## A message to a running agent replaces its turn

- **Symptom:** a Peer stops mid-step, or a Lead gets a partial "finished" notification.
- **Cause:** `send_agent_prompt` replaces a running turn, and a finish notification goes once to
  whoever sent the last prompt. The plugin holds its own messages until the agent is idle.
- **Response:** send anything for a Peer through its Lead, and message a running agent only when it
  can't wait.

## A question goes one level up

- **Symptom:** an agent ends its turn with a question instead of opening a question prompt.
- **Cause:** only the Supervisor has an ask tool; every other seat's harness offers none or its
  settings deny it. An agent ends its turn with the question, Paseo tells its creator, and
  the creator answers. The Supervisor asks you only about how the project behaves. A Peer's
  unanswered `BLOCKED` becomes an attention event.
- **Response:** expected. A Lead you started yourself asks you in its reply.

## The watcher sweeps when the plugin wakes it

- **Symptom:** the watcher never sweeps, or its events never reach the Supervisor.
- **Cause:** nothing else schedules it. After a Lead, Peer or Reviewer turn ends, the plugin sends
  the project's watcher `SWEEP since TIME` at most once per `sweepMinutes`, retrying a minute later
  while it is busy. It logs each `ATTENTION:` block in `.seatworks/records/attention/` and sends it
  to the Supervisor when idle: `(urgent)` at once, `(log)` after `escalateAfter` sweeps in a row.
  It also raises marker lines, pushback unanswered for `pushbackMinutes`, and failed turns. These
  settings come from `project.json` under `attention`, else the watcher seat's `sweepMinutes`, two
  sweeps and three; an invalid one is logged once and defaulted. Held messages survive a reload in
  `~/.paseo/seatworks/outbox.json`; recurrence counts don't.
- **Response:** check `paseo plugin ls` and `paseo plugin logs seatworks`, and that the watcher and
  Supervisor run in the same project. A project missing the watcher seat gets it from
  `add-project.fish` without `--refresh`.

## The review tool scopes a review; it doesn't do it

- **Symptom:** a Reviewer reports `reviewable_count: 0`, or no findings for files the change
  touched.
- **Cause:** `ocr delegate` runs no model: `preview` returns files in scope and those excluded with
  an `exclude_reason`, filtered by extension, and `rule` returns rule text per file pattern.
- **Response:** `REVIEWER.md` reviews excluded files anyway from `git show --stat` and lists them in
  the handoff. A repository with its own standards ships a rule file the brief names.

## The Reviewer is the read-only lane

- **Symptom:** a Reviewer's write is refused, or an Architect Peer edits a file.
- **Cause:** the Reviewer's settings refuse edit, write and repository-changing git tools, though
  shell redirection can still write. An Architect or Scout is a writable Peer whose brief says
  `Owned scope none`; nothing enforces it.
- **Response:** send edits to `peer`, check an Architect's handoff Scope field, and run every
  read-only lane a skill opens on `reviewer`.

## Records grow unless trimmed

- **Symptom:** a plan, the workspace protocol or the notebook outgrows its template.
- **Cause:** seats had nowhere else to put a ruling or lesson; real protocols reached four times
  their template, much of it repeating other files. Nothing measures a record after a write.
- **Response:** compare a record with its template's headings when reading it, and trim or move
  what has another home. Section sizes live in `project/guides/PLANS.md`.

## The prompt budget is self-imposed

- **Symptom:** setup fails a prompt a harness would load.
- **Cause:** `promptBudget` and `promptLineBudget` in `seats.json` cap prompts because every line
  costs attention on every turn.
- **Response:** cut the prompt rather than raise the limit.
