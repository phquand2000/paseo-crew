# Environment reference

This page lists behavior you can't infer from the config. Each entry gives the symptom, the
cause, and the response. Entries follow the order of the setup steps.

It holds Paseo and kit behavior. Anything true of one coding agent rather than of the kit lives
in that harness's notes, so swapping a harness doesn't invalidate this page:
[harness/claude/NOTES.md](harness/claude/NOTES.md),
[harness/pi/NOTES.md](harness/pi/NOTES.md), [harness/codex/NOTES.md](harness/codex/NOTES.md).

## A harness fact isn't where you expect it

- **Symptom:** you need to know where a seat's skills go, which file it reads as a prompt, or
  what blocks a tool for it, and this page doesn't say.
- **Cause:** those differ per coding agent, so they are data, not prose:
  `harness/<id>/harness.json` holds them and `harness/<id>/NOTES.md` says how each was
  established. `seats.json` says which harness hosts each role.
- **Response:** read the manifest field, not a doc. `configDirEnv`, `promptFile`, `skillsDir`,
  `promptComments`, `contextFile`, `deny.mechanism`, `guards.hookProtocol`, and `skillLoad`
  answer most questions; `jq -r '.seats[] | "\(.role): \(.harness)"' seats.json` says whose
  answer applies.

## Provider changes don't take effect

- **Symptom:** after you edit `~/.paseo/config.json`, agents still behave as before.
- **Cause:** Paseo has no file watcher; the daemon keeps the config it loaded.
- **Response:** run `paseo reload` after every edit to the file. A reload updates providers the
  daemon already knows, but it builds no snapshot for a new one: a provider `add-project.fish`
  just created is listed by `paseo status` and still fails `create_agent` with "Provider … is
  not available" until you run `paseo daemon restart`.

## The Lead and Supervisor have no Paseo tools

- **Symptom:** a coordinating seat can't call `create_agent` or `list_models`.
- **Cause:** Paseo's tools reach agents only when `daemon.mcp.injectIntoAgents` is `true`.
- **Response:** set it to `true` and reload. It applies to every agent the daemon starts, which
  is why the setup script reports it instead of changing it.

## A seat runs normally without its profile

- **Symptom:** a seat works but ignores its prompt.
- **Cause:** each harness reads a shared config directory unless its `configDirEnv` points
  somewhere else, and that shared directory carries none of the seat's prompts. Nothing reports
  an error.
- **Response:** the "Verify that each seat reads its own prompt and skills" step in SETUP.md
  catches this. `setup-seats.fish` also compares each provider's `configDirEnv` value with the
  profile directory it built.

## A harness is newer than the version its facts were checked on

- **Symptom:** `--check` prints that a manifest records its skills directory as verified on one
  version while the machine runs another.
- **Cause:** `verified` in a manifest is the version its fields were established on, by running
  a seat rather than by reading documentation. An upgrade can move a skills directory or rename
  a tool without any error.
- **Response:** run `fish setup/setup-seats.fish --check --probe`. It asks each seat's harness
  which skills it loads and fails with the name of any linked skill the harness would not offer.
  When it passes, set `verified` to the version you confirmed and note in that harness's
  `NOTES.md` how you confirmed it.

## A skill gate holds only where a loaded skill can be recognised

- **Symptom:** `setup-seats.fish` refuses to build, saying a gated role is on a harness with
  `skillLoad.transcriptMatch` of null.
- **Cause:** a gate blocks a call until its skill is loaded, which means the guard has to be
  able to tell a loaded skill from an unloaded one. On a harness where that shape is unknown,
  a gate would silently pass everything.
- **Response:** keep the gated role on a harness whose gate holds, or settle that harness's
  field first and record how. Failing closed is deliberate: a gate that silently passes is worse
  than no gate, because the prompt still promises one.

## A seat loads a skill only if it decides to

- **Symptom:** a seat works without the skill its task calls for, or loads one skill and none of
  the files that skill points at.
- **Cause:** a harness puts only skill names and descriptions in the system prompt and leaves
  the agent to open the `SKILL.md` itself. Pi's own documentation says models don't always do
  this, and two evaluation runs recorded a Lead skipping `review-orchestration` and `integration`
  though `LEAD.md` said to load them. Nothing reports the miss.
- **Response:** three layers, in order of strength. The prompts carry it, and each skill opens
  the files it depends on as a step of its own. `seats.json`'s `skillGates` then refuse the call
  a skill owns until that skill is loaded, which is what actually changed the outcome; the guard
  reads the session transcript, so a load through the harness's skill tool or a read of the
  `SKILL.md` both count. Last, a seat that keeps missing one particular skill can be forced with
  the harness's `skillLoad.force` form; on Pi that expansion happens before the model's turn and
  leaves no tool call, so it does **not** satisfy a gate.
