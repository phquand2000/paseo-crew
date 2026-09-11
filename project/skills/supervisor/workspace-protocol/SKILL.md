---
name: workspace-protocol
description: "Fills in a project's rules after setup: interviews the Human about the placeholders in .seatworks/WORKSPACE_PROTOCOL.md and AGENTS.md, chooses strictness from evidence about users, data, and reversibility, and gives every mandatory rule a reason and a removal trigger. Use when a project was just added, or when a Lead runs a repository on rules that don't fit it."
---

# Workspace protocol

Use this skill to turn this project's template rules into real ones. The setup already copied
the templates: `.seatworks/WORKSPACE_PROTOCOL.md` (read only by the Lead) and `AGENTS.md` (read
by every agent). You fill in the protocol yourself, because `.seatworks/` is yours to write.
`AGENTS.md` holds the repository's rules for everyone, so you draft it and the Lead commits it.

Paths are relative to the repository root, your working directory.

## Procedure

1. **Check that the project is set up.** Confirm that `.seatworks/WORKSPACE_PROTOCOL.md` exists
   and that `list_models` answers for `pi-peer-SLUG`. If either is missing, ask the Human to run
   `fish $SEATWORKS_KIT/setup/add-project.fish` for this repository, and stop. **Done** when
   both hold.
2. **Read the repository before asking.** List the placeholders still open:

   ```sh
   grep -noE '\b[A-Z]{2,}(_[A-Z]+)+\b' AGENTS.md .seatworks/WORKSPACE_PROTOCOL.md
   ```

   Take the build and test commands from the package manifest, the Makefile, or the CI config.
   Note the deploy, publish, and migration paths, and look in `git log --oneline -200` for
   reverts and hotfixes. Read `.seatworks/NOTEBOOK.md`. **Done** when you have a fact sheet that
   marks each placeholder as known or unknown, in `.seatworks/records/drafts/NOTES.md`.
3. **Collect evidence for the strictness level.** Answer three questions from the fact sheet,
   and ask the Human only for what you couldn't find:
   - Users: who is hurt when a bug ships? Only the Human, a team, or external users?
   - Data: does the code touch production data, personal data, money, or credentials?
   - Reversibility: does reverting a commit undo every change, or are there migrations,
     published packages, public APIs, or deploys that others depend on?

   Recommend `loose` when only the Human is affected and git undoes every change, `strict` when
   there are external users or irreversible data paths, and `standard` otherwise. Strictness
   costs Lead time on every task, so match it to the damage a mistake can do. **Done** when the
   recommendation and its evidence are in `NOTES.md`.
4. **Interview the Human about the unknowns.** Ask in rounds: every question you can ask now,
   each numbered and with a recommended answer, as in the intent-interview skill. For the Peer
   model, run `list_models` for `pi-peer-SLUG` and recommend one; the protocol has to name it,
   because the provider offers every model the Pi login reaches. When the Human proposes a rule,
   ask for the episode it would have prevented. A rule without an episode is ceremony, and
   ceremony only ever tightens. **Done** when every placeholder you keep has an answer.
5. **Fill in `.seatworks/WORKSPACE_PROTOCOL.md` in place.** Replace the placeholders, and delete
   every section that repeats the Lead's defaults in `.seatworks/LEAD.md`, because the Lead
   reads the file every session. Give each mandatory rule a `Reason:` line (a dated,
   reproducible episode) and a `Remove when:` line (the evidence that would retire it).
   **Done** when the placeholder search from step 2 prints nothing for this file, and
   `grep -n 'pi-peer-SLUG/' .seatworks/WORKSPACE_PROTOCOL.md` shows a real model.
6. **Draft `AGENTS.md`.** Copy `AGENTS.md` to `.seatworks/records/drafts/AGENTS.md` and fill it
   in by the same rules. For each line, ask whether a Peer would make a mistake without it: if
   it would, the line belongs in `AGENTS.md`; if only the Lead needs it, it belongs in the
   protocol. Peers don't read the protocol, and coordination detail in `AGENTS.md` distracts
   them on every turn. **Done** when the draft has no placeholder left and no technical
   constraint lives only in the protocol.
7. **Get the Human's approval.** Show the protocol (`git diff -- .seatworks`, or the whole file
   if it isn't committed yet), the `AGENTS.md` draft, the strictness evidence, and the rules you
   dropped for lack of an episode. **Done** when the Human approves, or has asked for changes
   that you applied and the Human approved.
8. **Hand the files to the Lead.** Re-read the agent IDs with `list_agents`, then send this
   with `send_agent_prompt`. If the project has no Lead, create one on `claude-lead-SLUG` with
   `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`, and make this directive its
   first prompt. **Done** when the Lead confirms that it committed the files.

   ```text
   OWNER DIRECTIVE: Adopt the rules for this repository.

   Outcome: AGENTS.md at the repository root matches .seatworks/records/drafts/AGENTS.md, and
   .seatworks/ is committed as it stands in the working tree.
   Constraints: commit them as they are. If a rule conflicts with the repository's current
   state, say which rule and why before you commit, rather than editing it.
   Reserved for the Human: any change to these rules.
   After committing: read .seatworks/WORKSPACE_PROTOCOL.md again now, because you read it at
   session start.
   ```

9. **Verify the commit and remove the draft.** Run:

   ```sh
   git log -1 --format=%H -- AGENTS.md .seatworks/WORKSPACE_PROTOCOL.md
   git show HEAD:AGENTS.md | diff - .seatworks/records/drafts/AGENTS.md
   ```

   **Done** when the commit exists, the `diff` prints nothing (or the Lead explained each
   difference and the Human accepted it), and you have deleted `.seatworks/records/drafts/`.

If the Lead raises a conflict in step 8, take it to the Human, update the files, and repeat from
step 7.

The rule that matters most: keep only what differs from the defaults, and give every mandatory
rule the episode behind it and the evidence that would remove it.
