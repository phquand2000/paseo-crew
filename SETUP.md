# Set up the seats

This procedure is for an agent to execute. Work the steps in order; each ends with a **Done** check,
and the next starts only when it passes.

`KIT_DIR` is the directory holding this file, `REPO_DIR` a repository the seats will work in, `SLUG`
that project's short name (by default its directory name in lowercase), and `BASE` a harness's base
provider. `seats.json` and `harness/<id>/harness.json` decide what a seat is; everything else is
composed from them. REFERENCE.md explains behavior the config doesn't show.

Before you start, make sure the machine has:

- fish 3.5 or later, jq, and a running Paseo 0.8 daemon
- every coding agent `seats.json` assigns, logged in, at or above its manifest's `verified` version
- the `ocr` CLI (`npm install -g @alibaba-group/open-code-review`). The Reviewer uses only
  `ocr delegate`, which needs no key and runs no model; without the CLI it falls back to
  `git show --stat` and says so.

Steps 1–4 run once per machine and steps 5–8 once per project:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the base providers to Paseo](#add-the-base-providers-to-paseo)
4. [Compose the five seats](#compose-the-five-seats)
5. [Add a project](#add-a-project)
6. [Pin a model for one project](#pin-a-model-for-one-project)
7. [Verify each seat's prompt and skills](#verify-each-seats-prompt-and-skills)
8. [Write your own rules](#write-your-own-rules)

Steps 4 and 5 are safe to repeat. Steps 3–5 edit the config that also holds your workspaces, so
each starts with a backup.

## Move the kit to a stable path

Seat directories link to the kit by absolute path, so after a later move, rerun step 4 and then
step 5 for every project.

1. Move this directory to where it will live, for example `~/.config/seatworks`.
2. Make it a repository:

   ```fish
   git init; git add -A; git commit -m "Initial seatworks kit"
   ```

**Done:** `git -C KIT_DIR log --oneline` prints a commit.

## Check the prerequisites

1. Check the tools:

   ```fish
   fish --version; jq --version; paseo ls
   ```

2. List each harness in use with the version its facts were verified on, and run each
   `versionCommand` it prints:

   ```fish
   jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json | while read -l h
       jq -r '"\(.id): verified \(.verified // "null"), check with `\(.versionCommand)`"' KIT_DIR/harness/$h/harness.json
   end
   ```

   A different version is not an error; step 7's `--probe` settles it. `verified: null` means
   unconfirmed: read that harness's `NOTES.md` first.
3. Print the environment keys a harness needs exported for the daemon (names only, never values):

   ```fish
   jq -r '.provider.env // {} | to_entries[] | select(.key | endswith("_ENV_KEY")) | "export \(.value) yourself; the kit never stores it"' KIT_DIR/harness/*/harness.json
   ```

4. Check each required login and the MCP servers the seats get:

   ```fish
   jq -r '(.links // [])[] | select(.required) | "\(.target): \(.required)"' KIT_DIR/harness/*/harness.json
   jq -r '.mcpServers | to_entries[] | "\(.key): \(.value.url // .value.command)"' KIT_DIR/seats.json
   ```

   A missing MCP program costs a seat only that server's tools.

**Done:** fish is 3.5 or later, `paseo ls` succeeds, every `versionCommand` prints a version, and
each login exists. If something is missing, stop and ask the user to install it or log in; don't do
it yourself. Tell the user step 4 turns on `daemon.mcp`, which gives Paseo tools to every agent the
daemon starts.

## Add the base providers to Paseo

A seat extends its harness's base provider and inherits its credentials, except where the
manifest's `baseProvider` is `acp`: Paseo launches that agent over ACP with no base entry, and it
logs in through its own CLI. `examples/paseo-providers.json` holds the base entries.

1. Check which base providers exist:

   ```fish
   for h in (jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json)
       set -l b (jq -r .baseProvider KIT_DIR/harness/$h/harness.json)
       test $b = acp; and continue
       jq -r --arg b $b '"\($b): \(if .agents.providers[$b] then "present" else "missing" end)"' ~/.paseo/config.json
   end
   ```

2. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks; chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

3. Merge each missing entry from `examples/paseo-providers.json` into `.agents.providers`, without
   its `_doc` key. Paseo ships some providers disabled, so also give every base provider the
   example marks `"enabled": true` that key.
4. Check each base credential is set, without printing it:

   ```fish
   jq -r '[.baseProvider, (.provider.baseCredential.env // "-"), (.provider.baseCredential.create // "-")] | @tsv' KIT_DIR/harness/*/harness.json | while read -l b v create
       test $v = -; and continue
       echo "$b needs $v (create: $create) set: "(jq -r --arg b $b --arg v $v '(.agents.providers[$b].env[$v] // "") != ""' ~/.paseo/config.json)
   end
   ```

   For each `false`, ask the user to set it in the Paseo app or under `.agents.providers.BASE.env`.
   Never read it from another file or put it on a command line.
5. Compare `paseo provider models BASE` with the `models` each role names in `seats.json`, and
   correct `seats.json`.

**Done:** step 1 prints `present` for every harness, step 4 prints `true` for every credential,
and `jq -e . ~/.paseo/config.json` succeeds. To roll back, restore the `.pre-seatworks` copy.

## Compose the five seats

`setup/setup-seats.fish` composes the five role providers and profiles from `seats.json` and the
manifests, writing only what differs after a timestamped backup of `~/.paseo/config.json`.

1. Compose the seats (with no project yet it ends with `no projects yet`):

   ```fish
   fish KIT_DIR/setup/setup-seats.fish
   ```

2. Install the plugin. It needs `jq .pluginsEnabled ~/.paseo/config.json` to print `true`; ask the
   user before turning that on:

   ```fish
   paseo plugin install KIT_DIR/plugin
   ```

3. Restart the daemon, since a reload builds nothing for a new provider:

   ```fish
   paseo daemon restart
   ```

**Done:** the run printed no `!` line, `paseo plugin ls` shows `seatworks` running, and this prints
nothing:

```fish
jq -r '.seats[].role' KIT_DIR/seats.json | while read -l r
    jq -e --arg r $r '(.agents.providers[$r] != null) and any(.daemon.agentProfiles[]?; .id == $r)' ~/.paseo/config.json >/dev/null; or echo "$r: missing"
end
```

To roll back, restore the backup the run named.

## Add a project

`setup/add-project.fish` copies `project/` into `REPO_DIR/.seatworks/`, writes `project.json`, adds
`AGENTS.md` if missing plus an `@AGENTS.md` pointer for each harness `contextFile` that needs one,
registers the Paseo project, builds the five seat directories, and reloads Paseo. It changes no
code, and stops asking for `--slug` if another repository has the slug.

| Path | Holds | `--refresh` |
|---|---|---|
| `project.json` | slug, models pinned per role, attention settings | never replaced |
| `prompts/` | one prompt per seat | replaced |
| `guides/` | `WORKSPACE_PROTOCOL.md`, `DIRECTIVE.md`, `FEATURE_INTAKE.md`, `PLANS.md`, `ADR.md`, `REVIEW.md`, `BRIEF.md`, `STRUCTURAL_LENSES.md` | replaced, except a filled-in `WORKSPACE_PROTOCOL.md` |
| `skills/` | each role's skills | replaced; a dropped skill is retired into `records/drafts/` |
| `records/` | `NOTEBOOK.md`, `attention/`, `lessons/`, `drafts/` | never replaced |

1. Read each seat's model; a role naming none uses its harness's `provider.defaultModel`:

   ```fish
   jq -r '.seats[] | "\(.role) on \(.harness): \(.byHarness[.harness].models[0].id // "from its harness")"' KIT_DIR/seats.json
   ```

2. Run it, adding `--slug SLUG` if the directory name isn't the short name you want:

   ```fish
   fish KIT_DIR/setup/add-project.fish REPO_DIR
   ```

3. If the repository already had an `AGENTS.md`, add the sections of
   `examples/AGENTS_MD_SNIPPET.md` by hand, and move any rules out of a pointer file into
   `AGENTS.md`, leaving the pointer as the single line `@AGENTS.md`.

**Done:** the script exits 0 with a `✓` line per seat and no base-credential warning (if there is
one, go back to step 3), and these show the slug, the project, and the routing placeholders:

```fish
jq -r .slug REPO_DIR/.seatworks/project.json
paseo project ls | grep REPO_DIR
grep -nF '<which changes get an independent Reviewer' REPO_DIR/.seatworks/guides/WORKSPACE_PROTOCOL.md
```

To roll back, run `paseo project delete PROJECT_ID` with the ID `paseo project ls` shows, then move
the files the script listed as added and the five `<profileRoot>/<role>-SLUG` directories to the
Trash.

## Pin a model for one project

Optional. To give one project another model for a role, name it in that project's `project.json`;
nothing global changes.

1. Take the ID from `paseo provider models BASE`, spelled as that harness spells a model.
2. Pin it, or pass `--model MODEL_ID` to step 5's command to pin it for every role whose
   `seats.json` entry names no model:

   ```fish
   jq '.models.lead = "MODEL_ID"' REPO_DIR/.seatworks/project.json >/tmp/p.json; and mv /tmp/p.json REPO_DIR/.seatworks/project.json
   ```

**Done:** `jq .models REPO_DIR/.seatworks/project.json` prints the role and an ID the provider lists.
The next seat started runs it; running seats keep theirs.

## Verify each seat's prompt and skills

A seat whose config directory isn't applied runs on the user's own config and reports no error, so
prove each seat loads its own.

1. Ask each harness which skills it loads:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish --check --probe
   ```

2. Ask each seat for its heading, one at a time, always in the workspace `paseo workspace ls` shows
   for REPO_DIR (without `--workspace`, `paseo run` makes a new one), copying model, mode and
   thinking option from the role's profile, and leaving out whichever the profile doesn't set:

   ```fish
   paseo run --provider ROLE/MODEL_ID --mode MODE_ID --thinking THINKING_ID --workspace WORKSPACE_ID 'Without running any tool, quote the "# " heading of your instructions, and say whether they mention Paseo.'
   paseo archive AGENT_ID
   ```

3. Check the limits, each in its own agent in `REPO_DIR`, archived afterwards: ask `peer` to run
   `git push --dry-run`, `reviewer` to create `probe.txt` with its write tool, and `lead` to create
   `probe.txt` in your home directory with a shell command and to create a workspace.

**Done:** `--check --probe` exits 0; each seat quotes its heading; `peer`'s push, `reviewer`'s write
and `lead`'s shell write are refused; and `lead` has no tool that creates a workspace.

| Provider | Heading |
|---|---|
| `supervisor` | `# Supervisor — orchestration observer acting for the Human` |
| `lead` | `# Lead — Project Lead & binding technical arbiter` |
| `watcher` | `# Watcher — attention sweeps for the Supervisor` |
| `peer` | `# Peer — independent co-worker`, with no mention of Paseo |
| `reviewer` | `# Reviewer — independent code review`, with no mention of Paseo |

If a seat quotes the user's own instruction file, check its `--cwd`, the slug in `project.json`, and
that `<profileRoot>/<role>-SLUG` exists, then rerun step 5. If a limit doesn't refuse, run
`setup-seats.fish --check` and check the seat directory carries the role's settings from
`harness/<id>/`. Then repeat this step for that seat.

Finally, leave one Supervisor running in `REPO_DIR` for the user.

## Write your own rules

The prompts are demo files: the structure is real, the rules generic. Read
[WRITING_GUIDE.md](WRITING_GUIDE.md) before editing.

1. Replace each `<hint>` in `AGENTS.md` and `.seatworks/guides/WORKSPACE_PROTOCOL.md` with the
   Human's decision, or delete the line to keep the default. List what is open:

   ```fish
   grep -nE '(^|[^[:alnum:]_`])<[a-z][^<>`]*>' REPO_DIR/AGENTS.md REPO_DIR/.seatworks/guides/WORKSPACE_PROTOCOL.md
   ```

2. Rewrite in this order, since each constrains the next: `PEER.md` and `REVIEWER.md`, then
   `LEAD.md`, then `SUPERVISOR.md` and `WATCHER.md`, then `skills/`. Rules for every project go in
   `KIT_DIR/project/`; for one project, code rules go in its `AGENTS.md` and coordination in its
   `WORKSPACE_PROTOCOL.md`, because `--refresh` replaces the rest.
3. Run the check:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish --check
   ```

**Done:** the check exits 0 and the placeholder search prints nothing.