- **Add a gate only for a skill a seat has been observed to skip.** Each gate costs the seat one
  tool call it would otherwise choose, and a gate on a step the model already does right is a
  rule without a failure behind it.

## The Peer's model list comes from its harness

- **Symptom:** `peer-SLUG` offers every model that harness's login can reach.
- **Cause:** a seat whose role names no `models` in `seats.json` gets no `models` list, so Paseo
  asks the harness. An empty `models` list likewise means the full runtime catalog, not "nothing
  to run".
- **Response:** those seats' agent profiles name the model (`add-project.fish --model`), and the
  profile guard blocks a Lead's or Supervisor's launch on any other. To cap launches from the
  app as well, give the role a `models` list in `seats.json`.

## Paseo tool access is set per provider ID

- **Symptom:** a Peer can see `create_agent` or other Paseo tools.
- **Cause:** `paseoTools` applies to the exact provider ID and isn't inherited from `extends` or
  from the agent that creates the Peer. A harness reaches Paseo's tools only through its own
  adapter, and Paseo carries the profile's MCP file into each launch.
- **Response:** keep `paseoTools.enabled: false` on every seat whose manifest sets
  `deny.paseoToolsOff` (the setup script does it), keep the harness's MCP adapter out of the
  profile, and keep any `paseo` server out of its MCP file.

## Enforcement differs by harness

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** prompts are guidance. Where the blocking happens is the manifest's
  `deny.mechanism`: a Paseo `disallowedTools` list, guard hooks, or a guard extension. Paseo
  applies `disallowedTools` only to some of its providers, so a role moved to another harness can
  lose a deny list without any error; `setup-seats.fish` says so when a harness has none. The
  guards themselves are shared. `lead-guard.sh` checks each write against the repository: the
  Lead may write only `.seatworks/`, `docs/`, `doc/`, `AGENTS.md`, `CLAUDE.md`, and `CONTEXT.md`,
  the Supervisor only `.seatworks/`, and the watcher only its log under
  `.seatworks/records/attention/`; files outside the repository stay writable.
  `profile-guard.sh` holds a Supervisor's and Lead's `create_agent`, `update_agent`,
  `send_agent_prompt`, `create_schedule`, and `update_schedule` calls to each provider's profile
  model and mode, blocks `set_agent_mode`, and blocks any provider without a profile.
  `skill-guard.sh` refuses a gated call until its skill is loaded. `watcher-guard.sh` looks up
  the target of the watcher's `send_agent_prompt` with `paseo ls`, so `paseo` must be on the
  daemon's PATH, and lets it reach only its own project's Supervisor, read from
  `SEATWORKS_SLUG`. Each guard blocks when jq is missing.
- **Response:** put anything that must never happen in the deny list in `seats.json`, in a
  shared guard under `harness/common/guards/`, or in a harness's own guard extension.
  `harness/common/hook-io.sh` writes each guard's refusal in the form the seat's harness
  expects, so one guard body serves every harness, and a manifest's `guards.dir` says which
  directory its seats install from.

## Command guards are guard rails, not sandboxes

- **Symptom:** a blocked command runs anyway in a different form.
- **Cause:** a deny entry like `Bash(git push:*)` matches by prefix, so `git -C repo push`
  gets through. The Peer's guard catches that form and also blocks `gh`, but it ignores quoted
  strings, so `sh -c 'git push'` still runs. `lead-guard.sh` reads a command's redirects and
  file-writing commands; a write made inside an interpreter or a nested shell, such as
  `python -c`, `node -e`, or `sh -c`, is outside its scope. `skill-guard.sh` recognises a merge
  by matching `git merge` and `git cherry-pick` at a command position, so it passes
  `git merge-base` and a quoted mention, and a merge reached through an interpreter escapes it.
  No guard blocks other network commands such as `curl`; the Supervisor's `seat-safety-review`
  skill checks for that.
- **Response:** treat the guards as protection against accidents. Keep credentials that could
  do damage out of the Peer's environment.

## Information hiding lives in the prompts

- **Symptom:** a Peer refers to coordination details, or to a note meant for maintainers.
- **Cause:** a Peer can read any file in the repository, including everything in `.seatworks/`:
  the Lead's prompt and skills and the workspace protocol. A harness whose `promptComments` is
  `shown` also loads HTML comments verbatim.
