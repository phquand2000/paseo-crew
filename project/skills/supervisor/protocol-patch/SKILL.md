---
name: protocol-patch
description: "Turns a recurring notebook pattern into the smallest prompt, protocol, skill, or guard change on one of two routes: a short one for wording, the full audited and rehearsed one for a rule that changes behavior. Use when a notebook entry recurred on two different days or the Human asks for a rule change."
---

# Protocol patch

Use this skill to change a rule the agents follow, with evidence that the change alters their
behavior. It adds the choosing, writing, and testing steps to the patch rule in
`.seatworks/SUPERVISOR.md`; where the two differ, the prompt wins.

The skill produces a diff under `.seatworks/records/drafts/` that, once approved, becomes a
commit here or a change the Human applies to the kit; the notebook entry's `Status` line set to
`applied SHA`; and, on the behavior route, a list of agents to archive. `references/` paths are
relative to this skill's directory; the rest to the repository root.

## Choose the route

| Route | The change | Steps |
|---|---|---|
| wording | a rewording, a format fix, a pointer, or a line moved to the file that owns it | 2, 3, 4, 5, 7, 8 |
| behavior | a new or changed rule, a hard limit, a guard, a skill gate, or a watcher trigger | all nine |

Take the behavior route whenever an agent should act differently afterwards, or whenever you
can't say in one sentence what stays the same. Its precondition is the patch rule's: the entry's
`Seen` line shows two different days, or the Human asked; if neither holds, record the episode and
stop. The wording route needs no precondition, since it adds no rule, and finding yourself adding
one means you are on the other route.

## Procedure

1. **Name the behavior.** Write one sentence: in situation S, agent R does X, and the desired
   behavior is Y. **Done** when S, R, X, and Y are each concrete enough to build a test scenario
   from.
2. **Choose the narrowest owning surface**, so the change reaches only the agents that need it.
   You write only in `.seatworks/`, and `add-project.fish --refresh` overwrites the project's
   copies of prompts and skills from the kit, so a rule for this project alone never goes in
   those copies:

   | Surface | Owns | Read by | The change goes |
   |---|---|---|---|
   | `.seatworks/WORKSPACE_PROTOCOL.md` | coordination rules for this repository only | its Lead, every session | into the file; the Lead commits it |
   | `AGENTS.md` | technical constraints for anyone changing code here | every agent in the repository | to the Human as a diff; the Lead commits it |
   | a seat prompt: `SUPERVISOR.md`, `LEAD.md`, `PEER.md`, `REVIEWER.md`, `WATCHER.md` | how that role behaves in every project | that seat, every turn | to the Human as a kit diff |
   | a skill | a procedure used only some of the time | the seat that loads it | to the Human as a kit diff |
   | the deny intents and skill gates in `$SEATWORKS_KIT/seats.json`, their mapping in each `harness.json`, and the guards under `$SEATWORKS_KIT/harness/` | limits that must hold whatever the prompt says | enforced, not read | to the Human as a kit diff |

   Fix a one-repository problem in its `WORKSPACE_PROTOCOL.md` or `AGENTS.md`; make something
   that must never happen a hard limit, adding a one-line reason to a prompt only if agents would
   otherwise keep retrying; make an occasional procedure a skill, so the prompts loaded on every
   turn stay short. **Done** when you have chosen one surface and can say why each narrower one
   doesn't fit.
3. **Check what already covers it.** Search the chosen surface and its neighbors, for example
   `grep -rn -i 'KEYWORD' AGENTS.md .seatworks/ $SEATWORKS_KIT/harness/ $SEATWORKS_KIT/project/`.
   If a line already covers it, sharpen that line or the pointer to it instead of adding
   another. If the line exists and is ignored, find out why: it's buried, contradicted
   elsewhere, or worded too weakly. **Done** when you can quote the lines that cover it, or
   state "none" with the search you ran.
4. **Write the change.** Copy the file into `.seatworks/records/drafts/` (from
   `$SEATWORKS_KIT` for a kit surface), change the copy, and save
   `diff -u ORIGINAL COPY > .seatworks/records/drafts/PATCH_NAME.diff`. Follow
   [references/writing-rules.md](references/writing-rules.md), and also:
   - Name the file or section that owns a meaning instead of copying it, so one later edit
     changes the behavior everywhere.
   - Put the reason in the rule's text and the removal trigger in the notebook entry that
     proposed the patch; a rule the Human should be able to retire on sight gets a `Remove when:`
     line in `WORKSPACE_PROTOCOL.md` or `AGENTS.md`, prose the seats read anyway.
   - For a seat prompt, keep `wc -c` under 16384 bytes; if the change goes over, cut something
     else.

   **Done** when the diff exists and the file it changes is untouched. Don't commit yet.
5. **Audit the diff.** Answer each question with one line naming the diff line it concerns, and
   revise for every "yes":
   - Duplication: does the meaning now live in two places?
   - Context flooding: does it add always-loaded lines that only some tasks need?
   - Role passivity: does it make a role wait, ask, or escalate where it should decide?
   - Agents as function calls: does it script the steps so tightly that judgment is gone?
   - The opposite extreme: what does over-applying the rule cause, and does the text bound it?
     "Challenge the premise" can turn into objecting for show.

   **Done** when every question has its line, and no "yes" is left.
6. **Pressure-test the change on fresh seats.** Follow [references/rehearsal.md](references/rehearsal.md):
   build one scenario from the episode the old text failed on, run it on a fresh seat with the
   old text, then on another with the new text, and compare. **Done** when the old seat
   reproduces X, the new seat does Y, you have quotes from both, and the project's files are
   back to the old text. If the old seat doesn't reproduce X, the cause isn't in the text or the
   scenario is wrong: go back to step 1. If the new seat still does X or overshoots, revise the
   diff and rerun.
7. **Get the Human's approval.** Show the diff, the notebook entry, the audit lines, and any
   rehearsal quotes. **Done** when the Human approves.
8. **Ship the change** by its surface:
   - `WORKSPACE_PROTOCOL.md`: apply the diff and send the Lead an `OWNER DIRECTIVE:` to commit
     that file alone.
   - `AGENTS.md`: send the Lead an `OWNER DIRECTIVE:` with the diff to apply and commit.
   - A seat prompt or skill: ask the Human to apply the diff in `$SEATWORKS_KIT` and run
     `fish $SEATWORKS_KIT/setup/add-project.fish REPO_ROOT --refresh`, then have the Lead commit
     the refreshed `.seatworks/` files.
   - A deny list or guard: ask the Human to apply the diff in `$SEATWORKS_KIT`, then run
     `fish $SEATWORKS_KIT/setup/setup-seats.fish` and `paseo reload`, because that step writes
     the seat profiles and `~/.paseo/config.json`, outside the kit.

   Each commit message names the notebook entry. Then run
   `fish $SEATWORKS_KIT/setup/setup-seats.fish --check` and take what it reports to the Human.
   **Done** when `git log -1` shows the commit (the kit's, for a guard), and the entry's
   `Status` line carries its SHA.
9. **Retire the old versions.** Running agents keep the text they started with. Run
   `list_agents` and give the Human every agent that started before the change and reads the
   changed surface, with the heartbeats their Leads set. Archive them once the Human agrees, and
   only after a safe handback: archiving an agent archives its Peers, and if that takes the
   watcher while a Lead is active, start a new one per the `attention-watch` skill. **Done** when the Human has the list and the agreed agents are
   archived.

The rule that matters most: match the route to what changes, and prove a behavior change on the
episode that failed before you ship it.
