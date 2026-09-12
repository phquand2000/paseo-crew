# Oh My Pi as a harness

Facts about this harness that `harness.json` encodes, and how each one was established. Every
entry here is omp behavior; nothing in `project/` or the setup docs should repeat it.

Verified on omp **18.1.18**, against Paseo's own `omp` provider.

## The seat directory

- **One environment variable moves everything.** `PI_CODING_AGENT_DIR` relocates omp's agent
  directory, whose default is `~/.omp/agent`, and the settings file, the credential store, the
  skills root, the extensions root and the user context file all move with it. The kit points it
  at `~/.omp/seats/<role>-<slug>`, not at `~/.omp/profiles/...`, because that path is omp's own
  named-profile layout and a seat directory is an agent directory, not a profile.
- **How it was established:** a scratch agent directory was built by hand with `AGENTS.md`,
  `skills/<name>/SKILL.md`, `extensions/<name>.js` and `config.yml`, and omp was run against it
  in both `--mode rpc` and `-p`. Each part was confirmed separately, below.

## Skills

- **Where they go:** `$PI_CODING_AGENT_DIR/skills/<name>/SKILL.md`, one level deep. Nested
  directories are not discovered.
- **How it was established:** a seat run answered "the names of every skill listed in your system
  prompt" with exactly the linked skill. The same run over RPC registered a `/skill:<name>`
  command for it, which is the same discovery pass without a model call.
- **The skills list is in the prompt only when the `read` tool is available.** A seat launched
  with `--no-tools` was offered none. No seat runs that way, but a deny list that removed `read`
  would silently take every skill with it.
- **Loading one:** omp puts names and descriptions in the system prompt and leaves the agent to
  read the `SKILL.md` itself, through the ordinary `read` tool or the `skill://<name>` URL. Its
  own documentation says models don't always do this, and nothing reports the miss. That is why
  the kit has skill gates at all.
- **Forcing one:** `/skill:<name>` expands the whole `SKILL.md` into the turn. It is recognised
  both at the start of a message and as a token inside ordinary prose, and it resolves relative
  paths against the skill directory. The expansion happens before the model's turn and leaves no
  tool call, so `skill-gate.ts` cannot see it: a forced load does not satisfy a gate.
- **Frontmatter:** `name`, `description`, `globs`, `alwaysApply`, `hide` and
  `disable-model-invocation` are read; `name` defaults to the directory name and a skill with no
  description is skipped by the native loader. `$ARGUMENTS` and `${CLAUDE_SKILL_DIR}` are not
  substituted.
- **A repository's own skills load too**, from `<repo>/.omp/skills`, and so do the other
  discovery sources a project may carry. Foreign *user-level* roots are opt-in and stay off.
- **`~/.agents/skills` is loaded for every seat,** because the `agents` source sits outside
  `PI_CODING_AGENT_DIR` and is on by default. It is in `sharedSkillDirs`, and `setup-seats.fish`
  prints how many skills it holds. Move anything a Peer shouldn't see out of it.

## Prompt

- **File:** `AGENTS.md` in the seat directory, linked to the project's role prompt. omp reads the
  agent directory's `AGENTS.md` as the user-level context file, and the native source outranks
  every other convention, so it is the one user file that survives.
- **How it was established:** a seat run repeated a marker word that appeared nowhere but that
  file.
- **HTML comments are shown to the seat.** This harness is one reason the kit forbids them in
  every `.md`, not just the ones an omp seat reads: a prompt has to load unchanged wherever its
  role runs, so `setup-seats.fish` refuses `<!--` in any prompt or skill for any harness.
- **`AGENTS.md` wins over `CLAUDE.md`** in the repository too, which is why the repository's
  constraints live there.

## Settings

- **File:** `config.yml` in the seat directory. It is YAML, and JSON is valid YAML, so the kit
  writes and verifies it with `jq` like every other settings file; a seat run read a deny map out
  of a JSON-bodied `config.yml` and enforced it.
- **omp does not create it.** A seat directory with no `config.yml` ran fine and none appeared.
  Only `omp config set`, `/settings`, and a model-selector role assignment write that file, and a
  seat does none of those. If one ever did, the file would come back as real YAML and the merge
  check would fail loudly rather than quietly dropping the denies.
- **`startup.checkUpdate: false`** is the only key the kit sets by hand. A seat is not a place to
  be told about a new release.

## MCP servers

- **File:** `mcp.json` in the seat directory, which is omp's user scope once
  `PI_CODING_AGENT_DIR` points there. setup writes the whole object, so a seat carries exactly
  the servers `seats.json` names.
- **How it was established:** `/mcp list` over RPC on a built seat printed both servers as
  `enabled [user]`, and `/mcp test <name>` connected to each and listed its tools.
- **They are not in the first session's tool set.** MCP connect has a 250 ms startup gate; a
  server slower than that is deferred and its tools come from a cache the seat has not written
  yet. On a cold seat directory the model sees only built-in tools; from the next session the
  cache is warm and the MCP tools are there. Verified both ways on the same seat.
