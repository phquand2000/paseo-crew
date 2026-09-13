# Environment reference

This page lists behavior you can't infer from the config. Each entry gives the symptom, the
cause, and the response. Entries follow the order of the setup steps.

It holds Paseo and kit behavior. Anything true of one coding agent rather than of the kit lives
in that harness's own `NOTES.md` under [harness/](harness/), so swapping a harness doesn't
invalidate this page, and no entry here names a coding agent or its tools.

## A harness fact isn't where you expect it

- **Symptom:** you need to know where a seat's skills go, which file it reads as a prompt, or
  what blocks a tool for it, and this page doesn't say.
- **Cause:** those differ per coding agent, so they are data, not prose:
  `harness/<id>/harness.json` holds them and `harness/<id>/NOTES.md` says how each was
  established. `seats.json` says which harness hosts each role.
- **Response:** read the manifest field, not a doc. `configDirEnv`, `promptFile`, `skillsDir`,
  `promptComments`, `contextFile`, `settings.limitsNote`, and `skillLoad` answer most questions;
  `jq -r '.seats[] | "\(.role): \(.harness)"' seats.json` says whose answer applies.

## Provider changes don't take effect

- **Symptom:** after you edit `~/.paseo/config.json`, agents still behave as before.
- **Cause:** Paseo has no file watcher; the daemon keeps the config it loaded.
- **Response:** run `paseo reload` after every edit to the file. A reload updates providers the
  daemon already knows, but it builds no snapshot for a new one: a provider `setup-seats.fish`
  just composed is listed by `paseo status` and still fails `create_agent` with "Provider … is
  not available" until you run `paseo daemon restart`. The five providers are composed once, so
  this bites on a first install or when a role moves to another harness.

## The Lead and Supervisor have no Paseo tools

- **Symptom:** a coordinating seat can't call `create_agent` or `list_models`.
- **Cause:** Paseo's tools reach agents only when `daemon.mcp.enabled` and
  `daemon.mcp.injectIntoAgents` are both `true`.
- **Response:** `setup-seats.fish` sets both and reloads. They apply to every agent the daemon
  starts, not just this kit's: that one switch is also why every seat is offered Paseo's tools
  until its role's `paseoTools` trims them.

## A seat belongs to the workspace it starts in

- **Symptom:** a seat works but ignores its prompt and skills, or a provider name says only a
  role where you expected it to say which project.
- **Cause:** the five providers carry no project, since a provider's `env` is the same everywhere.
  Whenever a seat's session opens, the Paseo plugin walks up from the agent's working directory
  to the nearest `.seatworks/`, reads its `project.json` for the slug, and sets the harness's
  `configDirEnv` to `<profileRoot>/<role>-<slug>`, with `SEATWORKS_REPO`, `SEATWORKS_SLUG` and
  `SEATWORKS_SEAT`; it refuses a session with no `.seatworks/` or no such directory. The room,
  `harness/common/bin/seat-room`, execs the coding agent untouched when that variable is unset,
  which is how Paseo's own `--version` and catalog probes run. If the plugin is not running, a
  seat starts that way too and reads the harness's shared config directory, which carries none of
  the seat's prompts.
- **Response:** start a seat in the project you mean: a Paseo workspace does that, and
  `create_agent` defaults to the caller's. `paseo plugin ls` must show `seatworks` running.
  SETUP.md's "Verify that each seat reads its own prompt and skills" step catches the rest;
  `setup-seats.fish` checks that every provider runs the room and carries its role in
  `env.SEATWORKS_ROLE`.

## A project can pin a model per role

- **Symptom:** one project needs a role on a bigger or cheaper model than the rest.
- **Cause:** `daemon.agentProfiles` is global and has no project field, so a profile's model is
  the same everywhere. The Paseo plugin changes it instead: when a seat is created in a project
  that pins its role, the plugin sets that model, which Paseo stores with the agent.
- **Response:** name the role under `models` in `REPO/.seatworks/project.json`
  (`{"slug": "SLUG", "models": {"lead": "MODEL_ID"}}`), spelled the way that role's harness
  spells a model; `add-project.fish --model MODEL_ID` writes one entry per role whose
  `seats.json` entry names no `models`. A role the file doesn't name keeps its profile's model.
  Pin it here rather than passing another model to `create_agent`, which the Paseo plugin
  refuses.

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

## A seat loads a skill only if it decides to

