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
  own documentation says models don't always do this, and nothing reports the miss.
- **Forcing one:** `/skill:<name>` expands the whole `SKILL.md` into the turn. It is recognised
  both at the start of a message and as a token inside ordinary prose, and it resolves relative
  paths against the skill directory. The expansion happens before the model's turn and leaves no
  tool call.
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
- **`startup.checkUpdate: false`**: a seat is not a place to be told about a new release. The
  keys that limit a seat's tools are under "Tool limits" below.

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
  `mcp__semble_search`. Read off a running seat, which is how `tools.approval` can name the three
  write tools exactly.
- **A repository's own MCP config still loads.** omp reads `<repo>/.omp/mcp.json` and the other
  tools' project files; the seat file does not override those.

## Tool limits

Every limit is an omp setting: `settings.json` for every seat, merged under
`settings/<role>.settings.json` for one role. Verified on omp 18.1.19 against a scratch agent
directory in `--approval-mode yolo`, which is Paseo's mode `full`, the one it launches these seats
in.

- **Paseo's `disallowedTools` does nothing here.** Paseo carries the list into the OMP client's
  runtime settings and the client never reads it, so setup writes none and deletes one it finds.
- **Setup owns two keys.** Every other key in the seat's `config.yml` is merged and kept, so
  anything omp writes for itself survives; `settings.ownedPaths` (`tools.approval`,
  `bash.patterns`) is replaced whole, because a merge cannot take back a deny the kit no longer
  sets. A role overlay that changes `bash.patterns` repeats the shared patterns it keeps.
- **Removing a tool:** `eval.py` and `eval.js` false with `task.maxRecursionDepth` 0 take `eval`,
  `task` and `hub` out of the tool list, and `web_search.enabled` false takes `web_search` out;
  every seat sets them, with `browser.enabled` and `github.enabled` false. `eval` matters most:
  it reaches a shell through its own subprocess, so no `bash` rule covers it.
- **The watcher and the Reviewer** also set `debug.enabled` and `lsp.enabled` false. `debug`
  launches programs through a debug adapter, outside any `bash` rule; `lsp` applies `rename`,
  `rename_file` and `code_actions`, and `request` sends anything to the server. The watcher sets
  `fetch.enabled` false, which turns off the part of `read` that opens URLs (`http://`,
  `https://`, `pr://`, `ssh://`).
- **Refusing a call:** `tools.approval.<tool>: deny` overrides the approval mode, cannot be lifted
  by a tool's own policy, and holds inside a subagent, but leaves the tool listed. The watcher and
  the Reviewer deny `edit`, `write`, `ast_edit`, `notebook`; which code tools a role gets is set by the plugin's `intellij-index` and `semble` servers, not here. Verified by asking a seat to write a file and watching the tool refuse.
- **Refusing a command:** a `bash.patterns` entry with `approval: deny` refuses a command whose
  text matches, with `*` as the only wildcard, so `*git push*` also catches a push after `cd` or
  behind a variable. Every seat denies `*git push*`, `git worktree` changes, `gh *`, `*paseo *`,
  `claude *`, `omp *` and the other coding agents' CLIs; the Reviewer adds the git commands that
  write. A deny beats an allow for the same command, so the watcher, which reads `paseo logs`,
  `ls` and `inspect`, denies every other `paseo` subcommand by name instead of the whole CLI.
- **No filesystem sandbox.** Patterns match text, a rail against the habitual form: where a Peer
  writes is its brief's owned scope, and the Reviewer stays read-only through `tools.approval`
  and `bash.patterns` while shell redirection can still write.
- **Paseo's own tools are host tools here, with bare names** — `create_agent`, not
  `mcp__paseo__create_agent` — because omp supports them natively and Paseo strips its MCP server
  when it does. The role's `paseoTools` is what trims them: Paseo 0.8 builds the catalog without
  the disabled tools, and a Peer with `enabled: false` is handed none.
- **Plan mode is not a tool.** It is a session mode and a slash command, so there is nothing to
  deny.
- **`ask` is on under `--mode rpc-ui`.** omp registers it when the session can prompt, and the
  orchestrator's `rpc-ui` launch counts; a call waits as a pending question with no timeout.
  Paseo 0.8 brings it to the agent that created the seat, as a "needs permission" notification
  with the request ID, and `respond_to_permission` with `answers: {"Response": ...}` answers it;
  verified with a Claude parent and an omp child, so no role denies `ask`.

## Login

A seat directory is its own agent directory with its own empty credential store, so a seat cannot
share your `omp` login: that login lives in `~/.omp/agent/agent.db`, and linking a SQLite database
into a second directory puts its write-ahead log in the wrong place. Seats authenticate from the
environment instead. Put the key on the base `omp` provider in the Paseo config, as
`examples/paseo-providers.json` shows; `omp token zai` prints the one this kit's Peer models use.
The kit never reads a key from anywhere but you, and setup fails if a literal token appears under
a harness directory.
