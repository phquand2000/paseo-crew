# Set up the seats

This procedure is written for an agent to execute. Read it through once, then work through the
steps in order. Each step ends with a **Done** check; start the next step only when it passes.

In this document, `KIT_DIR` is the directory that contains this file, `REPO_DIR` is the root of
a repository the seats will work in, `SLUG` is that project's short name (by default the
directory name in lowercase), and `REFERENCE.md` is the list of environment behavior that the
config doesn't reveal.

Two files decide what a seat is. `seats.json` lists the six roles and, for each one, which
harness hosts it, its prompt, its skills, its guards, its deny list, its model, and the skill
gates it must pass. `harness/<id>/harness.json` describes one harness: the environment variable
that moves its config directory, the file it reads as a prompt, where its skills go, how its
settings are written, which refusal form its hooks speak, and how a loaded skill can be
recognised there. Everything else is composed from those two, so a role moves to another coding
agent by one edit.

The setup keeps two kinds of file apart:

- **Global, on this machine:** the Paseo providers, the profile directories, the settings, the
  deny lists, and the models.
- **Per project, in `REPO_DIR/.seatworks/`:** every `.md` a seat loads: the Supervisor's,
  Lead's, Peer's, Reviewer's, and watcher's prompts, their skills, the workspace protocol, the
  notebook, and the Supervisor's records. The profiles link to these files.

Each project gets six seats, named for their roles: `supervisor-SLUG`, `lead-SLUG`,
`watcher-SLUG`, `peer-SLUG`, `peer-ro-SLUG` (the Peer with edits blocked), and `reviewer-SLUG`.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the scripts use the `path` builtin)
- jq
- a running Paseo daemon
- every coding agent a role in `seats.json` is assigned to. Read the assignments with
  `jq -r '.seats[] | "\(.role): \(.harness)"' KIT_DIR/seats.json`, then check each harness's
  `versionCommand`. As shipped that is the `claude` CLI, and Pi 0.84.4 or later logged in to at
  least one model provider.
