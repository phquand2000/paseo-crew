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
- **Per project, in `REPO_DIR/.seatworks/`:** every `.md` a seat loads: the Supervisor's, the
  Lead's, and the Peer's prompts and skills, the workspace protocol, the notebook, and the
  Supervisor's records. The profiles link to these files.

Each project gets four seats: `claude-supervisor-SLUG`, `claude-lead-SLUG`,
`claude-watcher-SLUG`, and `pi-peer-SLUG`.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the scripts use the `path` builtin)
- jq
- the `claude` CLI
- Pi 0.84.4 or later, logged in to at least one model provider
- a running Paseo daemon

The setup has six steps. Steps 1–3 set up the machine once; steps 4 and 5 run once for each
project:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the base provider to Paseo](#add-the-base-provider-to-paseo)
4. [Add a project](#add-a-project)
5. [Verify that each seat reads its own prompt](#verify-that-each-seat-reads-its-own-prompt)
6. [Write your own rules](#write-your-own-rules)

Step 4 is safe to repeat: it never overwrites a file. Steps 3 and 4 edit a file that also holds
your workspaces, so each starts with a backup.

## Move the kit to a stable path

The profiles link to the kit's settings and guard by absolute path, and each Supervisor finds
the kit through `SEATWORKS_KIT`, so if you move the kit later you must rerun step 4 for every
project.

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

## Add the base provider to Paseo

Every Claude seat extends the base `claude` provider and inherits its token. The other entries
in `examples/paseo-providers.json` are templates that step 4 copies for each project.

1. Check whether the base already holds a token, without printing it:

   ```fish
   jq '(.agents.providers.claude.env.CLAUDE_CODE_OAUTH_TOKEN // "") | length > 0' ~/.paseo/config.json
   ```

   If it prints `true`, skip to the Done check.
2. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

3. Ask the user for their `CLAUDE_CODE_OAUTH_TOKEN`; they can create one with
   `claude setup-token`. Don't read a token from any other file.
4. Set it on the base provider, keeping the rest of the file:

   ```fish
   jq --arg t TOKEN '.agents.providers.claude.env.CLAUDE_CODE_OAUTH_TOKEN = $t' ~/.paseo/config.json > ~/.paseo/config.json.new; and mv ~/.paseo/config.json.new ~/.paseo/config.json; and chmod 600 ~/.paseo/config.json
   ```

5. Look up the real Claude model IDs with `paseo provider models claude`. If they differ from
   the IDs in the `claude-supervisor-SLUG` and `claude-lead-SLUG` templates, correct the
   templates, because step 4 copies them.

**Done:** the command from substep 1 prints `true`, and `jq -e . ~/.paseo/config.json` succeeds.

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Add a project

`setup/add-project.fish` does everything a project needs, and never overwrites a file that
already exists:

- copies the kit's templates from `project/` into `REPO_DIR/.seatworks/`, naming the project's
  seats in them;
- adds `AGENTS.md` and a one-line `CLAUDE.md` (`@AGENTS.md`) at the repository root if missing;
- adds the providers `claude-supervisor-SLUG`, `claude-lead-SLUG`, `claude-watcher-SLUG`, and
  `pi-peer-SLUG` to the Paseo config, after a backup;
- adds one Paseo agent profile per seat, a single one for the Peer; Paseo's app offers them to
  you, and the seats read them through `list_profiles`;
- registers the repository as a Paseo project, builds the profiles, and reloads Paseo.

It adds files only; leave the repository's code alone.

1. Pick the Peer model from `paseo provider models pi`. If the built-in `pi` provider is
   disabled, leave out `--model`; the script then lists the models and names the placeholder
   to fill in.
2. Run it, adding `--slug SLUG` if the directory name isn't the short name you want:

   ```fish
   fish KIT_DIR/setup/add-project.fish REPO_DIR --model MODEL_ID
   ```

**Done:** the script exits 0 and prints `✓` lines for `claude-supervisor-SLUG`,
`claude-lead-SLUG`, `claude-watcher-SLUG`, and `pi-peer-SLUG`, and these commands show the project, the import line,
and a spawn recipe with a real model:

```fish
paseo project ls | grep REPO_DIR
head -1 REPO_DIR/CLAUDE.md
grep -n 'pi-peer-SLUG/' REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
```

If a repository already had an `AGENTS.md`, the script leaves it alone: add the sections of
`examples/AGENTS_MD_SNIPPET.md` to it by hand. If it had a `CLAUDE.md` with rules, move those
rules into `AGENTS.md` and replace `CLAUDE.md` with the line `@AGENTS.md`.

To roll back, restore `~/.paseo/config.json.bak`, run `paseo project delete PROJECT_ID` with the
ID `paseo project ls` shows for `REPO_DIR` (a path isn't accepted), and move the four profiles
(`~/.claude/profiles/claude-supervisor-SLUG`, `~/.claude/profiles/claude-lead-SLUG`,
`~/.claude/profiles/claude-watcher-SLUG`, `~/.pi/profiles/pi-peer-SLUG`) and the files the
script listed as added to the Trash.

## Verify that each seat reads its own prompt

The previous steps prove only that the filesystem is right. This step proves that each seat
loads its prompt and guards, because a provider whose profile variable isn't applied fails
silently. Run each agent in `REPO_DIR`.

For `claude-supervisor-SLUG`, `claude-lead-SLUG`, and `claude-watcher-SLUG`:

1. Create an agent with `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`; the
   watcher runs on `claude-haiku-4-5`, which takes no `thinkingOptionId`.
2. Ask it for the first line of the `CLAUDE.md` it has loaded.
3. Archive the agent.

For `pi-peer-SLUG`:

1. Create an agent with `provider: "pi-peer-SLUG/MODEL_ID"` and a `thinkingOptionId`. Don't
   pass `settings.modeId`; Pi agents reject it.
2. Ask it, without running tools, to quote the heading of its instructions that begins with
   `# Peer`, and whether its instructions mention Paseo. Asked for the "first line", a model
   often quotes Pi's own system prompt instead.
3. Ask it to run `git -C /tmp push --dry-run` and report exactly what happened.
4. Archive the agent.

**Done:** each agent answers as the table shows.

| Provider | Expected answer |
|---|---|
| `claude-supervisor-SLUG` | First line `# Supervisor — orchestration observer acting for the Human` |
| `claude-lead-SLUG` | First line `# Lead — Project Lead & binding technical arbiter` |
| `claude-watcher-SLUG` | First line `# Watcher — attention sweeps for the Supervisor` |
| `pi-peer-SLUG` | Heading `# Peer — independent co-worker`; no mention of Paseo; the push is blocked with "Pushing is not available in this workspace." |

If a Claude seat returns the user's own `CLAUDE.md`, or the Peer can't name its heading, that
provider's profile variable isn't applied: check its `env` in `~/.paseo/config.json` and rerun
`fish KIT_DIR/setup/setup-seats.fish --check`.

If the push isn't blocked, the guard extension didn't load. Check that
`~/.pi/profiles/pi-peer-SLUG/extensions/peer-guard.ts` links to the kit, then repeat this step
for `pi-peer-SLUG`.

Finally, leave one Supervisor running for the user: start an agent on
`claude-supervisor-SLUG` in `REPO_DIR` and keep it. It starts the watcher itself each time it
creates a Lead.

## Write your own rules

The prompts are demo files: the structure is real, but the rules are generic, and the value
comes from your own rules. Before editing, read [WRITING_GUIDE.md](WRITING_GUIDE.md).

1. Fill in the project's placeholders (the `UPPER_SNAKE_CASE` words in `AGENTS.md` and
   `.seatworks/WORKSPACE_PROTOCOL.md`) with the Human's decisions. Ask the project's Supervisor
   to run its `workspace-protocol` skill, which interviews the Human and does this. Committing
   is the Human's call. List what is still open with:

   ```fish
   grep -noE '\b[A-Z]{2,}(_[A-Z]+)+\b' REPO_DIR/AGENTS.md REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
   ```

2. Rewrite the seat prompts in this order, because each one constrains the next. Edit the
   project's copies in `REPO_DIR/.seatworks/` for rules that belong to that project, and the
   templates in `KIT_DIR/project/` for rules every future project should start with:
   1. `PEER.md`: boundaries, handoff shape, evidence standard. Keep HTML comments out of it,
      because Pi shows them to the Peer.
   2. `LEAD.md`: acceptance conditions, when to add a Reviewer, what belongs to the Human.
   3. `SUPERVISOR.md`: signals worth a look, intervention rights, when prompt patches are
      allowed.
   4. `skills/supervisor/`, `skills/lead/`, and `skills/peer/`: keep, cut, or rewrite skills to
      fit your process. Keep each role to about ten skills the model can trigger on its own, and
      mark the rest `disable-model-invocation: true`.

Then run the check:

```fish
fish KIT_DIR/setup/setup-seats.fish --check
```

**Done:** the check exits 0, the placeholder search prints nothing, and every `TODO` comment
in the Claude prompts has an answer or has been deleted as not applicable.