- **Symptom:** a seat works without the skill its task calls for, or loads one skill and none of
  the files that skill points at.
- **Cause:** a harness puts only skill names and descriptions in the system prompt and leaves
  the agent to open the `SKILL.md` itself, and it often doesn't. Measured on this kit: a
  byte-exact replica of a Peer seat sends all eight of its skills in the system prompt under an
  instruction to read the matching one first, and no session on that harness has ever read one.
  Two evaluation runs recorded a Lead skipping the skills `LEAD.md` told it to load. Nothing
  reports the miss.
- **Response:** three layers, in order of strength. What a seat does every session is in its
  prompt, not in a skill, so there is nothing to skip. What it does sometimes is named by the Lead
  in the brief's `Skills` field, because a Peer left to route itself routes to none. Last, a seat
  that keeps missing one skill can be forced with the harness's `skillLoad.force` form in the
  message that starts the task.

## The Reviewer's model list comes from its harness

- **Symptom:** `reviewer` offers every model that harness's login can reach.
- **Cause:** a seat whose role names no `models` in `seats.json` gets no `models` list, so Paseo
  asks the harness. An empty `models` list likewise means the full runtime catalog, not "nothing
  to run".
- **Response:** those roles take their model from their agent profile, filled from the harness's
  `provider.defaultModel`, or from a pin in the project's `project.json`. The Paseo plugin
  refuses a launch on any other model, from a seat or from the app alike; give the role a
  `models` list in `seats.json` to offer more than one.

## Paseo offers its tools to every seat

- **Symptom:** a Peer can see `create_agent` or other Paseo tools.
- **Cause:** `daemon.mcp.injectIntoAgents` is one machine-wide switch, and before Paseo 0.8 it was
  the only one. From 0.8 a provider's `paseoTools` (`enabled`, `disabledTools`) decides which of
  those tools its seats are handed, on every harness alike; custom providers do not inherit it
  through `extends`.
- **Response:** set the role's `paseoTools` in `seats.json`; setup copies it to the role's
  provider, and a new seat gets the trimmed catalog after `paseo reload`. Paseo calls this a
  catalog limit, not a security boundary: a seat with a shell can still run the `paseo` CLI,
  which is why each harness's role settings also refuse `paseo` commands.

## A harness offers more tools than seats.json ever named

- **Symptom:** a seat calls something no prompt and no skill mentions, or you want to know what a
  seat actually holds.
- **Cause:** a deny list can only remove what you thought to name. A harness ships its own tool
  set and grows it between versions, and an environment variable that turns a feature off does
  not always take its tool out of the offered set: measured here, `CLAUDE_CODE_DISABLE_CRON` is on
  in `provider.env` and the three Cron tools were still offered.
- **Response:** measure the seat, don't read the changelog. Point the harness at a local listener
  that captures one request and answers 400, launch it with the seat's own config directory, role
  settings and `provider.env`, and read `tools[].name` out of the captured
  body. **Launch it the way the orchestrator does**, not with `-p`: a lead seat measured in
  `--output-format stream-json --input-format stream-json` mode holds three tools that `-p` never
  offers (`AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`), so a `-p` measurement undercounts.
  In that real shape a lead seat held 26 tools; nine of them — `Artifact`, `EnterWorktree`,
  `ExitWorktree`, `CronCreate`, `CronDelete`, `CronList`, `SendMessage`, `ListAgents`,
  `DesignSync` — were things this kit takes elsewhere: publishing to the web, making a worktree,
  scheduling, and reaching another agent outside the orchestrator. The role settings deny them
  now. Redo the measurement when a harness's `verified` version moves, the way
  `NOTES.md` treats every other fact read off a running seat.

## Enforcement differs by harness

- **Symptom:** a seat does something its prompt rules out.
- **Cause:** prompts are guidance. What holds is a native setting of the coding agent, in the
  files the manifest names under `settings.source` and `settings.roleSource`, which setup links or
  merges unchanged; `settings.limitsNote` says what each holds and how it was verified. Paseo's
  own `disallowedTools` would say it once for every harness, but one of its providers never reads
  it, so each harness keeps its own list and setup deletes any `disallowedTools` it finds on a
  provider. The two harnesses hold different things. One has a filesystem sandbox, so a shell
  write outside the working directory is refused whatever the command looks like; the other has
  none, so where a seat on it writes rests on command rules and its brief. Neither can say a write
  allow-list inside the repository, so which repository files the Supervisor and the Lead write
  is a line in their prompts, part of the job rather than a limit. Launches are not a setting's
  job: the Paseo plugin in `plugin/` sees every creation, from a tool, the CLI or a schedule, gives
  a seat its profile's model and mode, refuses a model the profile doesn't offer or a seat outside
  a project with `.seatworks/`, and archives one whose parent's `mayStart` doesn't name it or that
  runs outside the parent's project.
