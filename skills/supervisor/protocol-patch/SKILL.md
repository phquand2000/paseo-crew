---
name: protocol-patch
description: "Turns a recurring notebook pattern into the smallest prompt, protocol, skill, or guard change: chooses the narrowest owning surface, checks existing coverage, writes by WRITING_GUIDE.md, audits the diff, pressure-tests it on fresh seats against the old text, and ships it once the Human approves. Use when a notebook entry recurred on two different days, or the Human asks for a rule change."
---

# Protocol patch

Use this skill to change a rule the agents follow, with evidence that the change alters their
behavior. It adds the choosing, writing, and testing steps to "Notebook and prompt patches" in
`claude/SUPERVISOR.md`; where the two differ, the prompt wins.

The skill produces a kit commit (or, for a repository surface, an owner directive carrying the
text), the notebook entry's `Status` line set to `applied SHA`, and a list of agents to archive.
Paths starting with `references/` are relative to this skill's directory; every other path is
relative to the kit.

Before you start, check the precondition: the entry's `Seen` line shows two different days, or
the Human asked for the change. If neither holds, record the episode and stop.

## Procedure

1. **Name the behavior.** Write one sentence: in situation S, agent R does X, and the desired
   behavior is Y. **Done** when S, R, X, and Y are each concrete enough to build a test scenario
   from.
2. **Choose the narrowest owning surface.** A narrow surface limits the change to the agents
   that need it:

   | Surface | Owns | Read by |
   |---|---|---|
   | The repository's `AGENTS.md` | technical constraints for anyone changing code there | every agent in that repository |
   | The repository's `WORKSPACE_PROTOCOL.md` | coordination in that repository | that repository's Lead |
   | `claude/LEAD.md` | how every Lead coordinates | every Lead, every turn |
   | `pi/PEER.md` | how every Peer works | every Peer, every turn |
   | `claude/SUPERVISOR.md` | your own behavior | you |
   | a skill | a procedure used only some of the time | the seat that loads it |
   | the deny lists in `setup/setup-seats.fish`, and `pi/extensions/peer-guard.ts` | limits that must hold whatever the prompt says | enforced, not read |

   If it happens in one repository, fix it in that repository. If it must never happen, make it
   a hard limit, and add a one-line reason to a prompt only if agents would otherwise keep
   retrying. If it's a procedure used now and then, make it a skill, so that the prompts loaded
   on every turn stay short. **Done** when you have chosen one surface and can say why each
   narrower one doesn't fit.
3. **Check what already covers it.** Search the chosen surface and its neighbors for the concept,
   for example `grep -rn -i 'KEYWORD' claude/ pi/ skills/ examples/`. If a line already covers
   it, sharpen that line or the pointer to it instead of adding another. If the line exists and
   is ignored, find out why: it's buried, contradicted elsewhere, or worded too weakly. **Done**
   when you can quote the lines that cover it, or state "none" together with the search you ran.
4. **Write the change.** Follow `WRITING_GUIDE.md`, and also:
   - Point instead of copying: name the file or section that owns a meaning, so that later a
     single edit changes the behavior everywhere.
   - Make completion checkable: name the command, the field, or the threshold.
   - Describe the target behavior. A prohibition names the forbidden act and makes it more likely;
     when a hard limit has to be phrased as a prohibition, pair it with the action to take instead.
   - Put the reason in the rule's text. Put the removal trigger in an HTML comment beside the rule
     in `claude/*.md`, and in the notebook entry for `pi/PEER.md` and skills, which carry no
     comments.
   - For a seat prompt, keep `wc -c` under 16384 bytes; if the change goes over, cut something else.

   **Done** when the diff exists in the kit's working tree, or as text for a repository surface.
   Don't commit yet.
5. **Audit the diff.** Answer each question with one line that names the diff line it concerns,
   and revise the diff for every "yes":
   - Duplication: does the meaning now live in two places?
   - Context flooding: does it add lines that are always loaded but needed only by some tasks?
   - Role passivity: does it make a role wait, ask, or escalate where it should decide?
   - Agents as function calls: does it script the steps so tightly that the agent's judgment is
     gone?
   - The opposite extreme: what failure does over-applying the rule cause, and does the text
     bound it? For example, "challenge the premise" can turn into objecting for show.

   **Done** when every question has its line, and no "yes" is left.
6. **Pressure-test the change on fresh seats.** Follow [references/rehearsal.md](references/rehearsal.md):
   build one scenario from the episode the old text failed on, run it on a fresh seat with the old
   text, then on another with the new text, and compare. Seats read the prompts through symlinks
   into the kit's working tree, so the order matters: run the old text before you apply the diff,
   or with the diff stashed. **Done** when the old seat reproduces X, the new seat does Y, and you
   have quotes from both. If the old seat doesn't reproduce X, the scenario is wrong, or the cause
   isn't in the prompt; go back to step 1. If the new seat still does X, or overshoots into the
   opposite extreme, revise the diff and rerun.
7. **Get the Human's approval.** Show the diff, the notebook entry, the audit lines, and the two
   rehearsal quotes. **Done** when the Human approves.
8. **Ship the change.** Run `fish setup/setup-seats.fish --check` and fix whatever it reports.
   Commit only the changed files in the kit, with a message naming the notebook entry, and set
   the entry's `Status` line to `applied SHA`.
   - For a repository surface, send the Lead an `OWNER DIRECTIVE:` with the exact text to commit,
     and set the `Status` line to the repository's SHA once the commit lands.
   - For a deny list or guard change, ask the Human to run `fish setup/setup-seats.fish` and then
     `paseo reload`, because that step writes the seat profiles and `~/.paseo/config.json`,
     outside the kit.

   **Done** when `git log -1` shows the commit, and the `Status` line carries the SHA.
9. **Retire the old versions.** Running agents keep the text they started with. Run `list_agents`,
   and give the Human every agent that started before the commit and reads the changed surface,
   with the schedules and heartbeats their Leads set. Archive them once the Human agrees, and only
   after a safe handback, since archiving an agent also archives its Peers. **Done** when the
   Human has the list and the agreed agents are archived.

The next retrospective on this pattern checks whether the behavior actually changed.

The rule that matters most: prove the change on the episode that failed before you ship it, and
put it in the narrowest surface that owns the behavior.