- **Registered names:** `mcp__<server, with `-` as `_`>_<tool>` — `intellij-index`'s
  `ide_refactor_rename` is `mcp__intellij_index_ide_refactor_rename`, and semble's `search` is
  `mcp__semble_search`. Read off a running seat, which is how the `ide-refactor` intent can name
  the three write tools exactly.
- **A repository's own MCP config still loads.** omp reads `<repo>/.omp/mcp.json` and the other
  tools' project files; the seat file does not override those.

## Enforcement

- **Paseo's `disallowedTools` does nothing here.** Paseo carries the list into the OMP client's
  runtime settings and the client never reads it. `deny.mechanism` is `settings`: setup composes
  the deny map from the intents `seats.json` asks for and merges it into the seat's `config.yml`
  under `tools.approval`.
- **`tools.approval.<tool>: deny` is absolute.** It overrides the active approval mode, it cannot
  be lifted by a tool's own policy, and it holds inside a subagent. Paseo launches these seats in
  mode `full`, which is `--approval-mode yolo`; the denies still hold. Verified by asking a seat
  to write a file and watching the tool refuse.
- **`eval` is denied on every seat.** It reaches a shell through its own subprocess, so a
  `bash` rule does not cover it and `peer-guard.ts`, which parses `bash` commands, never sees it.
- **Paseo's own tools are host tools here, with bare names** — `create_agent`, not
  `mcp__paseo__create_agent` — because omp supports them natively and Paseo strips its MCP server
  when it does. `daemon.mcp.injectIntoAgents` is machine-wide with no per-provider switch, so
  every omp seat is offered all forty. That is what the `paseo` intent is for on a Peer and the
  `paseo-write` intent on the watcher.
- **A denied tool is still offered to the model.** `tools.approval` refuses the call; it does not
  take the tool out of the prompt. So setup also passes the composed deny list as
  `SEATWORKS_DENIED_TOOLS`, and `peer-guard.ts` removes those names from the active tool set with
  `setActiveTools` at `session_start`.
- **That prune reaches omp's own tools and not Paseo's.** Verified by driving a seat over RPC:
  `setActiveTools` at `session_start` removes `eval`, `task`, `hub`, `todo` and `web_search`, and
  the model then lists only what is left. A `set_host_tools` frame sent afterwards, the way Paseo
  sends it, adds its tools to the same set, and `setActiveTools` from `turn_start` no longer
  removes anything — the model still sees them. **So an omp Peer sees Paseo's forty tool names
  and is refused when it calls one.** Nothing in the tool names says which seat is above it, but
  this is a real difference from a harness with no native Paseo tools, and the only switch that
  would close it, `daemon.mcp.injectIntoAgents`, is the same switch the Supervisor and the Lead
  need on.
- **`SEATWORKS_READ_ONLY=1`** makes `peer-guard.ts` block omp's `write` and `edit` tools and the
  git commands that change the repository. Shell redirection still works, so `$TMPDIR` notes
  remain possible and so does a determined write; a read-only role also denies `file-edit` in its
  settings, which closes the tool path properly.
- **`plan-mode` stays unenforced.** omp's plan mode is a session mode and a slash command, not a
  tool, so there is nothing to deny. `workflows` is listed under `deny.absent`: omp has no such
  capability, so setup does not report it as a gap.

## The shell-guard bridge

`harness/common/guards/` holds the guards that decide which repository paths a role may write and
which agent the watcher may prompt. They are POSIX shell reading one JSON object on stdin and
answering with exit 2 plus a message on stderr, and rewriting them in TypeScript would mean
rewriting a shell-command path scanner. `extensions/shell-guard.ts` runs them instead: it reads
the role's `guards` list from `seats.json`, keeps the `.sh` entries, and for each `tool_call`
spawns the guard with the hook input it expects, turning exit 2 into a blocked call with the
guard's own wording.

Two translations happen in the bridge. omp's tool names become the ones the guards match
(`bash` → `Bash`, `write` → `Write`, `edit` → `Edit`, `notebook` → `NotebookEdit`); host tools
pass through unchanged, which is enough because the guards match those by suffix. And omp's
`edit` takes one patch string rather than a path, so the bridge reads the `[path#tag]` section
headers out of it and checks each path separately.

Setup installs the bridge for any role that lists a `.sh` guard and installs the `.sh` files
themselves nowhere: the bridge runs them out of the kit.

## Skill gates on this harness

`skill-gate.ts` counts a skill as loaded when a tool call reads a path ending in
`<name>/SKILL.md`. It ships with no gate enabled, because `seats.json` defines gates only for the
Lead. It is installed only for a role that has a gate, and it reads the same `seats.json` entries
the Claude guard reads, so moving a gated role onto omp keeps its gate.

## Login

A seat directory is its own agent directory with its own empty credential store, so a seat cannot
share your `omp` login: that login lives in `~/.omp/agent/agent.db`, and linking a SQLite database
into a second directory puts its write-ahead log in the wrong place. Seats authenticate from the
environment instead. Put the key on the base `omp` provider in the Paseo config, as
`examples/paseo-providers.json` shows; `omp token zai` prints the one this kit's Peer models use.
The kit never reads a key from anywhere but you, and setup fails if a literal token appears under
a harness directory.