- **Response:** put a tool limit in the role's settings under `harness/<id>/`, in keys that
  harness's `NOTES.md` records as verified, and write it again for the new harness when a role
  moves. A limit on Paseo's own tools is the role's `paseoTools`, and one on launching or
  messaging agents belongs in the plugin. Leave a limit a setting enforces out of the prompt.

## Files that set a seat's limits live outside the repository

- **Symptom:** a seat's write outside the repository is refused on some seats and not on others.
- **Cause:** every file that decides what a seat may do lives out there: `seats.json`, which the
  Paseo plugin reads on every launch to see which roles the caller may start; the Paseo config,
  which holds the providers and profiles; and the seat's own settings file. A seat that could edit
  those could lift its own limits. On the sandboxed harness, which hosts the Supervisor and the
  Lead, the sandbox refuses a shell write outside the working directory, and edit deny rules name
  the Paseo config, the other harness's directory, the user settings file and the seat profiles'
  settings files. The
  other harness, which hosts the watcher, Peer and Reviewer, has no sandbox: the watcher's and
  Reviewer's edit and write tools are refused, a Peer's write outside the repository is held by
  its brief alone, and shell redirection on any of them can still write.
- **Response:** intended as far as it goes. A kit change is proposed to the Human as a diff and
  applied by them, which is what `SUPERVISOR.md` says; the Human runs the setup script, and no
  seat does.

## The Lead cannot make a workspace

- **Symptom:** a Lead has no `create_workspace`, or it reports that it cannot open a worktree for
  a parallel slice.
- **Cause:** the Lead's `paseoTools` disables `create_workspace`, `archive_workspace` and
  `rename_workspace`, and its role settings deny the harness's own worktree tools. A worktree buys
  isolation only when two writers hold genuinely disjoint scopes; what it produced in practice
  was three Engineers in one worktree, no isolation, and three timelines to reconcile at
  acceptance.
- **Response:** one writer per scope, in the Lead's own checkout, which is what `LEAD.md` now
  describes. When parallel writers really are worth it, the Human or the Supervisor makes the
  workspace and hands the Lead its ID; the Supervisor still creates one for a `DETOUR:`.

## Command rules match text, not behavior

- **Symptom:** a refused command runs anyway in a different form.
- **Cause:** a deny rule matches the command text. A rule that matches by prefix lets
  `git -C repo push` through; a pattern with `*` on both sides catches more forms but still misses
  a command assembled inside an interpreter such as `python -c` or `node -e`. On the sandboxed
  harness the sandbox still holds a write outside the working directory; on the other nothing
  holds a shell write. No rule blocks network commands such as `curl`, and the sandbox allowed an
  HTTPS request: a seat that can read the repository can always describe it to something outside,
  and this kit does not try to stop that.
- **Response:** treat command rules as protection against accidents. Keep credentials that could
  do damage out of every seat's environment.

## Records grow unless someone trims them

- **Symptom:** a plan, the workspace protocol or the notebook runs past the size its template
  gives.
- **Cause:** the records the seats keep all grew the same way. Three plans reached 264, 307 and
  1005 lines; the OMS and autoWildPet protocols reached 153 and 166 lines against a 42-line
  template, 38 of OMS's lines repeating `AGENTS.md`, `LEAD.md` or `seats.json` and 31 of them
  history; their notebooks reached 396 and 339 lines with every entry still open. Each time the
  seat read the rule once, then had nowhere else to put a ruling, an episode or a lesson. The
  templates carry the rule, name the other homes, and give each size in a heading. Nothing
  measures a record after a write: the kit dropped the check that did.
- **Response:** compare a record with its template's headings when you read it, and trim or move
  what has another home. A plan section's size is its heading in `project/guides/PLANS.md`,
  changed there and refreshed into the project.

## Information hiding lives in the prompts

