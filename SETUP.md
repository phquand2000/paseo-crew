# Set up the seats

This procedure is written for an agent to execute. Read it through once, then work through the
steps in order. Each step ends with a **Done** check; start the next step only when it passes.

In this document, `KIT_DIR` is the directory that contains this file, `REPO_DIR` is the root of
a repository the seats will work in, `SLUG` is that project's short name (by default the
directory name in lowercase), and `REFERENCE.md` is the list of environment behavior that the
config doesn't reveal.

The setup keeps two kinds of file apart:

- **Global, on this machine:** the Paseo providers, the profile directories, the settings, the
  deny lists, and the models.
- **Per project, in `REPO_DIR/.seatworks/`:** every `.md` a seat loads (the Lead's and the
  Peer's prompts and skills, the workspace protocol, and the project notebook). The profiles
  link to these files, so each project can carry its own rules.

The Supervisor is the exception: one seat serves every project, so its prompt and skills stay
in the kit.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the scripts use the `path` builtin)
- jq
- the `claude` CLI
- Pi 0.84.4 or later, logged in to at least one model provider
- a running Paseo daemon

The setup has eight steps. Steps 1–5 set up the machine once; steps 6 and 7 run once for each
project:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the providers to Paseo](#add-the-providers-to-paseo)
4. [Build the Supervisor profile](#build-the-supervisor-profile)
5. [Reload Paseo](#reload-paseo)
6. [Add a project](#add-a-project)
7. [Verify that each seat reads its own prompt](#verify-that-each-seat-reads-its-own-prompt)
8. [Write your own rules](#write-your-own-rules)

Steps 4 to 6 are safe to repeat. Steps 3 and 6 edit a file that also holds your workspaces, so
each starts with a backup.

## Move the kit to a stable path

The scripts create symlinks to absolute paths, so if you move the kit later you must rerun
`setup/setup-seats.fish`. The Supervisor also uses the kit as its working directory and commits
prompt changes here.

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

`examples/paseo-providers.json` holds two entries you merge now: `claude`, the base that holds
the token, and `claude-supervisor`, which extends it. The other two entries, `claude-lead-SLUG`
and `pi-peer-SLUG`, are templates that step 6 copies for each project; leave them out here. You
merge into `.agents.providers` in `~/.paseo/config.json`. That file also holds workspaces and
the agent ledger, so merge the entries rather than replacing the file.

1. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

2. Ask the user for their `CLAUDE_CODE_OAUTH_TOKEN`; they can create one with
   `claude setup-token`. Don't read a token from any other file. If the config's base `claude`
   entry already holds a token, skip this substep: every seat inherits it through `extends`.
3. Look up the real Claude model IDs with Paseo's `list_models`. The IDs in the example file
   are illustrations. If they differ, also correct them in the `claude-lead-SLUG` template,
   because step 6 copies it.
4. Merge `claude` and `claude-supervisor` into `.agents.providers`, replacing the following:
   - `HOME_DIR`: the user's home directory.
   - `OAUTH_TOKEN`: the token from substep 2.
   - Each `models[].id`: a real ID from substep 3.
5. If the config already has a `claude-supervisor` entry from an earlier setup, replace it
   instead of merging into it. The setup script only adds deny entries and never removes them,
   so an old `env` or `disallowedTools` (such as a denied `Write`) would carry over.
6. Leave out the `_doc` key; Paseo's schema rejects unknown keys.

**Done:** all three commands succeed, and the first one lists `claude` and
`claude-supervisor`:

```fish
jq '.agents.providers | keys' ~/.paseo/config.json
jq -e '.agents.providers["claude-supervisor"].env.CLAUDE_CONFIG_DIR' ~/.paseo/config.json
jq -e . ~/.paseo/config.json > /dev/null
```

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Build the Supervisor profile

`setup/setup-seats.fish` builds every seat's profile. With no project added yet it builds only
the Supervisor's, and adds the Supervisor's deny list to its provider. Its configuration is the
block at the top of the script.

1. Run:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish
   ```

**Done:** the script exits 0 and prints `✓ claude-supervisor` with the number of skills in
`skills/supervisor/`, followed by a note that there are no projects yet.

If the script prints `!` lines, each one names the file that is wrong and how. Fix it, then
rerun this step.

To roll back, move `~/.claude/profiles/claude-supervisor` to the Trash and restore
`~/.paseo/config.json.bak`.

## Reload Paseo

Paseo has no file watcher, so it keeps the old provider config until you reload it.

1. Run:

   ```fish
   paseo reload
   ```

**Done:** `paseo provider ls` shows `claude-supervisor` as available.

## Add a project

`setup/add-project.fish` does everything a project needs, and never overwrites a file that
already exists:

- copies the kit's templates from `project/` into `REPO_DIR/.seatworks/`, naming the project's
  Peer provider in the Lead's files;
- adds `AGENTS.md` and a one-line `CLAUDE.md` (`@AGENTS.md`) at the repository root if missing;
- adds the providers `claude-lead-SLUG` and `pi-peer-SLUG` to the Paseo config, after a backup;
- registers the repository as a Paseo project, builds the profiles, and reloads Paseo.

It adds files only; leave the repository's code alone.

1. Pick the Peer model from `paseo provider models pi`. If the built-in `pi` provider is
   disabled, leave out `--model`; the script then lists the models and names the placeholder
   to fill in.
2. Run it, adding `--slug SLUG` if the directory name isn't the short name you want:

   ```fish
   fish KIT_DIR/setup/add-project.fish REPO_DIR --model MODEL_ID
   ```

**Done:** the script exits 0, prints `✓` lines for `claude-lead-SLUG` and `pi-peer-SLUG`, and
these commands show the project, the import line, and a spawn recipe with a real model:

```fish
paseo project ls | grep REPO_DIR
head -1 REPO_DIR/CLAUDE.md
grep -n 'pi-peer-SLUG/' REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
```

If a repository already had an `AGENTS.md`, the script leaves it alone: add the sections of
`examples/AGENTS_MD_SNIPPET.md` to it by hand. If it had a `CLAUDE.md` with rules, move those
rules into `AGENTS.md` and replace `CLAUDE.md` with the line `@AGENTS.md`.

To roll back, restore `~/.paseo/config.json.bak`, run `paseo project delete REPO_DIR`, and move
`~/.claude/profiles/claude-lead-SLUG`, `~/.pi/profiles/pi-peer-SLUG`, and the files the script
listed as added to the Trash.

## Verify that each seat reads its own prompt

The previous steps prove only that the filesystem is right. This step proves that each seat
loads its prompt and guards, because a provider whose profile variable isn't applied fails
silently. Create each agent in the project's workspace.

For `claude-supervisor` and `claude-lead-SLUG`:

1. Create an agent with `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`.
2. Ask it for the first line of the `CLAUDE.md` it has loaded.
3. Archive the agent.

For `pi-peer-SLUG`:

1. Create an agent with `provider: "pi-peer-SLUG/MODEL_ID"` and a `thinkingOptionId`. Don't
   pass `settings.modeId`; Pi agents reject it.
2. Ask it to quote the first line of the instructions appended to its system prompt, and
   whether its instructions mention Paseo. A model sometimes quotes the first section heading
   instead; `Start of every task` exists only in `.seatworks/PEER.md`, so it proves the same
   thing.
3. Ask it to run `git -C /tmp push --dry-run` and report exactly what happened.
4. Archive the agent.

**Done:** each agent answers as the table shows.

| Provider | Expected answer |
|---|---|
| `claude-supervisor` | First line `# Supervisor — orchestration observer acting for the Human` |
| `claude-lead-SLUG` | First line `# Lead — Project Lead & binding technical arbiter` |
| `pi-peer-SLUG` | Heading `# Peer — independent co-worker`; no mention of Paseo; the push is blocked with "Pushing is not available in this workspace." |

If a Claude seat returns the user's own `CLAUDE.md`, or the Peer can't name its heading, that
provider's profile variable isn't applied: check its `env` in `~/.paseo/config.json` and rerun
`fish KIT_DIR/setup/setup-seats.fish --check`.

If the push isn't blocked, the guard extension didn't load. Check that
`~/.pi/profiles/pi-peer-SLUG/extensions/peer-guard.ts` links to the kit, then repeat this step
for `pi-peer-SLUG`.

## Write your own rules

The prompts are demo files: the structure is real, but the rules are generic, and the value
comes from your own rules. Before editing, read [WRITING_GUIDE.md](WRITING_GUIDE.md).

1. Fill in the project's placeholders (the `UPPER_SNAKE_CASE` words in `AGENTS.md` and
   `.seatworks/WORKSPACE_PROTOCOL.md`) with the Human's decisions. The Supervisor's
   `workspace-protocol` skill interviews the Human and does this. Committing is the Human's
   call. List what is still open with:

   ```fish
   grep -noE '\b[A-Z]{2,}(_[A-Z]+)+\b' REPO_DIR/AGENTS.md REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
   ```

2. Rewrite the seat prompts in this order, because each one constrains the next. Edit a
   project's copies in `REPO_DIR/.seatworks/` for rules that belong to that project, and the
   templates in `KIT_DIR/project/` for rules every future project should start with:
   1. `PEER.md`: boundaries, handoff shape, evidence standard. Keep HTML comments out of it,
      because Pi shows them to the Peer.
   2. `LEAD.md`: acceptance conditions, when to add a Reviewer, what belongs to the Human.
   3. `KIT_DIR/claude/SUPERVISOR.md`: signals worth a look, intervention rights, when prompt
      patches are allowed.
   4. `skills/lead/`, `skills/peer/`, and `KIT_DIR/skills/supervisor/`: keep, cut, or rewrite
      skills to fit your process. Keep each role to about ten skills the model can trigger on
      its own, and mark the rest `disable-model-invocation: true`.

Then run the check:

```fish
fish KIT_DIR/setup/setup-seats.fish --check
```

**Done:** the check exits 0, the placeholder search prints nothing, and every `TODO` comment
in the Claude prompts has an answer or has been deleted as not applicable.
