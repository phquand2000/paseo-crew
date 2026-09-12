# Pi as a harness

Facts about this harness that `harness.json` encodes, and how each one was established. Every
entry here is Pi behavior; nothing in `project/` or the setup docs should repeat it.

Verified on Pi **0.85.1**.

## Skills

- **Where they go:** `$PI_CODING_AGENT_DIR/skills/<name>/SKILL.md`. `PI_CODING_AGENT_DIR`
  overrides Pi's config directory, whose default is `~/.pi/agent`, and the global skills
  directory is `skills/` under it.
- **How it was established:** Pi's own `loadSkills()` was called with `agentDir` set to a seat
  profile. It returned every skill the kit had linked, each with scope `user`, and
  `formatSkillsForPrompt()` rendered them into an `<available_skills>` block with their
  descriptions and locations. No diagnostics.
- **This probe runs on every `--check`,** because it is free and authoritative:
  `probe.kind: "pi-loader"`. If a Pi upgrade moves the directory, `setup-seats.fish` fails with
  the name of the skill the harness would no longer load.
- **Loading one:** Pi puts only names and descriptions in the system prompt and leaves the agent
  to `read` the `SKILL.md` itself. Its own documentation says models don't always do this, and
  nothing reports the miss. That is why the kit has skill gates at all.
- **Forcing one:** a message starting `/skill:NAME ` is replaced, before the model sees it, by
  that whole `SKILL.md` in a `<skill name= location=>` block. Three sharp edges: the command must
  be at the very start; its name must end at a **space** (a newline after `/skill:NAME` leaves
  the name unmatchable, and the text goes through unchanged and unflagged); and one message
  expands one skill, so it can't cover the second skill a task needs. Because the expansion
  happens before the model's turn, it leaves no tool call, so `skill-gate.ts` cannot see it —
  a forced load does not satisfy a gate.
- **Frontmatter:** only `name`, `description`, and `disable-model-invocation` (the literal
  `true`) are read. `$ARGUMENTS` and `${CLAUDE_SKILL_DIR}` are not substituted. A skill with
  malformed YAML or an empty description is skipped with a warning. Skills are listed only when
  the `read` or `bash` tool is enabled.
- **Name and directory may differ** in Pi, deliberately, but the kit requires them equal so one
  skill directory works across harnesses.
- **`~/.agents/skills` is loaded for every profile,** because it sits outside
  `PI_CODING_AGENT_DIR`. It is in `sharedSkillDirs`, and `setup-seats.fish` prints how many
  skills it holds. Move anything a Peer shouldn't see out of it.

## Prompt

- **File:** `APPEND_SYSTEM.md` in the profile directory, linked to the project's role prompt.
- **HTML comments are shown to the seat.** `promptComments: "shown"` is what makes
  `setup-seats.fish` refuse a comment in `PEER.md`, `REVIEWER.md`, or any skill a Pi seat loads.
- **A trusted repository's `.pi/APPEND_SYSTEM.md` replaces the profile's.** In RPC mode Pi never
  shows its trust prompt, and with the default `defaultProjectTrust: "ask"` it silently skips
  project `.pi/` resources. Leave project trust at `ask` for repositories a Peer works in.
- **`AGENTS.md` wins over `CLAUDE.md`:** Pi takes one instruction file per directory and prefers
  `AGENTS.md`, which is why the repository's constraints live there.

## Enforcement

- **No permission system.** Pi ignores `disallowedTools`, so `deny.mechanism` is `extension`:
  the only enforcement point is the `tool_call` hook in `extensions/peer-guard.ts`, plus
  `extensions/skill-gate.ts` when a role has a gate.
- **`SEATWORKS_READ_ONLY=1`** makes `peer-guard.ts` block Pi's `write` and `edit` tools and the
  git commands that change the repository. Shell redirection still works, so `$TMPDIR` notes
  remain possible and so does a determined write.
- **Paseo tools:** `paseoTools.enabled: false` on every Pi provider. Pi receives Paseo tools only
  through the `pi-mcp-adapter` extension, and Paseo carries the profile's `mcp.json` into each
  launch, so both stay out.

## Skill gates on this harness

`skill-gate.ts` counts a skill as loaded when a tool call reads a path ending in
`<name>/SKILL.md`. It ships with no gate enabled, because `seats.json` defines gates only for
the Lead and the eval recorded no Peer skipping a skill. It is installed only for a role that
has a gate, and it reads the same `seats.json` entries the Claude guard reads, so moving a gated
role onto Pi keeps its gate.

## Login

The profile's `auth.json` links to `~/.pi/agent/auth.json`, and Pi rewrites that file in place,
so a seat shares your login. Each profile keeps its own lock file, so two OAuth refreshes at the
same moment can race. A Claude Pro or Max login used through Pi is billed per token as extra
usage, not against the plan's limits: prefer an API key for a seat's provider. To separate the
logins, replace the link with a real file and log in again with `PI_CODING_AGENT_DIR` pointing at
the profile.