- **Symptom:** a Peer refers to coordination details, or to a note meant for maintainers.
- **Cause:** a Peer or Reviewer can read any file in the repository, including everything in
  `.seatworks/`: the prompts, the guides and the records. No setting on its harness hides a path.
  A harness whose `promptComments` is `shown` would also load an HTML comment verbatim, which is
  why no `.md` in this kit has one.
- **Response:** keep maintainer notes out of `.seatworks/prompts/PEER.md` and `.seatworks/prompts/REVIEWER.md`
  (the setup script fails on an HTML comment in any prompt or skill, whatever the harness), and
  out of every skill such a seat loads. The hiding reduces noise; it doesn't keep secrets. A
  seat's prompt and skills are also checked for every word its role's `hidesWords` lists.

## The repository's instruction file depends on the harness

- **Symptom:** one seat ignores constraints that another follows.
- **Cause:** harnesses disagree on which file they read. The manifest's `contextFile` says which
  one, and `contextFileNeedsPointer` says whether that file has to point at `AGENTS.md`.
- **Response:** keep constraints in `AGENTS.md`, and let `add-project.fish` write a one-line
  `@AGENTS.md` pointer for every other `contextFile` a harness in use declares, so every harness
  converges on one source.

## Paseo's own skills reach the seats only through the setup script

- **Symptom:** a Lead or Supervisor doesn't know a Paseo feature such as workspace scripts or
  profiles, or a Peer starts talking about Paseo.
- **Cause:** Paseo's app installs its orchestration skills (`paseo`, `paseo-committee`, and
  others) into shared skill directories. A seat whose skills live under its own profile never
  sees those copies; a harness that also loads a directory listed in its `sharedSkillDirs` gives
  them to every seat on it, the Peer's included.
- **Response:** leave that install off in the app. The setup script links `paseo` from Paseo's
  package into the profiles whose role's `extraSkills` name it, so it follows Paseo updates. No
  role names it now: no seat ever loaded it, the prompts already carry the Paseo calls a seat
  makes, and it taught workspace and `paseo run` operations the kit refuses.

## A seat gets the skills seats.json chose, and no others

- **Symptom:** you expect a repository's own `.claude/skills/` or `.omp/skills/` to reach a seat,
  and it doesn't; or you want to know whether one ever did.
- **Cause:** both harnesses discover skills from several roots by default, and only one of them
  is the directory this kit fills. Measured on this machine: `omp config get` reports
  `skills.enablePiProject`, `skills.enableClaudeProject`, `skills.enableAgentsUser` and
  `skills.enableAgentsProject` all defaulting to true, and a skill placed in a repository's
  `.omp/skills/` was seen in a seat's system prompt beside the kit's own. On the other harness the
  debug log counts it outright: with `--setting-sources user,project,local` it loads 2 skills
  (`user: 1, project: 1`), and with `--setting-sources user` it loads 1 (`project: 0`).
- **Response:** both are pinned now, the same way the MCP map is. `harness/omp/settings.json`
  writes the whole `skills` block into every omp seat's `config.yml`, with `enablePiUser` on and
  every other root off, and `skillful` on so the list reaches the system prompt at all; the setup
  script compares those keys on every run, so a change to them is reported as drift.
  `harness/claude/harness.json` sets `provider.forceFlags`, and `seat-room` rewrites the argv the
  orchestrator built to carry `--setting-sources user`, which keeps the seat's own settings file
  (the user source, named first in that harness's watch list, so its permission rules and sandbox
stay) and
  drops the repository's. A skill the kit did not choose was never checked against the seat's
  `hidesWords` or its skill set, which is the reason for the pin.

## The room rewrites the argv the orchestrator built

- **Symptom:** a seat runs with a flag neither `seats.json` nor the provider's `args` names.
- **Cause:** the kit writes each provider but not the arguments Paseo appends when it launches
  one, so a flag the kit needs cannot be set there: a flag in the provider's `command` comes
  before Paseo's own, and Claude Code takes the last `--setting-sources` it is given.
  `harness/common/bin/seat-room` is the command every provider launches, and it applies the
  manifest's `provider.forceFlags`, replacing a flag in place whether it arrived as
  `--flag value` or `--flag=value`, and appending it when absent.
- **Response:** put the flag in that manifest's `provider.forceFlags`, not in the provider. A
  launch the plugin did not open, such as Paseo's `--version` probe, gets no config directory and
  runs the coding agent untouched.

