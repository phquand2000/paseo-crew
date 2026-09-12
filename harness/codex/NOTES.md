# Codex as a harness

**Unverified.** `harness.json` has `verified: null`, so `setup-seats.fish` refuses to claim a
Codex seat's skills reach it and prints a pointer to this file instead. Codex is not installed on
the machine this was written on: `paseo provider diagnostic codex` reports
`Resolved path: not found`, and `~/.codex` holds only leftover state from an earlier install
(sqlite files and a `skills/` directory) with no `config.toml` and no `auth.json`.

What *is* verified is the generation: a flip of the watcher to Codex in `seats.json` builds a
complete room, and flipping back leaves the provider byte-identical. The room, its merged
`config.toml`, and its model catalog were inspected; only the Codex binary itself is untested.

## The room

`bin/materialize-room SEAT ROLE RUNTIME_DIR` writes one seat's `CODEX_HOME`:

- `config.toml` — the shared `~/.codex/config.toml` (when you have one), then
  `config/base.config.toml`, then `config/<role>.config.toml`, merged by the keys in
  `settings.overlayKeys` and by a `developer_instructions` block. Tables are appended, not
  merged key by key.
- `model-catalog.json` — `models.json` with the provider's model filled in and every
  `multi_agent_version` set to `null`. With `SEATWORKS_CODEX_KEEP_BUNDLED=1` it also folds in
  `codex debug models --bundled`, nulling those too.
- the links in `links` — `auth.json` (required) and `hooks.json` (optional, skipped when absent).
  `skills` is deliberately **not** linked: `skillsDir` gives the seat its own skill set, which is
  the point of a per-seat room.

`bin/codex-room SEAT [args…]` re-materializes, exports `CODEX_HOME`, and `exec`s `codex "$@"`.
It is the provider's `command`, so Paseo's own arguments pass straight through. Both entry
points call the same materializer, so a launch never disagrees with a build. Set
`SEATWORKS_ROOM_REFRESH=0` to skip the rebuild and only set `CODEX_HOME`.

`setup-seats.fish` runs the materializer as part of building the seat, so `--check` can verify
the room exists without launching anything.

## The custom model

A non-OpenAI model is data, in `provider.env` on this manifest, and one edit changes it:

| Variable | Meaning |
|---|---|
| `SEATWORKS_CODEX_PROVIDER` | the `[model_providers.NAME]` table name and its `name` |
| `SEATWORKS_CODEX_BASE_URL` | the provider's `base_url` |
| `SEATWORKS_CODEX_ENV_KEY` | the **name** of the variable Codex reads the key from |
| `SEATWORKS_CODEX_WIRE_API` | `responses` or `chat` |
| `SEATWORKS_CODEX_MODEL` | the model slug, which becomes `model` and the catalog entry's `slug` |
| `SEATWORKS_CODEX_MODEL_DESCRIPTION` | shown in Codex's model list |
| `SEATWORKS_CODEX_KEEP_BUNDLED` | `1` to keep the bundled OpenAI models alongside yours |

Three decisions worth knowing:

- **The API key is never in a file.** Codex supports `env_key`, which names an environment
  variable it reads the key from, so the kit writes `env_key = "ZAI_API_KEY"` and never
  `experimental_bearer_token`. Export the key where the Paseo daemon can see it; nothing in the
  kit, in git, or in a room holds it. `setup-seats.fish` fails if a literal token appears under
  `config/`, and notes when the named variable is unset in your shell.
- **`model_catalog_json` gets an absolute path.** Codex's documentation does not promise `~`
  expansion, so the materializer writes the resolved path to the room's own catalog.
- **The reasoning effort is per role,** in `config/<role>.config.toml`, because the valid set
  comes from the model: `models.json` as shipped offers `low`, `high`, and `max`, so a
  `medium` from `seats.json` would be rejected. The watcher gets `low` and `read-only`; the
  read-only Peer and the Reviewer get `read-only` too.

## What is sourced

- **Config directory:** `CODEX_HOME`, defaulting to `~/.codex`. Paseo's Codex provider resolves
  it as `CODEX_HOME ?? path.join(os.homedir(), ".codex")`.
