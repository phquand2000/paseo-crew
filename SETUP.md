# Set up the seats

This procedure is written for an agent to execute. Read it through once, then work through the
steps in order. Each step ends with a **Done** check; start the next step only when it passes.

In this document, `KIT_DIR` is the directory that contains this file, and `REFERENCE.md` is the
list of environment behavior that the config doesn't reveal.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the script uses the `path` builtin)
- jq
- the `claude` CLI
- Pi 0.84.4 or later, logged in to at least one model provider
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

1. Check the tools:

   ```fish
   fish --version; jq --version; claude --version; pi --version; paseo ls
   ```

2. Check the Pi login and Paseo's tool injection:

   ```fish
   test -f ~/.pi/agent/auth.json; and echo "pi login: ok"
   jq '.daemon.mcp' ~/.paseo/config.json
   ```

**Done:** fish reports 3.5 or later, Pi reports 0.84.4 or later, jq and claude each print a
version, `paseo ls` exits without an error, the Pi login exists, and `.daemon.mcp` shows
`"enabled": true` and `"injectIntoAgents": true`.

If a tool or the Pi login is missing, stop and ask the user to install it or to log in (run
`pi`, then `/login`, or save an API key); don't do it yourself. If `injectIntoAgents` isn't
`true`, ask the user before changing it, because it gives Paseo tools to every agent the daemon
starts.

## Add the providers to Paseo

`examples/paseo-providers.json` contains four entries: `claude`, the base that holds the token;
`claude-lead` and `claude-supervisor`, which extend it; and `pi-peer`, which extends Paseo's
built-in `pi` provider. You merge them into `.agents.providers` in `~/.paseo/config.json`. That
file also holds workspaces and the agent ledger, so merge the entries rather than replacing the
file.

1. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

2. Ask the user for their `CLAUDE_CODE_OAUTH_TOKEN`; they can create one with
   `claude setup-token`. Don't read a token from any other file.
3. Look up the real Claude model IDs with Paseo's `list_models`. The IDs in the example file are
   illustrations. `pi-peer` has no `models` list, because Paseo discovers its models from Pi.
4. Merge the four entries into `.agents.providers`, replacing the following:
   - `HOME_DIR`: the user's home directory.
   - `OAUTH_TOKEN`: the token from substep 2.
   - Each `models[].id` in the Claude entries: a real ID from substep 3.
5. If the config already has an entry with one of these four IDs from an earlier setup, replace
   that entry instead of merging into it. The setup script only adds deny entries and never
   removes them, so an old `env` or `disallowedTools` (such as a denied `Write`) would carry
   over.
6. Delete the `_doc` key from the merged entries; Paseo's schema rejects unknown keys.

**Done:** all three commands succeed, and the first one lists `claude`, `claude-lead`,
`claude-supervisor`, and `pi-peer`:

```fish
jq '.agents.providers | keys' ~/.paseo/config.json
jq -e '.agents.providers["pi-peer"].env.PI_CODING_AGENT_DIR' ~/.paseo/config.json
jq -e . ~/.paseo/config.json > /dev/null
```

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Build the seat profiles

The script builds a Claude Code profile for each Claude seat and a Pi profile for the Peer. It
also updates the providers: it adds the Claude seats' deny lists to `disallowedTools` and turns
off Paseo tools for `pi-peer`. Its configuration is the block at the top of the script.

1. Run:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish
   ```

**Done:** the script exits 0 and prints a `✓` line for `claude-lead`, `claude-supervisor`, and
`pi-peer`, each with the number of skills in its `skills/<role>/` directory.

If the script prints `!` lines, each one names the file that is wrong and how. Fix it, then
rerun this step.

To roll back, delete `~/.claude/profiles/claude-lead`, `~/.claude/profiles/claude-supervisor`,
and `~/.pi/profiles/pi-peer`, and restore `~/.paseo/config.json.bak`. Your normal Pi login stays
in place, because the Peer profile only links to it.

## Reload Paseo

Paseo has no file watcher, so it keeps the old provider config until you reload it.

1. Run:

   ```fish
   paseo reload
   ```

**Done:** `paseo ls` (or `inspect_provider`) shows `claude-lead`, `claude-supervisor`, and
`pi-peer` as available, and `list_models` returns at least one model for `pi-peer`.

If `pi-peer` isn't available and the config sets the built-in `pi` provider to
`"enabled": false`, the disabled base may be the cause. Ask the user before enabling `pi`,
because that also adds a provider that uses their normal Pi profile.

## Verify that each seat reads its own prompt

The previous steps prove only that the filesystem is right. This step proves that each seat
loads its prompt and guards, because a provider whose profile variable isn't applied fails
silently.

For `claude-lead` and `claude-supervisor`:

1. Create an agent with `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`.
2. Ask it for the first line of the `CLAUDE.md` it has loaded.
3. Archive the agent.

For `pi-peer`:

1. Create an agent with `provider: "pi-peer/<model>"`, using a model from `list_models`, and a
   `thinkingOptionId`. Don't pass `settings.modeId`; Pi agents reject it.
2. Ask it to quote the first line of the instructions appended to its system prompt, and
   whether its instructions mention Paseo. A model sometimes quotes the first section heading
   instead; `Start of every task` exists only in `pi/PEER.md`, so it proves the same thing.
3. Ask it to run `git -C /tmp push --dry-run` and report exactly what happened.
4. Archive the agent.

**Done:** each agent answers as the table shows.

| Provider | Expected answer |
|---|---|
| `claude-lead` | First line `# Lead — Project Lead & binding technical arbiter` |
| `claude-supervisor` | First line `# Supervisor — orchestration observer acting for the Human` |
| `pi-peer` | Heading `# Peer — independent co-worker`; no mention of Paseo; the push is blocked with "Pushing is not available in this workspace." |

If a Claude seat returns the user's own `CLAUDE.md`, or the Peer can't name its heading, that
provider's profile variable isn't applied; go back to
[Add the providers to Paseo](#add-the-providers-to-paseo).

If the push isn't blocked, the guard extension didn't load. Check that
`~/.pi/profiles/pi-peer/extensions/peer-guard.ts` links to the kit, then repeat this step for
`pi-peer`.

## Replace the demo rules

The three seat prompts are demo files: the structure is real, but the rules are generic, and
the value comes from your own rules. Before editing, read [WRITING_GUIDE.md](WRITING_GUIDE.md).

Write the files in this order, because each one constrains the next:

1. The target repository's `AGENTS.md`, from `examples/AGENTS_MD_SNIPPET.md`, plus a
   `CLAUDE.md` that contains only `@AGENTS.md`. Every agent reads it, and it is the only place
   the contract boundary is declared.
2. Optional: the target repository's `WORKSPACE_PROTOCOL.md`, from
   `examples/WORKSPACE_PROTOCOL.md`, including the Peer model in its spawn recipes. Only the
   Lead reads it.
3. `pi/PEER.md`: boundaries, handoff shape, evidence standard. Keep HTML comments out of it,
   because Pi shows them to the Peer.
4. `claude/LEAD.md`: acceptance conditions, when to add a Reviewer, what belongs to the Human.
5. `claude/SUPERVISOR.md`: signals worth a look, intervention rights, when prompt patches are
   allowed.
6. `skills/<role>/`: keep, cut, or rewrite skills to fit your process. Keep each role to
   about ten skills the model can trigger on its own, and mark the rest
   `disable-model-invocation: true`.

Then run the check:

```fish
fish KIT_DIR/setup/setup-seats.fish --check
```

**Done:** the check exits 0, and every `TODO` comment in the Claude prompts has an answer or
has been deleted as not applicable.