- the `ocr` CLI ([Open Code Review](https://github.com/alibaba/open-code-review)), which the
  Reviewer runs: `npm install -g @alibaba-group/open-code-review`

The setup has six steps. Steps 1–3 set up the machine once; steps 4 and 5 run once for each
project:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the base providers to Paseo](#add-the-base-providers-to-paseo)
4. [Add a project](#add-a-project)
5. [Verify that each seat reads its own prompt and skills](#verify-that-each-seat-reads-its-own-prompt-and-skills)
6. [Write your own rules](#write-your-own-rules)

Step 4 is safe to repeat: without `--refresh` it never overwrites a project file, and it updates
only the kit-managed paths of existing providers and the notes of existing profiles. Steps 3 and
4 edit a file that also holds your workspaces, so each starts with a backup.

## Move the kit to a stable path

The profiles link to the kit's settings and guards by absolute path, each seat finds the kit
through `SEATWORKS_KIT`, and the guards read `seats.json` from there, so if you move the kit
later you must rerun step 4 for every project.

1. Move this directory to where it will live long-term, for example `~/.config/seatworks`.
2. In `KIT_DIR`, create the repository and the first commit:

   ```fish
   git init
   git add -A
   git commit -m "Initial seatworks kit"
   ```

**Done:** `git -C KIT_DIR log --oneline` prints at least one commit.

## Check the prerequisites

1. Check the tools that every setup needs:

   ```fish
   fish --version; jq --version; paseo ls
   ```

2. Check each harness a role uses, and compare its version with the one its manifest was
   verified on:

   ```fish
   jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json | while read -l h
       jq -r '"\(.id): verified \(.verified // "null"), check with `\(.versionCommand)`"' KIT_DIR/harness/$h/harness.json
   end
   ```

   Run each `versionCommand` it prints. A version other than the manifest's `verified` value is
   not an error; step 5's `--probe` settles whether the facts still hold. A `verified` of `null`
   means nobody has confirmed that harness on any machine: read `KIT_DIR/harness/<id>/NOTES.md`
   before you send a role to it.

3. If a role uses a harness whose manifest sets `provider.env` with an `ENV_KEY` entry, export
   that key for the Paseo daemon before you build the seat. Read the variable's name, never its
   value, from the manifest:

   ```fish
   jq -r '.provider.env | to_entries[] | select(.key | endswith("_ENV_KEY")) | "export \(.value) yourself; the kit never stores it"' KIT_DIR/harness/codex/harness.json
   ```

4. Check the logins and Paseo's tool injection. For the Pi seats:

   ```fish
   test -f ~/.pi/agent/auth.json; and echo "pi login: ok"
   jq '.daemon.mcp' ~/.paseo/config.json
   ```

**Done:** fish reports 3.5 or later, `paseo ls` exits without an error, every harness's
`versionCommand` prints a version, each harness's login exists, and `.daemon.mcp` shows
`"enabled": true` and `"injectIntoAgents": true`.

If a tool or a login is missing, stop and ask the user to install it or to log in (for Pi, run
`pi`, then `/login`, or save an API key); don't do it yourself. If `injectIntoAgents` isn't
`true`, ask the user before changing it, because it gives Paseo tools to every agent the daemon
starts.

## Add the base providers to Paseo

Every seat extends the base provider of its harness and inherits its credentials.
`examples/paseo-providers.json` holds one base entry per harness; the per-project seats are not
in that file, because step 4 composes them from `seats.json` and the manifests.

1. List the base providers the roles need, and check which already exist:

   ```fish
   jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json | while read -l h
       set -l b (jq -r '.baseProvider' KIT_DIR/harness/$h/harness.json)
       echo "$h needs base provider $b: "(jq -r --arg b $b 'if .agents.providers[$b] then "present" else "missing" end' ~/.paseo/config.json)
   end
   ```

2. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

3. Merge any missing base entry from `examples/paseo-providers.json` into
   `.agents.providers`, dropping its `_doc` key.
4. For the `claude` base provider, check whether it already holds a token, without printing it:

   ```fish
   jq '(.agents.providers.claude.env.CLAUDE_CODE_OAUTH_TOKEN // "") | length > 0' ~/.paseo/config.json
   ```

   If it prints `false`, ask the user for their `CLAUDE_CODE_OAUTH_TOKEN`; they can create one
   with `claude setup-token`. Don't read a token from any other file. Then set it, keeping the
   rest of the file:

   ```fish
   jq --arg t TOKEN '.agents.providers.claude.env.CLAUDE_CODE_OAUTH_TOKEN = $t' ~/.paseo/config.json > ~/.paseo/config.json.new; and mv ~/.paseo/config.json.new ~/.paseo/config.json; and chmod 600 ~/.paseo/config.json
   ```

5. Look up the real model IDs for each base provider with `paseo provider models BASE`. If they
   differ from the `models` a role names in `seats.json`, correct them there: step 4 copies each
   seat's `isDefault` model and thinking option into its provider and its agent profile.

**Done:** the command from substep 1 prints `present` for every harness, the `claude` token check
prints `true`, and `jq -e . ~/.paseo/config.json` succeeds.

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Add a project

`setup/add-project.fish` does everything a git repository needs, and never overwrites a file
that already exists:

- copies the kit's templates from `project/` into `REPO_DIR/.seatworks/`, naming the project's
  seats in them;
- adds `AGENTS.md` and a one-line `CLAUDE.md` (`@AGENTS.md`) at the repository root if missing;
- composes the six providers from `seats.json` and the harness manifests and adds them to the
  Paseo config, or refreshes the kit-managed env of existing ones (the harness's config-directory
  variable, and every `SEATWORKS_*` value), after a backup named
  `~/.paseo/config.json.bak.YYYYmmdd-HHMMSS`;
- adds one Paseo agent profile per seat, or refreshes the notes of an existing one, keeping its
  model; Paseo's app offers them to you, and the seats read them through `list_profiles`;
- registers the repository as a Paseo project, builds the profiles, and reloads Paseo.

It adds files only; leave the repository's code alone. If another repository already uses the
slug, it stops and asks for `--slug`.

1. The models come from `seats.json`: the Supervisor runs Opus 5 at thinking `high`, the Lead
   Opus 5 at `medium`, the watcher Haiku, and any role that names no model takes `--model`
   (default `zai/glm-5.3`), which is how the Peer, read-only Peer, and Reviewer are set. For
   another model there, pass `--model MODEL_ID` with an ID from `paseo provider models BASE`.
2. Run it, adding `--slug SLUG` if the directory name isn't the short name you want:

   ```fish
   fish KIT_DIR/setup/add-project.fish REPO_DIR
   ```

**Done:** the script exits 0, prints a `✓` line for each of the six seats and no warning about
a base provider's token (if it does, go back to step 3), and these commands show the project,
the import line, and a spawn recipe with a real model:

```fish
paseo project ls | grep REPO_DIR
head -1 REPO_DIR/CLAUDE.md
grep -n 'peer-SLUG/' REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
```

If a repository already had an `AGENTS.md`, the script leaves it alone: add the sections of
`examples/AGENTS_MD_SNIPPET.md` to it by hand. If it had a `CLAUDE.md` with rules, move those
rules into `AGENTS.md` and replace `CLAUDE.md` with the line `@AGENTS.md`.

The Reviewer runs Open Code Review in delegation mode, reviewing with its own model, until
you give OCR a model of its own: run `ocr config provider` (it asks for an API key, which is
yours to enter) and check it with `ocr llm test`. A different model family there gives reviews
different blind spots, and it sends the code under review to that provider.

To roll back, restore the first backup the run printed (`~/.paseo/config.json.bak.YYYYmmdd-HHMMSS`;
the setup script may print a later one), run `paseo project delete PROJECT_ID` with the ID
`paseo project ls` shows for `REPO_DIR` (a path isn't accepted), and move the six profiles and
the files the script listed as added to the Trash. The profile directories are
`<profileRoot>/<role>-SLUG` for each role, with each harness's root from its manifest:

```fish
jq -r '.seats[] | "\(.role) \(.harness)"' KIT_DIR/seats.json | while read -l role h
    echo (jq -r '.profileRoot' KIT_DIR/harness/$h/harness.json | string replace HOME $HOME)/$role-SLUG
end
```

## Verify that each seat reads its own prompt and skills

The previous steps prove only that the filesystem is right. This step proves that each seat
loads its prompt, its skills, and its guards, because a provider whose profile variable isn't
applied fails silently, and a harness that looks for skills somewhere else offers the seat none.

1. Ask each seat's harness which skills it loads:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish --check --probe
   ```

   For a harness with a free, authoritative probe (Pi) this runs on every `--check`. For one
   probed by asking the seat (Claude Code) `--probe` spends one cheap model call per seat. A line
   reads `live probe saw N skills and offers all M the kit linked for the model`; skills marked
   `disable-model-invocation: true` are counted as held back, because the model's list is meant
   not to show them.

2. Then check the prompts and the guards by hand. Run each agent in `REPO_DIR`.

   For `supervisor-SLUG`, `lead-SLUG`, and `watcher-SLUG`, whose harness has modes:

   1. Create an agent with the `settings.modeId` and `thinkingOptionId` its agent profile names;
      the watcher's Haiku profile names no `thinkingOptionId`.
   2. Ask it for the first line of the instruction file it has loaded.
   3. Archive the agent.

   For `peer-SLUG`, whose harness has none:

   1. Create an agent with `provider: "peer-SLUG/MODEL_ID"` and a `thinkingOptionId`. Don't
      pass `settings.modeId`; Pi agents reject it.
   2. Ask it, without running tools, to quote the heading of its instructions that begins with
      `# Peer`, and whether its instructions mention Paseo. Asked for the "first line", a model
      often quotes the harness's own system prompt instead.
   3. Ask it to run `git -C /tmp push --dry-run` and report exactly what happened.
   4. Archive the agent.

   For `reviewer-SLUG` and `peer-ro-SLUG`, repeat those steps with the heading that begins
   with `# Reviewer` and `# Peer` respectively, and in step 3 ask each instead to create
   `probe.txt` in `REPO_DIR` with its write tool.

3. Check that the Lead's skill gates hold. Create a `lead-SLUG` agent, ask it to run
   `git merge some-branch` without loading a skill first, and archive it.

**Done:** `--check --probe` exits 0, and each agent answers as the table shows.

| Provider | Expected answer |
|---|---|
| `supervisor-SLUG` | First line `# Supervisor — orchestration observer acting for the Human` |
| `lead-SLUG` | First line `# Lead — Project Lead & binding technical arbiter` |
| `watcher-SLUG` | First line `# Watcher — attention sweeps for the Supervisor` |
| `peer-SLUG` | Heading `# Peer — independent co-worker`; no mention of Paseo; the push is blocked with "Pushing is not available in this workspace." |
| `reviewer-SLUG` | Heading `# Reviewer — independent code review`; no mention of Paseo; the write is blocked with "Editing files is not available in this role." |
| `peer-ro-SLUG` | Heading `# Peer — independent co-worker`; no mention of Paseo; the write is blocked with the same message |
| `lead-SLUG` merge | Refused: "Skill guard: You can't merge without loading the `integration` skill first" |

If a seat returns the user's own instruction file, or the Peer can't name its heading, that
provider's profile variable isn't applied: check its `env` in `~/.paseo/config.json` against the
`configDirEnv` in its harness manifest, and rerun `fish KIT_DIR/setup/setup-seats.fish --check`.

If the push isn't blocked, the guard extension didn't load. Check that
`~/.pi/profiles/peer-SLUG/extensions/peer-guard.ts` links to the kit, then repeat this step
for `peer-SLUG`.

If the merge isn't blocked, the skill guard didn't run: check that the Lead's provider has
`env.SEATWORKS_KIT`, that `harness/claude/settings/lead.settings.json` has a `PreToolUse` entry
running `skill-guard.sh`, and that the link exists in the profile.

Finally, leave one Supervisor running for the user: start an agent on `supervisor-SLUG` in
`REPO_DIR` and keep it. It keeps a watcher running while a Lead works.

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
   templates in `KIT_DIR/project/` for rules every project should start with. A project's own
   copies can differ, but `--refresh` replaces them, so keep a rule for one project only in its
   `AGENTS.md` or `.seatworks/WORKSPACE_PROTOCOL.md`:
   1. `PEER.md` and `REVIEWER.md`: boundaries, handoff shape, evidence standard. Keep HTML
      comments out of both while their harness's `promptComments` is `shown`, because it shows
      them to the seat.
   2. `LEAD.md`: acceptance conditions, when to add a Reviewer, what belongs to the Human.
   3. `SUPERVISOR.md` and `WATCHER.md`: signals worth a look (the watcher's trigger table),
      intervention rights, when prompt patches are allowed.
   4. `skills/`: keep, cut, or rewrite each role's skills to fit your process. Keep each role
      to about ten skills the model can trigger on its own, and mark the rest
      `disable-model-invocation: true`.
   5. `seats.json`'s `skillGates`: add a gate only for a skill a seat has been observed to skip,
      with the reason in `because`; the guard shows that text when it refuses.

Then run the check:

```fish
fish KIT_DIR/setup/setup-seats.fish --check
```

**Done:** the check exits 0, the placeholder search prints nothing, and every `TODO` comment
in the prompts whose harness strips comments has an answer or has been deleted as not applicable.