- **Prompt file:** `AGENTS.md`.
- **Native profiles exist too:** `~/.codex/<name>.config.toml` overlaid on `~/.codex/config.toml`
  with `--profile <name>`. That is the same layering the room does by hand. The room is still
  used because a profile alone would not give a seat its own `skills/` or `hooks.json`; if open
  question 1 settles against per-seat skills, native profiles become the simpler route and the
  room can go.
- **Hooks:** `hooks.json` with `PreToolUse` entries, reading `tool_name` and `tool_input` on
  stdin and answering on stdout with `permissionDecision` of `allow`, `deny`, or `ask` plus a
  reason. `harness/common/hook-io.sh` emits that form under
  `SEATWORKS_HOOK_PROTOCOL=json-decision`, which setup sets on a Codex seat, so
  `lead-guard.sh`, `watcher-guard.sh`, and `skill-guard.sh` run unchanged. A flip of the
  watcher to Codex was observed linking both guards into the room.
- **No Paseo deny list.** Paseo applies `disallowedTools` only to its `claude` and `omp`
  providers, so `deny.mechanism` is `hooks` and a Codex seat's limits rest on its hooks plus
  `sandbox_mode` and `approval_policy`. `setup-seats.fish` says so rather than pretending a
  deny list is in force.
- **Native subagents have to go.** Paseo is meant to be the only control plane, which
  the `subagents` intent achieves on Claude seats by refusing `Agent` and `Task`. On Codex the equivalent
  is the catalog with every `multi_agent_version` nulled; setting `multi_agent` and
  `multi_agent_v2` to false is not enough, because bundled model metadata can still advertise
  v1 or v2.

## What is open

Resolve these before setting `verified`, then record how, the way
`harness/claude/NOTES.md` and `harness/pi/NOTES.md` do.

1. **Where the skills directory is.** The manifest says `$CODEX_HOME/skills`, which is what the
   `codex-room` launcher this is modelled on assumed. Codex's own documentation instead lists
   the personal scope as `$HOME/.agents/skills`, with repository scope at `.agents/skills` and
   admin scope at `/etc/codex/skills`, and says nothing about `CODEX_HOME` relocating any of
   them. The difference decides whether Codex seats can have **different** skill sets at all.
   Settle it by building one seat, putting a sentinel skill in its room's `skills/`, and asking
   the seat to list its skills — the test that settled it for Claude Code. If only
   `$HOME/.agents/skills` works, set `skillsDir` to null, move it to `sharedSkillDirs`, and
   accept that a Codex watcher and a Codex Peer share one set.
2. **Whether it follows symlinks.** The documentation says Codex follows the symlink target when
   scanning these locations. The kit links every skill, so confirm on a real seat.
3. **How a loaded skill can be recognised.** Skills are invoked with `$name` or implicitly from
   the description, and `agents/openai.yaml` can set `allow_implicit_invocation: false`.
   `skillLoad.transcriptMatch` is null because no transcript shape is confirmed, so a gate on a
   Codex seat has nothing to read. Setup fails closed on this: it refuses to build a gated role
   on this harness. `seats.json` gates only the Lead, so the watcher and the Peer can move here
   and the Lead cannot.
4. **Whether HTML comments are shown.** `promptComments` is `shown`, the safe assumption. It no
   longer gates anything: every `.md` in the kit is comment-free, so a flip of the watcher to
   Codex passes this check. Confirm the field anyway, because a safety review reads it to know
   whether a leaked note would be visible.
5. **Whether it has modes.** `hasModes` is null. `paseo provider ls` shows a default mode of
   `auto-review` but lists no modes while Codex is unavailable. The answer decides whether an
   agent profile for a Codex seat carries a `modeId`; the profile guard follows the profile.
6. **Whether `wire_api = "responses"` suits your provider.** The shipped value is from the kit
   owner's Z.ai setup. A provider speaking the chat-completions shape needs `chat`.

## First run, once Codex is installed

```fish
codex login
set -gx ZAI_API_KEY YOUR_KEY
```

Then flip the role in `seats.json`, rebuild, and probe:

```fish
fish setup/setup-seats.fish
codex --version
```

Put a sentinel skill in the room's `skills/`, start the seat, and ask it to list its skills. That
answers questions 1 and 2 in one step; record the result here and set `verified` to the version.
