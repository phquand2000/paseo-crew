---
name: workspace-protocol
description: "Fills in WORKSPACE_PROTOCOL.md and AGENTS.md after setup: interviews the Human on open placeholders, sets strictness from evidence, and gives each mandatory rule a reason and removal trigger. Use when a project was just added or its rules don't fit."
---

# Workspace protocol

Use this skill to turn the project's template rules into real ones. Setup copied
`.seatworks/WORKSPACE_PROTOCOL.md` (read only by the Lead), which you fill in yourself because
`.seatworks/` is yours to write, and `AGENTS.md` (read by every agent), which holds the
repository's rules for everyone, so you draft it and the Lead commits it. Paths are relative to
the repository root, your working directory.

## Procedure

1. **Check that the project is set up:** `.seatworks/WORKSPACE_PROTOCOL.md` exists and
   `list_profiles` shows the project's Lead and Peer profiles (`<slug>-lead`, `<slug>-peer`). If
   either fails, ask the Human to run `fish $SEATWORKS_KIT/setup/add-project.fish` for this
   repository, and stop. **Done** when both hold.
2. **Read the repository before asking.** List the open placeholders:

   ```sh
   grep -noE '\b[A-Z]{2,}(_[A-Z]+)+\b' AGENTS.md .seatworks/WORKSPACE_PROTOCOL.md
   ```

   Take build and test commands from the package manifest, Makefile, or CI config; note the
   deploy, publish, and migration paths; look for reverts and hotfixes in
   `git log --oneline -200`; read `.seatworks/NOTEBOOK.md`. **Done** when a fact sheet in
   `.seatworks/records/drafts/NOTES.md` marks each placeholder known or unknown.
3. **Collect evidence for the strictness level.** Answer from the fact sheet, and ask the Human
   only for what you couldn't find:
   - Users: who is hurt when a bug ships: only the Human, a team, or external users?
   - Data: does the code touch production data, personal data, money, or credentials?
   - Reversibility: does reverting a commit undo every change, or are there migrations,
     published packages, public APIs, or deploys others depend on?

   Recommend `loose` when only the Human is affected and git undoes every change, `strict` for
   external users or irreversible data paths, and `standard` otherwise; strictness costs Lead
   time on every task, so match it to the damage a mistake can do. **Done** when the
   recommendation and its evidence are in `NOTES.md`.
4. **Interview the Human about the unknowns.** Ask in rounds: every question you can ask now,
   numbered, each with a recommended answer, as in the intent-interview skill. The protocol's
   `PEER_MODEL` is the model of the `<slug>-peer` profile in `list_profiles`, because the profile
   guard blocks a launch on any other; another model is a profile change, so write it out for the
   Human. When the Human proposes a rule, ask for the episode it would have prevented; a rule
   without one is ceremony, and ceremony only ever tightens. **Done** when every placeholder you
   keep has an answer.
5. **Fill in `.seatworks/WORKSPACE_PROTOCOL.md` in place.** Replace the placeholders, and delete
   every section that repeats the Lead's defaults in `.seatworks/LEAD.md`, since the Lead reads
   the file every session. Give each mandatory rule a `Reason:` line (a dated, reproducible
   episode) and a `Remove when:` line (the evidence that would retire it). **Done** when the
   step 2 search prints nothing for this file and
   `grep -n 'pi-peer-SLUG/' .seatworks/WORKSPACE_PROTOCOL.md` shows the Peer profile's model.
6. **Draft `AGENTS.md`.** Copy `AGENTS.md` to `.seatworks/records/drafts/AGENTS.md` and fill it
   in by the same rules. For each line, ask whether a Peer would make a mistake without it: if
   it would, the line belongs in `AGENTS.md`; if only the Lead needs it, in the protocol. Peers
   don't read the protocol, and coordination detail in `AGENTS.md` distracts them every turn.
   **Done** when the draft has no placeholder left and no technical constraint lives only in the
   protocol.
7. **Get the Human's approval.** Show the protocol (`git diff -- .seatworks`, or the whole file
   if it isn't committed yet), the `AGENTS.md` change as a diff
   (`diff -u AGENTS.md .seatworks/records/drafts/AGENTS.md`), the strictness evidence, and the
   rules you dropped for lack of an episode. **Done** when the Human approves, or has asked for
   changes that you applied and the Human approved.
8. **Hand the files to the Lead.** Send this directive as in step 3 of "Sending the directive"
   in the intent-interview skill, which creates a Lead if the project has none. **Done** when
   the Lead confirms that it committed the files.

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
   difference and the Human accepted it), and you have deleted
   `.seatworks/records/drafts/AGENTS.md` and `.seatworks/records/drafts/NOTES.md`, leaving the
   `refresh-*` backups there alone.

If the Lead raises a conflict in step 8, take it to the Human, update the files, and repeat from
step 7.

The rule that matters most: keep only what differs from the defaults, and give every mandatory
rule the episode behind it and the evidence that would remove it.