- **Response:** keep maintainer notes out of `.seatworks/PEER.md` and `.seatworks/REVIEWER.md`
  (the setup script fails on `<!--` for any seat whose harness shows comments), and out of every
  skill such a seat loads. The hiding reduces noise; it doesn't keep secrets. A seat whose role
  has `hidesOrchestration` also has its prompt and skills checked for the words `paseo`,
  `supervisor`, `watcher`, and `seat`.

## The repository's instruction file depends on the harness

- **Symptom:** one seat ignores constraints that another follows.
- **Cause:** harnesses disagree on which file they read. The manifest's `contextFile` says which
  one, and `contextFileNeedsPointer` says whether that file has to point at `AGENTS.md`.
- **Response:** keep constraints in `AGENTS.md`, and make `CLAUDE.md` contain `@AGENTS.md`, so
  every harness converges on one source.

## Paseo's own skills reach the seats only through the setup script

- **Symptom:** a Lead or Supervisor doesn't know a Paseo feature such as workspace scripts or
  profiles, or a Peer starts talking about Paseo.
- **Cause:** Paseo's app installs its orchestration skills (`paseo`, `paseo-committee`, and
  others) into shared skill directories. A seat whose skills live under its own profile never
  sees those copies; a harness that also loads a directory listed in its `sharedSkillDirs` gives
  them to every seat on it, the Peer's included.
- **Response:** leave that install off in the app. The setup script links `paseo` from Paseo's
  package into the profiles of the roles whose `extraSkills` name it, so it follows Paseo
  updates.

## A shared skill directory reaches every seat on that harness

- **Symptom:** a seat has skills that aren't in its allowlist.
- **Cause:** a directory in the manifest's `sharedSkillDirs` sits outside the seat's config
  directory, so every profile on that harness loads it. For Pi that is `~/.agents/skills`.
- **Response:** move skills the seat shouldn't see out of it. The setup script prints how many
  skills each such directory holds, per harness that loads it.

## `list_profiles` shows every project's profiles

- **Symptom:** a Lead in one project sees another project's seats, or starts a Peer that loads
  the wrong project's prompt and skills.
- **Cause:** profiles live in one global list, `daemon.agentProfiles`, and the tool returns all
  of it: there is no project or working-directory filter. A provider from another project
  carries that project's `SEATWORKS_REPO` and its own config-directory value, so a seat launched
  on it reads that project's `.seatworks/`.
- **Response:** `profile-guard.sh` compares the target provider's `env.SEATWORKS_REPO` with the
  launching seat's and blocks a `create_agent` or `create_schedule` across projects, naming this
  project's provider strings instead; a provider with no `SEATWORKS_REPO` is blocked too, since a
  seat on it would load no project prompt. Messaging another project's Supervisor still works,
  because `send_agent_prompt` is how cross-project work is relayed.

## `list_profiles` decides how the Lead launches Peers

- **Symptom:** a Lead picks a different model or thinking level for each Peer, or asks which
  provider to use.
- **Cause:** without agent profiles, `list_profiles` returns nothing and the Lead falls back to
  guessing from `list_models`. Profiles live in `daemon.agentProfiles` in the Paseo config.
- **Response:** `setup/add-project.fish` adds one profile per seat, composed from `seats.json`: a
  role's `models` supplies its model and `isDefault` thinking option (Supervisor Opus 5 `high`,
  Lead Opus 5 `medium`, watcher Haiku), a role with none takes `--model` (default
  `zai/glm-5.3`) and its own `thinking`, and its `notes` say which dispositions use it and how
  the thinking level varies. A `modeId` is set only for a harness whose
  `provider.profileModeId` names one. Every rerun restores the notes from `seats.json`, so
  change them there rather than in the config, and keep one profile per seat. A rerun never
  changes an existing profile's model: to move a seat to another model, edit that profile's
  `model` in the config and run `paseo reload`; the profile guard follows it.

## `settings.modeId` and a harness that has no modes

- **Symptom:** a seat stops to ask permission for every tool, or `create_agent` fails with
  "Invalid mode … Available modes: (none)".
- **Cause:** Paseo passes `create_agent`'s `settings.modeId` straight to the harness, overriding
  a seat's own default mode, and falls back to `auto` when the field is empty. A harness with no
  modes rejects any mode ID.
- **Response:** the manifest's `hasModes` and `provider.profileModeId` say which case a seat is
  in, and its agent profile carries a `modeId` only in the first. Copy `modeId` and
  `thinkingOptionId` from the profile when you create the seat; the profile guard blocks any
  other mode, and for a harness without modes it tells you to pass none.

