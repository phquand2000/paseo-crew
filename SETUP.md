# Set up the seats

This procedure is written for an agent to execute. Read it through once, then work the steps in
order; each ends with a **Done** check, and the next starts only when it passes.

In this document, `KIT_DIR` is the directory that contains this file, `REPO_DIR` is the root of
a repository the seats will work in, `SLUG` is that project's short name (by default the
directory name in lowercase), and `BASE` is a harness's base provider.

Two files decide what a seat is: `seats.json` lists the six roles with each one's harness,
prompt, skills, guards, deny list, model, and skill gates; `harness/<id>/harness.json` describes
one harness. A role moves to another coding agent by one edit, because everything else is
composed from those two. `REFERENCE.md` holds the environment behavior the config doesn't
reveal.

The setup keeps two kinds of file apart:

- **Global, on this machine:** the six Paseo providers and six agent profiles, one per role,
  with their settings, deny lists, models, and seat directories. Adding a project adds nothing
  here.
- **Per project, in `REPO_DIR/.seatworks/`:** every `.md` a seat loads — the five seat prompts,
  their skills, the workspace protocol, the notebook, the Supervisor's records — and
  `project.json`, which names the slug.

Each provider launches through one shared room, `harness/common/bin/seat-room`, which walks up
from the agent's working directory to the nearest `.seatworks/`, reads the slug from its
`project.json`, and points the harness's config directory at `<profileRoot>/<role>-SLUG`. So a
seat belongs to the project it starts in: start every seat in `REPO_DIR`; started anywhere else,
a provider gives you the plain coding agent.

The seats are named for their roles alone: `supervisor`, `lead`, `watcher`, `peer`, `peer-ro`
(the Peer with edits blocked), and `reviewer`. The same six serve every project.

Before you start, make sure the machine has the following:

- fish 3.5 or later (the scripts use the `path` builtin)
- jq
- a running Paseo daemon
- every coding agent `seats.json` assigns a role to, at or above the version its manifest
  records, and logged in; step 2 lists them
