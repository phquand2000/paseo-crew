---
name: protocol-patch
description: "Turns a recurring notebook pattern into the smallest prompt, protocol, skill, or guard change, audited and rehearsed on fresh seats before Human approval. Use when a notebook entry recurred on two different days or the Human asks for a rule change."
---

# Protocol patch

Use this skill to change a rule the agents follow, with evidence that the change alters their
behavior. It adds the choosing, writing, and testing steps to the patch rule in
`.seatworks/SUPERVISOR.md`; where the two differ, the prompt wins.

The skill produces a diff under `.seatworks/records/drafts/` that, once the Human approves it,
becomes a commit in this repository or a change the Human applies to the kit; the notebook
entry's `Status` line set to `applied SHA`; and a list of agents to archive. Paths starting with
`references/` are relative to this skill's directory; every other path is relative to the
repository root.

Before you start, check the precondition: the entry's `Seen` line shows two different days, or
the Human asked for the change. If neither holds, record the episode and stop.

## Procedure

1. **Name the behavior.** Write one sentence: in situation S, agent R does X, and the desired
   behavior is Y. **Done** when S, R, X, and Y are each concrete enough to build a test scenario
   from.
2. **Choose the narrowest owning surface**, so the change reaches only the agents that need it.
   You write only in `.seatworks/`, and `add-project.fish --refresh` replaces the project's
   copies of seat prompts and skills with the kit's, so a rule for this project alone never goes
   into those copies:

   | Surface | Owns | Read by | The change goes |
   |---|---|---|---|
   | `.seatworks/WORKSPACE_PROTOCOL.md` | coordination rules for this repository only | its Lead, every session | into the file; the Lead commits it |
   | `AGENTS.md` | technical constraints for anyone changing code here | every agent in the repository | to the Human as a diff; the Lead commits it |
   | a seat prompt: `SUPERVISOR.md`, `LEAD.md`, `PEER.md`, `REVIEWER.md`, `WATCHER.md` | how that role behaves in every project | that seat, every turn | to the Human as a kit diff |
   | a skill | a procedure used only some of the time | the seat that loads it | to the Human as a kit diff |
   | the deny lists in `$SEATWORKS_KIT/setup/setup-seats.fish`, the guards in `$SEATWORKS_KIT/claude/` and `$SEATWORKS_KIT/pi/extensions/` | limits that must hold whatever the prompt says | enforced, not read | to the Human as a kit diff |

   If it happens in one repository, fix it in its `WORKSPACE_PROTOCOL.md` or `AGENTS.md`. If it
   must never happen, make it a hard limit, and add a one-line reason to a prompt only if agents
   would otherwise keep retrying. If it's a procedure used now and then, make it a skill, so the
   prompts loaded on every turn stay short. **Done** when you have chosen one surface and can say
   why each narrower one doesn't fit.
3. **Check what already covers it.** Search the chosen surface and its neighbors for the concept,
   for example `grep -rn -i 'KEYWORD' AGENTS.md .seatworks/ $SEATWORKS_KIT/pi/ $SEATWORKS_KIT/project/`.
   If a line already covers it, sharpen that line or the pointer to it instead of adding
   another. If the line exists and is ignored, find out why: it's buried, contradicted
   elsewhere, or worded too weakly. **Done** when you can quote the lines that cover it, or
   state "none" together with the search you ran.
4. **Write the change.** Copy the file into `.seatworks/records/drafts/` (from
   `$SEATWORKS_KIT` for a kit surface), change the copy, and save
   `diff -u ORIGINAL COPY > .seatworks/records/drafts/PATCH_NAME.diff`. Follow
   `$SEATWORKS_KIT/WRITING_GUIDE.md`, and also:
   - Point instead of copying: name the file or section that owns a meaning, so a single later
     edit changes the behavior everywhere.
   - Make completion checkable: name the command, the field, or the threshold.
   - Describe the target behavior. A prohibition names the forbidden act and makes it more
     likely; when a hard limit has to be phrased as a prohibition, pair it with the action to
     take instead.
   - Put the reason in the rule's text. Put the removal trigger in an HTML comment beside the
     rule in the Claude seat prompts (`SUPERVISOR.md`, `LEAD.md`, `WATCHER.md`), on a
     `Remove when:` line in `WORKSPACE_PROTOCOL.md` and `AGENTS.md`, and in the notebook entry
     for `PEER.md`, `REVIEWER.md`, and skills, which carry no comments.
   - For a seat prompt, keep `wc -c` under 16384 bytes; if the change goes over, cut something
     else.

   **Done** when the diff file exists and the file it changes is untouched. Don't commit yet.
5. **Audit the diff.** Answer each question with one line that names the diff line it concerns,
   and revise the diff for every "yes":
   - Duplication: does the meaning now live in two places?
   - Context flooding: does it add always-loaded lines that only some tasks need?
   - Role passivity: does it make a role wait, ask, or escalate where it should decide?
   - Agents as function calls: does it script the steps so tightly that the agent's judgment is
     gone?
   - The opposite extreme: what failure does over-applying the rule cause, and does the text
     bound it? For example, "challenge the premise" can turn into objecting for show.

   **Done** when every question has its line, and no "yes" is left.
6. **Pressure-test the change on fresh seats.** Follow [references/rehearsal.md](references/rehearsal.md):
   build one scenario from the episode the old text failed on, run it on a fresh seat with the
   old text, then on another with the new text, and compare. **Done** when the old seat
   reproduces X, the new seat does Y, you have quotes from both, and the project's files are
   back to the old text. If the old seat doesn't reproduce X, the scenario is wrong or the cause
   isn't in the prompt; go back to step 1. If the new seat still does X, or overshoots into the
   opposite extreme, revise the diff and rerun.
7. **Get the Human's approval.** Show the diff, the notebook entry, the audit lines, and the two
   rehearsal quotes. **Done** when the Human approves.
8. **Ship the change** by its surface:
   - `WORKSPACE_PROTOCOL.md`: apply the diff, and send the Lead an `OWNER DIRECTIVE:` to commit
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
   `list_agents`, and give the Human every agent that started before the change and reads the
   changed surface, with the schedules and heartbeats their Leads set. Archive them once the
   Human agrees, and only after a safe handback, because archiving an agent also archives its
   Peers; if that includes the watcher while a Lead is active, start a new one per the
   `attention-watch` skill. **Done** when the Human has the list and the agreed agents are
   archived.

The next retrospective on this pattern checks whether the behavior actually changed.

The rule that matters most: prove the change on the episode that failed before you ship it, and
put it in the narrowest surface that owns the behavior.