## Running agents keep the old rules

- **Symptom:** after you change a prompt, a guard, or a deny list, some agents follow the old
  version.
- **Cause:** an agent keeps what it started with until its session ends. Seats spawned
  afterwards pick up prompts, settings, extensions, and skills immediately.
- **Response:** archive the old agents and delete their schedules and heartbeats, so that two
  versions of the rules don't run side by side. A seat rename is the same case, and worse: a
  running agent holds the old profile path, so archive every agent before
  `setup/migrate-seat-names.fish --apply`.

## Kit template edits don't reach existing projects

- **Symptom:** after you edit `project/LEAD.md` or a skill under `project/skills/` in the kit, a
  project's seats still follow the old text.
- **Cause:** `setup/add-project.fish` copies the templates into `REPO/.seatworks/` once and a
  plain rerun never overwrites them, and the project's profiles link to that copy. The setup
  script finds a project's `.seatworks/` through `env.SEATWORKS_REPO` on the provider of the role
  marked `anchor` in `seats.json`.
- **Response:** send a change to a seat prompt, skill, or guard to the kit as a diff. Guards are
  linked from the kit; prompts and skills reach a project through
  `fish setup/add-project.fish REPO_DIR --refresh`, which replaces them, and the workspace
  protocol while it is still the unfilled template, with the kit's versions, keeping each old
  copy under the git-ignored `.seatworks/records/drafts/refresh-STAMP/`. Put project-only rules
  in `AGENTS.md` or the filled-in `.seatworks/WORKSPACE_PROTOCOL.md`, which refresh never
  touches, like `NOTEBOOK.md`. Any rerun also restores the agent profiles' notes and, after the
  kit moves, the providers' kit and profile paths. If the repository moves, set
  `env.SEATWORKS_REPO` on the anchor role's provider to the new path and rerun add-project there
  with `--slug SLUG`; it updates the other providers.

## A template that names a seat has to name it as ROLE-SLUG

- **Symptom:** after `add-project.fish`, a prompt or skill refers to `peer` or `reviewer` where a
  provider name was meant, or an ordinary sentence gains a slug.
- **Cause:** seats are named for their roles, so `peer` and `reviewer` are also ordinary words in
  these prompts. The script substitutes exactly `ROLE-SLUG`, which is unambiguous, and nothing
  else.
- **Response:** in `project/` and `examples/`, always write a provider as `peer-SLUG`,
  `peer-ro-SLUG`, `reviewer-SLUG`, `lead-SLUG`, `supervisor-SLUG`, or `watcher-SLUG`, never as a
  bare role word in code font.

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

- **Symptom:** the Supervisor finds no Watcher profile, or `setup-seats.fish` notes that
  `watcher-SLUG` (or another seat) doesn't exist yet.
- **Cause:** the watcher runs on a small model and reads its prompt on every sweep, so it has a
  seat of its own whose instruction file is the short `.seatworks/WATCHER.md`, with the trigger
  table in it, rather than the Supervisor's prompt. Projects added before a seat existed lack its
  provider, profile, and prompt; `seats.json` marks such a role `required: false` and the script
  says how to add it. Paseo sets `PASEO_AGENT_ID` in every agent's environment, which is how the
  Supervisor gives the watcher its own ID.
- **Response:** run `fish setup/add-project.fish REPO_DIR` without `--refresh`; it adds the
  missing providers, profiles, and files, keeps the project's prompts, and reloads Paseo.

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

## The Reviewer and the read-only Peer are read-only by guard

- **Symptom:** a Reviewer or read-only Peer reports "Editing files is not available in this role."
- **Cause:** a role marked `readOnly` in `seats.json` gets `SEATWORKS_READ_ONLY=1` on its
  provider, which makes its guard block the harness's write and edit tools and the git commands
  that change the repository. Shell redirection still works, so temporary files under `$TMPDIR`
  remain possible, and so does a determined write.
- **Response:** expected; send work that edits files to `peer-SLUG`. The guard prevents
  accidents rather than sandboxing; the setup script checks that the variable stays on every
  read-only provider.

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

## The 16 KB prompt budget is self-imposed

- **Symptom:** the script fails a prompt that a harness would load without complaint.
- **Cause:** every harness loads larger files. The budget, `promptBudget` in `seats.json`, exists
  because every line costs context on every turn, and rules at the end of a long file get
  skimmed.
- **Response:** when a prompt exceeds the budget, cut content rather than raising the limit.
