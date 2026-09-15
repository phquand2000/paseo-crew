# Devin CLI as a harness

Facts about this harness that `harness.json` and the settings encode, and how each one was
established. Every entry here is Devin CLI behavior; the prompts and the README should not repeat it.

Verified on Devin CLI **3000.10.21**, with a JSON-RPC client driving `devin acp` the way Paseo
does, against seat directories the kit built.

## Launch

- **Over ACP.** Each role's provider is `extends: "acp"` with `command: [seat-room, "acp"]`. Paseo
  won't extend a custom provider from another custom one (its client factory exists only for
  built-in ids), so there is no base `devin` entry and nothing to inherit.
- **Availability probe:** Paseo runs `seat-room --version`; with no seat directory set, the room
  execs `devin --version`.
- **Flags:** `devin acp` takes only `--agent-type`, `--model` and `--refusal-fallback`. Mode and
  model arrive over ACP instead.
- **Modes:** `accept-edits` (default), `smart`, `ask`, `plan`, `bypass`. The profile sets `bypass`.
- **Models** are an ACP config option whose ids carry the effort (`swe-2-max`, `glm-5-3-flash-low`);
  `devin models list` prints them. There is no thought-level option and Paseo throws when a launch
  passes one, so `hasThinking` is false and the plugin drops it.
- **Login:** `devin auth login`. The token sits in `~/.local/share/devin/credentials.toml`, outside
  the seat directory, so every seat shares it and no key goes on a provider.

## The seat directory

- **`XDG_CONFIG_HOME`** relocates Devin's user config: `devin/config.json`, `devin/AGENTS.md`,
  `devin/skills/` and `devin/mcp_config.json`. Established with `devin skills paths`,
  `devin rules show AGENTS` and `devin mcp list` against a scratch directory, then through ACP.
- **Side effect:** every command a seat runs inherits the variable, so git would miss
  `~/.config/git/ignore`; the manifest links `git` into the seat. `~/.gitconfig` is unaffected.
- **Devin writes** `version`, `devin.org_id`, `shell.setup_complete` and `theme_mode` into
  `config.json` on first use; the plugin merges into that file and replaces only `permissions` and
  `read_config_from` (`settings.ownedPaths`), so they stay.

## Prompt and skills

- **Prompt:** `devin/AGENTS.md` loads as an always-on rule named `AGENTS`, beside the repository's
  own `AGENTS.md`. HTML comments aren't stripped as far as anyone checked, so no `.md` in the kit
  carries one.
- **Imports:** by default Devin also loads Claude Code's `CLAUDE.md`, `~/.claude/skills` and MCP
  servers, and Cursor's and Windsurf's; `read_config_from` turns all three off, seen in the skill list.
- **Roots that stay on:** `~/.agents/skills`, the repository's
  `.devin/skills`, `.cognition/skills` and `.agents/skills`, and three built-ins: `devin-cli`,
  `declarative-repo-setup`, `upload-secrets`. `devin-cli` was seen invoking itself unasked.
  `upload-secrets` works through `devin cloud`, which the shared settings deny.
- **Loading one:** the `skill` tool; a user-typed `/<name>` reaches the same.

## Settings and limits

- **Rules:** `permissions.deny` takes `Exec(prefix)`, `Write(glob)`, `Read(glob)`, `Fetch(pattern)`,
  bare tool names and `mcp__server__tool`; deny beats ask beats allow. Verified in `bypass`:
  `Exec(git push)` refused a push, `Exec(paseo daemon)` refused `paseo daemon status` while
  `paseo ls` ran, and `Write(**)` refused the write tool.
- **Layers:** `settings.json` is shared and `settings/<role>.settings.json` adds to it; lists such as
  `permissions.deny` add up, so a role file names only its extra rules, and `{}` when it has none.
- **A bare tool name refuses the call but leaves the tool listed**, so `web_search` still shows.
- **A refused call ends the turn.** The prompt returns `end_turn` with no further model call and no
  reply, even when told to report the refusal; seen on four models. A seat that runs a denied
  command stops without a handoff, and whoever started it prompts it again.
- **`subagents_enabled: false`** removes `run_subagent` and `read_subagent`. Over ACP there is no
  ask tool, so no setting is needed for questions.
- **No sandbox here:** `--sandbox` is a flag `devin acp` doesn't take, so an exec rule is a rail
  against the habitual form, and where a Peer writes is its brief's owned scope.

## MCP servers

- `devin/mcp_config.json` takes the kit's `mcpServers` map unchanged, stdio and http alike.
- Paseo passes its own tools as an http server in `session/new`. Devin reports
  `mcpCapabilities.http: false` and connects to it anyway.