- the `ocr` CLI ([Open Code Review](https://github.com/alibaba/open-code-review)), which the
  Reviewer runs: `npm install -g @alibaba-group/open-code-review`

The setup has eight steps. Steps 1–4 set up the machine once; steps 5–8 run for each project:

1. [Move the kit to a stable path](#move-the-kit-to-a-stable-path)
2. [Check the prerequisites](#check-the-prerequisites)
3. [Add the base providers to Paseo](#add-the-base-providers-to-paseo)
4. [Compose the six seats](#compose-the-six-seats)
5. [Add a project](#add-a-project)
6. [Pin a model for one project](#pin-a-model-for-one-project)
7. [Verify each seat's prompt and skills](#verify-each-seats-prompt-and-skills)
8. [Write your own rules](#write-your-own-rules)

Steps 4 and 5 are safe to repeat: step 4 writes only what differs from `seats.json`, and step 5
overwrites no project file without `--refresh`. Steps 3, 4, and 5 edit the config file that also
holds your workspaces, so each starts with a backup.

## Move the kit to a stable path

The seat directories link to the kit by absolute path, each seat finds it through
`SEATWORKS_KIT`, and the guards read `seats.json` there, so if you move the kit later, rerun
step 4, then step 5 for every project.

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

2. Check each harness a role uses against the version its manifest was verified on:

   ```fish
   jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json | while read -l h
       jq -r '"\(.id): verified \(.verified // "null"), check with `\(.versionCommand)`"' KIT_DIR/harness/$h/harness.json
   end
   ```

   Run each `versionCommand` it prints. A different version is not an error; step 7's `--probe`
   settles whether the facts hold. A `verified` of `null` means nobody has confirmed that
   harness anywhere: read `harness/<id>/NOTES.md` first.

3. If a harness in use sets `provider.env` with an `ENV_KEY` entry, export that key for the
   Paseo daemon before step 4. Read the name, never the value, from the manifest:

   ```fish
   jq -r '.provider.env // {} | to_entries[] | select(.key | endswith("_ENV_KEY")) | "export \(.value) yourself; the kit never stores it"' KIT_DIR/harness/*/harness.json
   ```

4. Check each harness's login and Paseo's tool injection. A harness declares the login file a
   seat links under `links`, with `required` saying how to create it:

   ```fish
   jq -r '(.links // [])[] | select(.required) | "\(.target): \(.required)"' KIT_DIR/harness/*/harness.json
   jq '.daemon.mcp' ~/.paseo/config.json
   ```

**Done:** fish reports 3.5 or later, `paseo ls` exits without an error, every `versionCommand`
prints a version, each login exists, and `.daemon.mcp` shows `"enabled": true` and
`"injectIntoAgents": true`.

If a tool or a login is missing, stop and ask the user to install it or to log in with the
`required` text its harness gives; don't do it yourself. If `injectIntoAgents` isn't `true`, ask
before changing it: it gives Paseo tools to every agent the daemon starts.

## Add the base providers to Paseo

Every seat extends the base provider of its harness and inherits its credentials.
`examples/paseo-providers.json` holds one base entry per harness; the six role providers are not
in it, because step 4 composes them.

1. List the base providers the roles need, and check which already exist:

   ```fish
   for h in (jq -r '[.seats[].harness] | unique | .[]' KIT_DIR/seats.json)
       set -l b (jq -r .baseProvider KIT_DIR/harness/$h/harness.json)
       jq -r --arg b $b '"\($b): \(if .agents.providers[$b] then "present" else "missing" end)"' ~/.paseo/config.json
   end
   ```

2. Back up the config:

   ```fish
   cp ~/.paseo/config.json ~/.paseo/config.json.pre-seatworks
   chmod 600 ~/.paseo/config.json.pre-seatworks
   ```

3. Merge any missing base entry from `examples/paseo-providers.json` into `.agents.providers`,
   dropping its `_doc` key. Paseo ships some providers disabled, and substep 1 calls one of those
   `present`, so check the entries that already exist too:

   ```fish
   jq -r '.agents.providers | to_entries[] | select(.value.extends | not) | "\(.key): enabled=\(.value.enabled // "unset")"' ~/.paseo/config.json
   ```

   A base provider the example file marks `"enabled": true` needs that key, whether you added the
   entry now or it was already there.
4. A harness whose manifest sets `provider.baseCredential` keeps a token on its base provider,
   which every seat inherits. List which, and whether each is set, without printing any value:

   ```fish
   jq -r '[.baseProvider, (.provider.baseCredential.env // "-"), (.provider.baseCredential.create // "-")] | @tsv' KIT_DIR/harness/*/harness.json | while read -l b v create
       test $v = -; and continue
       echo "$b needs $v (create: $create) set: "(jq -r --arg b $b --arg v $v '(.agents.providers[$b].env[$v] // "") != ""' ~/.paseo/config.json)
   end
   ```

   For each `false`, ask the user to set that variable themselves, in the Paseo app or under
   `.agents.providers.BASE.env`; the `create` command obtains the value. Don't read it from
   another file, and keep it out of any command line.
5. Compare `paseo provider models BASE` with the `models` a role names in `seats.json`, and
   correct them there: step 4 copies each seat's `isDefault` model and thinking option into its
   provider and profile.

**Done:** the command from substep 1 prints `present` for every harness, every base credential
from substep 4 prints `true`, and `jq -e . ~/.paseo/config.json` succeeds.

To roll back, restore `~/.paseo/config.json.pre-seatworks`.

## Compose the six seats

`setup/setup-seats.fish` with no project composes the six role providers and the six agent
profiles from `seats.json` and the manifests: each provider's launcher command, `SEATWORKS_*`
environment, models, and deny list, and each profile's model, mode, thinking option, and notes.
It writes only what differs, after a backup named `~/.paseo/config.json.bak.YYYYmmdd-HHMMSS`.

1. Compose the seats:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish
   ```

   On a machine with no project the run ends with `no projects yet`; step 5 builds the seat
   directories.
3. Restart the daemon, because a reload updates providers it already knows but builds nothing
   for a new one:

   ```fish
   paseo daemon restart
   ```

**Done:** the run printed no `!` line, and this prints nothing:

```fish
jq -r '.seats[].role' KIT_DIR/seats.json | while read -l r
    jq -e --arg r $r '(.agents.providers[$r] != null) and any(.daemon.agentProfiles[]?; .id == $r)' ~/.paseo/config.json >/dev/null; or echo "$r: missing"
end
```

To roll back, restore the backup the run named.

## Add a project

`setup/add-project.fish` adds what a repository needs and, without `--refresh`, overwrites no
existing file. It copies the kit's templates from `project/` into `REPO_DIR/.seatworks/`, filling
in the Peer's model in the spawn recipes; writes `.seatworks/project.json` with the slug the room
resolves a seat by; adds `AGENTS.md` at the repository root if missing, plus an `@AGENTS.md`
pointer for every other `contextFile` a harness declares with `contextFileNeedsPointer`; then
registers the repository as a Paseo project, builds this project's six seat directories under
each harness's profile root, and reloads Paseo.

It writes no provider and no profile: those are step 4's six, shared by every project. It adds
files only; leave the repository's code alone. If another repository already uses the slug, it
stops and asks for `--slug`.

1. Read what each seat's model will be. A role that names none in `seats.json` falls back to its
   harness's `provider.defaultModel`:

   ```fish
   jq -r '.seats[] | "\(.role): \((.models[0].id // "from its harness"))"' KIT_DIR/seats.json
   jq -r '"\(.id) default: \(.provider.defaultModel // "none; roles name their own")"' KIT_DIR/harness/*/harness.json
   ```

2. Run it, adding `--slug SLUG` if the directory name isn't the short name you want:

   ```fish
   fish KIT_DIR/setup/add-project.fish REPO_DIR
   ```

**Done:** the script exits 0, prints a `✓` line for each of the six seats and no base-provider
token warning (if it does, go back to step 3), and these show the slug, the project, the import
line, and a spawn recipe with a real model:

```fish
jq -r .slug REPO_DIR/.seatworks/project.json
paseo project ls | grep REPO_DIR
for f in (jq -r 'select(.contextFileNeedsPointer == true) | .contextFile' KIT_DIR/harness/*/harness.json); head -1 REPO_DIR/$f; end
grep -n 'peer/' REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
```

If the repository already had an `AGENTS.md`, add the sections of
`examples/AGENTS_MD_SNIPPET.md` by hand; if a pointer file already had rules in it, move those
into `AGENTS.md` and leave the pointer as the single line `@AGENTS.md`.

Until you give OCR a model of its own, the Reviewer reviews in delegation mode, on its own
model: run `ocr config provider` (it asks for an API key, which is yours to enter) and check it
with `ocr llm test`. A different model family gives reviews different blind spots, and sends the
code under review to that provider.

To roll back, run `paseo project delete PROJECT_ID` with the ID `paseo project ls` shows for
`REPO_DIR` (a path isn't accepted), then move the files the script listed as added and this
project's six seat directories (`<profileRoot>/<role>-SLUG`) to the Trash. The providers and
profiles stay: step 4 owns them.

## Pin a model for one project

Optional. A role's model comes from its global agent profile. To give one project another model
for a role, name it under `models` in that project's `project.json`: the room rewrites the model
as the seat launches, so nothing global changes.

1. Take the ID from `paseo provider models BASE` for the role's harness, spelled as that
   harness spells a model.
2. Name the role and the ID, either with `--model MODEL_ID` on step 5's command (which pins it
   for every role whose `seats.json` entry names no model) or by hand:

   ```fish
   jq '.models.lead = "MODEL_ID"' REPO_DIR/.seatworks/project.json >/tmp/p.json; and mv /tmp/p.json REPO_DIR/.seatworks/project.json
   ```

**Done:** `jq .models REPO_DIR/.seatworks/project.json` prints the role and an ID that
`paseo provider models BASE` lists. The next seat started in `REPO_DIR` runs it; a running seat
keeps the model it started on.

## Verify each seat's prompt and skills

The previous steps prove only that the filesystem is right. This step proves each seat loads its
own prompt, skills, and guards: a seat whose config directory isn't applied runs on the user's
own config and reports no error, and a harness that looks for skills elsewhere offers the seat
none.

1. Ask each seat's harness which skills it loads:

   ```fish
   fish KIT_DIR/setup/setup-seats.fish --check --probe
   ```

   A harness whose `probe.kind` is a loader answers on every `--check`; one whose kind is
   `version` is settled by asking the seat, which `--probe` does for one cheap model call. In
   the `live probe saw N skills` line, skills marked `disable-model-invocation: true` count as
   held back, because the model's list is meant not to show them.

2. Ask each seat what it loaded, one at a time, always with `--cwd REPO_DIR`: the room resolves
   a seat's project from its working directory. Copy the model, mode, and thinking option from
   the role's agent profile; a harness whose `hasModes` is `false` rejects `--mode`, and a model
   with no thinking options has no `--thinking`:

   ```fish
   paseo run --provider ROLE/MODEL_ID --mode MODE_ID --thinking THINKING_ID --cwd REPO_DIR 'Without running any tool, quote the "# " heading of your instructions, and say whether they mention Paseo.'
   paseo archive AGENT_ID
   ```

   Ask for the heading, not the first line: asked for a line, a model often quotes its
   harness's own system prompt.
3. Check the limits, each in its own agent in `REPO_DIR`, archived afterwards. Ask `peer` to
   run `git -C /tmp push --dry-run` and report what happened; ask `peer-ro` and `reviewer` to
   create `probe.txt` in `REPO_DIR` with their write tool; ask `lead` to run
   `git merge some-branch` without loading a skill first.

**Done:** `--check --probe` exits 0, and each seat quotes the heading this table gives:

| Provider | Heading |
|---|---|
| `supervisor` | `# Supervisor — orchestration observer acting for the Human` |
| `lead` | `# Lead — Project Lead & binding technical arbiter` |
| `watcher` | `# Watcher — attention sweeps for the Supervisor` |
| `peer`, `peer-ro` | `# Peer — independent co-worker`, with no mention of Paseo |
| `reviewer` | `# Reviewer — independent code review`, with no mention of Paseo |

Every limit refuses too: `peer`'s push with "Pushing is not available in this workspace.",
`peer-ro`'s and `reviewer`'s write with "Editing files is not available in this role.", and
`lead`'s merge with "Skill guard: You can't merge without loading the `integration` skill
first".

If a seat quotes the user's own instruction file, the room didn't resolve the project: check the
agent's `--cwd`, the slug in `REPO_DIR/.seatworks/project.json`, and that
`<profileRoot>/<role>-SLUG` exists, then rerun step 5. If a limit doesn't refuse, its guard
didn't load: check the guard link under `<profileRoot>/<role>-SLUG/<guards.installTo>/`, from
that harness's manifest, and for the merge that the `lead` provider has `env.SEATWORKS_KIT` and
its role settings file runs `skill-guard.sh` in a hook. Then repeat this step for that seat.

Finally, leave one Supervisor running for the user: start an agent on `supervisor` in `REPO_DIR`
and keep it; it keeps a watcher running while a Lead works.

## Write your own rules

The prompts are demo files: the structure is real, the rules generic, and the value comes from
your own. Before editing, read [WRITING_GUIDE.md](WRITING_GUIDE.md).

1. Fill in the project's placeholders (the `UPPER_SNAKE_CASE` words in `AGENTS.md` and
   `.seatworks/WORKSPACE_PROTOCOL.md`) with the Human's decisions: ask the project's Supervisor
   to run its `workspace-protocol` skill, which interviews the Human. Committing is the Human's
   call. List what is open with:

   ```fish
   grep -noE '\b[A-Z]{2,}(_[A-Z]+)+\b' REPO_DIR/AGENTS.md REPO_DIR/.seatworks/WORKSPACE_PROTOCOL.md
   ```

2. Rewrite the seat prompts in this order, because each one constrains the next. Put rules every
   project should start with in the `KIT_DIR/project/` templates; `--refresh` replaces a
   project's copies, so a rule meant for one project goes in its `AGENTS.md` or
   `.seatworks/WORKSPACE_PROTOCOL.md`:
   1. `PEER.md` and `REVIEWER.md`: boundaries, handoff shape, evidence standard. No HTML
      comments in any prompt or skill: a maintainer note goes in `WRITING_GUIDE.md`, which lists
      what each demo prompt expects you to add.
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

**Done:** the check exits 0 and the placeholder search prints nothing.