## Agent profiles are global, one per role

- **Symptom:** `list_profiles` returns the same five profiles in every project, a Lead asks which
  provider to use, or a profile's model you edited by hand comes back changed.
- **Cause:** profiles live in one global list, `daemon.agentProfiles`, with no project or
  working-directory field. Because a seat joins the project it is started in, the same six are
  the right answer everywhere, and the setup script rewrites each from `seats.json` every run.
- **Response:** `setup/setup-seats.fish` composes one profile per role: a role's `models`
  supplies its model and `isDefault` thinking option; a role with none takes its harness's
  `provider.defaultModel` and its own `thinking`; a `modeId` only a harness whose
  `provider.profileModeId` names one; and its `notes` say which dispositions use it. `--check`
  fails for a profile that differs from `seats.json`. To move a role to another model everywhere,
  change it there; for one project, pin it in that project's `project.json`. Without profiles,
  `list_profiles` returns nothing and a Lead guesses from `list_models`.

## `settings.modeId` and a harness that has no modes

- **Symptom:** a seat stops to ask permission for every tool, or `create_agent` fails with
  "Invalid mode … Available modes: (none)".
- **Cause:** Paseo passes `create_agent`'s `settings.modeId` straight to the harness, overriding
  a seat's own default mode, and falls back to `auto` when the field is empty. A harness with no
  modes rejects any mode ID.
- **Response:** the manifest's `hasModes` and `provider.profileModeId` say which case a seat is
  in, and its agent profile carries a `modeId` only in the first. The Paseo plugin sets `modeId`
  from the profile on every launch and fills a missing `thinkingOptionId`, so a seat's creator
  passes neither; for a harness without modes the profile has none to set.

## Running agents keep the old rules

- **Symptom:** after you change a prompt, a skill, or a role's settings, some agents follow the
  old version.
- **Cause:** an agent keeps what it started with until its session ends. Seats spawned
  afterwards pick up prompts, settings, and skills immediately.
- **Response:** archive the old agents and delete their schedules, and run
  `paseo plugin reload seatworks` after a plugin change, so two versions of the rules don't run
  side by side. Moving a role to another harness is worse: a running agent
  holds the old profile path, so archive every agent first.

## Kit template edits don't reach existing projects

- **Symptom:** after you edit `project/LEAD.md` or a skill under `project/skills/` in the kit, a
  project's seats still follow the old text.
- **Cause:** `setup/add-project.fish` copies the templates into `REPO/.seatworks/` once and a
  plain rerun never overwrites them, and the profile directories link to that copy. The setup
  script finds a project by reading where each profile directory's prompt link points, and
  counts it only when `.seatworks/project.json` is there; `--project REPO_DIR` names one
  directly.
- **Response:** send a change to a seat prompt, skill, or role settings to the kit as a diff. Role
  settings are linked or merged from the kit; `prompts/`, `guides/` and `skills/` reach a project through
  `fish setup/add-project.fish REPO_DIR --refresh`, which leaves `records/` alone and leaves
  `guides/WORKSPACE_PROTOCOL.md` alone once its placeholders are filled in,
  which replaces them with the kit's versions and keeps each old copy under the git-ignored
  `.seatworks/records/drafts/refresh-STAMP/`. Put project-only rules
  for code in `AGENTS.md` and coordination decisions in the filled-in
  `.seatworks/guides/WORKSPACE_PROTOCOL.md`, which refresh never touches, like `NOTEBOOK.md`. Any rerun also restores the agent profiles and, after the kit
  moves, the providers' kit paths. If the repository moves, rerun add-project at the new path
  with the same `--slug SLUG`; the old profile directories point at a path with no
  `project.json`, are ignored, and can be deleted.

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
  Peer's handoff, in the acceptance summary or the review record.

## A message to a running agent replaces its turn

- **Symptom:** a Peer stops mid-step, or a Lead gets a Peer's "finished" notification with a
  partial answer and never hears the real result.
- **Cause:** `send_agent_prompt` replaces a running turn; only finish notifications steer into
  it, and the Paseo plugin holds its own messages until the agent is idle. A finish notification fires once, on the first idle, to whoever
  sent the prompt, so a prompt from anyone but the Lead ends the Lead's wait early and sends
  the Peer's next result to the sender.
- **Response:** send anything meant for a Peer through its Lead (the Supervisor's `CHECK:`
  questions work this way), and message a running agent only when it can't wait.

