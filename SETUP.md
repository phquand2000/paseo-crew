# Set up the seats

This procedure is written for an agent to execute. Read it through once, then work through the
steps in order. Each step ends with a **Done** check; start the next step only when it passes.

In this document, `KIT_DIR` is the directory that contains this file, and `REFERENCE.md` is the
list of environment behavior that the config doesn't reveal.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the script uses the `path` builtin)
- jq
- the `claude` CLI
- a running Paseo daemon

The setup has seven steps:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the providers to Paseo](#add-the-providers-to-paseo)
4. [Build the seat profiles](#build-the-seat-profiles)
5. [Reload Paseo](#reload-paseo)
6. [Verify that each seat reads its own prompt](#verify-that-each-seat-reads-its-own-prompt)
7. [Replace the demo rules](#replace-the-demo-rules)

Steps 4 and 5 are safe to repeat. Step 3 edits a file that also holds your workspaces, so it
starts with a backup.

## Move the kit to a stable path

The script creates symlinks to absolute paths, so if you move the kit later you must rerun the
script. The Supervisor also uses the kit as its working directory and commits prompt changes
here.

1. Move this directory to where it will live long-term, for example `~/.config/seatworks`.
2. In `KIT_DIR`, create the repository and the first commit:

   ```fish
   git init
   git add -A
   git commit -m "Initial seatworks kit"
   ```

**Done:** `git -C KIT_DIR log --oneline` prints at least one commit.

## Check the prerequisites

1. Run:

   ```fish
   fish --version; jq --version; claude --version; paseo ls
   ```

**Done:** fish reports version 3.5 or later, jq and claude each print a version, and
`paseo ls` exits without an error.

If anything is missing, stop and ask the user to install it; don't install it yourself.

## Add the providers to Paseo

`examples/paseo-providers.json` contains four entries: `claude`, the base that holds the token,
and one entry per seat that extends it. You merge them into `.agents.providers` in
`~/.paseo/config.json`. That file also holds workspaces and the agent ledger, so merge the
entries rather than replacing the file.

1. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

2. Ask the user for their `CLAUDE_CODE_OAUTH_TOKEN`; they can create one with
   `claude setup-token`. Don't read a token from any other file.
3. Look up the real model IDs with Paseo's `list_models`. The IDs in the example file are
   illustrations.
4. Merge the four entries into `.agents.providers`, replacing the following:
   - `HOME_DIR`: the user's home directory.
   - `OAUTH_TOKEN`: the token from substep 2.
   - Each `models[].id`: a real ID from substep 3.
5. Delete the `_doc` key from the merged entries; Paseo's schema rejects unknown keys.

**Done:** all three commands succeed, and the first one lists `claude`, `claude-lead`,
`claude-peer`, and `claude-supervisor`:

```fish
jq '.agents.providers | keys' ~/.paseo/config.json
jq -e '.agents.providers["claude-peer"].env.CLAUDE_CONFIG_DIR' ~/.paseo/config.json
jq -e . ~/.paseo/config.json > /dev/null
```

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Build the seat profiles

The script generates `claude/<seat>.settings.json` from the base settings plus a per-seat
overlay, builds each seat's profile directory with its symlinks, and adds each seat's deny list
to its provider's `disallowedTools`. Its configuration (seat list, paths, skill allowlists, deny
lists, settings overlays) is the block at the top of the script.

1. Run:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish
   ```

**Done:** the script exits 0 and prints a `✓` line for each of the three seats.

If the script prints `!` lines, each one names the file that is wrong and how. Fix it, then
rerun this step.

To roll back, delete `~/.claude/profiles/claude-lead`, `~/.claude/profiles/claude-peer`, and
`~/.claude/profiles/claude-supervisor`, and restore `~/.paseo/config.json.bak`.

## Reload Paseo

Paseo has no file watcher, so it keeps the old provider config until you reload it.

1. Run:

   ```fish
   paseo reload
   ```

**Done:** `paseo ls` (or `inspect_provider`) shows `claude-lead`, `claude-peer`, and
`claude-supervisor` as available.

## Verify that each seat reads its own prompt

The previous steps prove only that the filesystem is right. This step proves that each seat
loads its prompt, because a missing `CLAUDE_CONFIG_DIR` fails silently.

For each provider in the table below:

1. Create an agent with `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`.
2. Ask it for the first line of the `CLAUDE.md` it has loaded.
3. For `claude-peer` only, also ask whether its instructions mention Paseo or a Lead.
4. Archive the agent.

**Done:** each agent returns its expected first line, and the Peer answers no in substep 3.

| Provider | Expected first line |
|---|---|
| `claude-peer` | `# Peer — independent co-worker` |
| `claude-lead` | `# Lead — Project Lead & binding technical arbiter` |
| `claude-supervisor` | `# Supervisor — orchestration observer acting for the Human` |

If an agent returns the user's own `CLAUDE.md`, that provider's `CLAUDE_CONFIG_DIR` isn't
applied; go back to [Add the providers to Paseo](#add-the-providers-to-paseo).

If the Peer says its instructions mention Paseo or a Lead, find that text in `claude/PEER.md`
outside an HTML comment, and move it into a comment or delete it. Then repeat this step for
`claude-peer`.

## Replace the demo rules

The three seat prompts are demo files: the structure is real, but the rules are generic, and
the value comes from your own rules. Before editing, read [WRITING_GUIDE.md](WRITING_GUIDE.md).

Write the files in this order, because each one constrains the next:

1. The target repository's `CLAUDE.md`, from `examples/CLAUDE_MD_SNIPPET.md`. Every agent reads
   it, and it is the only place the contract boundary is declared.
2. Optional: the target repository's `WORKSPACE_PROTOCOL.md`, from
   `examples/WORKSPACE_PROTOCOL.md`. Only the Lead reads it.
3. `claude/PEER.md`: boundaries, handoff shape, evidence standard.
4. `claude/LEAD.md`: acceptance conditions, when to add a Reviewer, what belongs to the Human.
5. `claude/SUPERVISOR.md`: signals worth a look, intervention rights, when prompt patches are
   allowed.

Then run the check:

```fish
fish KIT_DIR/setup/setup-seats.fish --check
```

**Done:** the check exits 0, and every `TODO` comment in the prompts has an answer or has been
deleted as not applicable.