## The watcher has its own seat

- **Symptom:** the Supervisor finds no Watcher profile, or `setup-seats.fish` notes that
  `watcher` (or another seat) doesn't exist yet.
- **Cause:** the watcher runs on a small model and reads its prompt on every sweep, so its
  instruction file is the short `.seatworks/prompts/WATCHER.md`, with the trigger table in it, rather
  than the Supervisor's prompt. A project added before a seat existed lacks its profile
  directory and prompt. Paseo sets `PASEO_AGENT_ID` in every agent's environment, which is how
  the Supervisor gives the watcher its own ID.
- **Response:** run `fish setup/add-project.fish REPO_DIR` without `--refresh`; it adds the
  missing files, composes any missing provider and profile, builds the profile directory, keeps
  the project's prompts, and reloads Paseo.

## The review tool scopes the review; it does not do it

- **Symptom:** a Reviewer reports `reviewable_count: 0`, or a handoff has no findings for files
  the change clearly touched.
- **Cause:** the Reviewer calls Open Code Review only through `ocr delegate`, which runs no model
  and needs no key: `preview` returns the files in scope and the ones it left out with an
  `exclude_reason`, and `rule` returns the rule text resolved per file pattern. The filter is by
  extension, so a change that is all Markdown, config, or deleted files comes back with nothing
  reviewable. That is a scope answer, not a verdict.
- **Response:** `reviewing-a-change` says to review the excluded files anyway, from
  `git show --stat`, and to put the excluded list with its reasons in the handoff, which is the
  coverage ledger. A repository with its own standards ships a rule file and the brief names it
  for `--rule`. The `ocr review` path, which sends the diff to a model OCR is configured with, is
  not used by this kit; nothing here needs `ocr config` or `ocr llm test`.

## The Reviewer is the read-only lane

- **Symptom:** a Reviewer's write is refused, or an Architect Peer edits a file it was told not to.
- **Cause:** the Reviewer's role settings refuse its edit, write and refactor tools and the git
  commands that change the repository, and turn off the tools that could write another way.
  Its harness has no filesystem sandbox, so shell redirection can still write. An Architect or
  Scout is a **writable** Peer with `Owned scope none` in its brief, so nothing enforces its
  read-only lane: the brief asks, the handoff's Scope field shows what it touched, and acceptance
  is where a violation surfaces.
- **Response:** expected. Send work that edits files to `peer`, and read an Architect's handoff
  Scope field before you trust its report. The read-only lanes a skill opens — council seats,
  ultra-review scouts, audit readers — all run on `reviewer` for exactly this reason. This
  prevents accidents rather than sandboxing.

## The watcher sweeps when the plugin wakes it

- **Symptom:** the watcher never sweeps, sweeps late, or its `ATTENTION:` events never reach the
  Supervisor.
- **Cause:** nothing schedules the watcher. The Paseo plugin sends it `SWEEP` after a Lead, Peer
  or Reviewer turn ends in the same project, at most once per the watcher seat's `sweepMinutes`,
  and again a minute later while the watcher is busy, with `since TIME` so the watcher keeps no
  log of its own. It logs every `ATTENTION:` block a sweep ends with in
  `.seatworks/records/attention/`, sends it to that project's Supervisor once the Supervisor is
  idle (an `ATTENTION (urgent):` block at once, an `ATTENTION (log):` block only after three
  sweeps running), and raises `DECISION:`, `DETOUR:` and `HANDOFF` lines, pushback with no new
  prompt for two sweep periods, and failed turns itself. Held messages and recurrence counts live
  in the plugin process, so a plugin reload or a daemon restart drops them; the log keeps the
  lines.
- **Response:** `paseo plugin ls` must show `seatworks` running, and `paseo plugin logs seatworks`
  shows handler errors. The watcher and the Supervisor must run inside the same repository, and
  it needs `.seatworks/`. A heartbeat left from before the plugin still wakes a watcher on its
  own cadence: archive that watcher and start a new one.

## The 16 KB prompt budget is self-imposed

- **Symptom:** the script fails a prompt that a harness would load without complaint.
- **Cause:** every harness loads larger files. The budget, `promptBudget` in `seats.json`, exists
  because every line costs context on every turn, and rules at the end of a long file get
  skimmed.
- **Response:** when a prompt exceeds the budget, cut content rather than raise the limit.
