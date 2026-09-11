---
name: portfolio-review
description: "Reports what needs the Human across all workspaces (outcome, Lead health, pending acceptances, blocks, one-way doors, stale projects), filtered by concern lens. Use when the Human asks where things stand, sets priorities, or returns after a gap."
---

# Portfolio review

Use this skill to tell the Human what needs them across every project, and leave out everything
that doesn't. The Human owns priority; the review gives facts and questions, not the order.

The report goes in the conversation and isn't saved: it's a snapshot, and the durable facts live
in git and the notebook. `references/` paths are relative to this skill's directory; the rest to
the repository root.

## Procedure

1. **Set the scope.** If your first prompt names a concern (architecture, product intent,
   safety, delivery, or cross-workspace integration), read
   [references/concern-lenses.md](references/concern-lenses.md) and keep only the items your lens
   watches. The stale threshold N is 7 days unless the Human gave another number. The project
   list is every workspace `list_agents` returns, plus any project the Human names. **Done**
   when the lens, N, and the project list are fixed.
2. **Read the Paseo state.** Group `list_agents` by workspace; for each project find its Lead
   (provider `claude-lead-SLUG`), its Peers, their states, and their last activity. **Done**
   when each project has a Lead row, or "no Lead".
3. **Sample the activity sparingly.** For each Lead, call `get_agent_activity` limited to entries
   since your last review; read a Peer's activity only when the Lead's points at a problem
   there, since every sample costs context. Look for:
   - pending acceptance: a Peer handoff with no acceptance summary yet;
   - blocked items: a `BLOCKED`, `DEPENDENCY_REQUEST`, or `REOPEN_REQUEST` without a ruling;
   - decisions waiting on the Human, especially irreversible ones;
   - an unhealthy Lead: the Lead triggers in `.seatworks/WATCHER.md`, and the recent attention
     log.

   **Done** when each Lead has findings or the word "healthy".
4. **Read each repository.** Run `git -C REPO log -1 --format=%ad --date=short` and
   `git -C REPO log --since=LAST_REVIEW --oneline`; read the active ExecPlans if the repository
   keeps them (for example under `docs/exec-plans/active/`), and the project's directive under
   `.seatworks/records/directives/`. **Done** when each project has an outcome, a last commit
   date, and a last activity date.
5. **Classify each project** into the first class that fits:
   - Needs the Human: an irreversible decision waiting, or a reserved decision whose trigger
     point has come.
   - Blocked: an open blocking request with no ruling for more than a day.
   - Unhealthy Lead: signals from step 3.
   - Stale: no commit and no agent activity for N days while the outcome isn't met.
   - Healthy: none of the above.

   **Done** when every project has exactly one class.
6. **Check your own records.** Flag strategies in `.seatworks/records/strategy/*.md` past their
   review date, `.seatworks/records/safety/seat-matrix.md` older than the last provider or guard
   change, integration maps in `.seatworks/records/integration/*.md` with a phase open longer
   than its appetite, and notebook entries whose `Seen` shows two different days while the
   `Status` is still `open`. **Done** when each item is flagged or clear.
7. **Suggest a recovery for each stale project**; don't carry it out. Usually a fresh Lead on
   `claude-lead-SLUG` with the original outcome as an `OWNER DIRECTIVE:`, plus the old Lead's
   HANDOFF block if the old Lead is still alive, that first rebuilds the project's state with
   its project-state skill. The Human decides, and replacing a Lead follows the steps for it in your
   seat prompt.
   **Done** when each stale project has one suggestion and the question for the Human.
8. **Order the work, if the Human asks.** For each candidate, estimate the cost of delay per
   week (value times urgency) and the duration, and compute the cost of delay divided by the
   duration; a higher score argues for going first. Show the estimates and assumptions, marked as yours; the ordering is
   input, and the Human sets priority. **Done** when the table is shown, or the Human didn't ask.
9. **Write the report** in this shape, leaving out any empty section:

   ```text
   Needs you
   - PROJECT: QUESTION (default if you don't answer: DEFAULT)
   Blocked
   - PROJECT: ITEM, blocked since DATE, waiting on WHO
   Stale or unhealthy
   - PROJECT: EVIDENCE. Suggestion: RECOVERY
   Kit items due
   - ITEM
   Healthy: PROJECT, PROJECT
   ```

   Keep what you observed (with its source) apart from what you infer. **Done** when every
   project appears exactly once, in a section or on the Healthy line.

The rule that matters most: report what needs a Human decision, and compress everything healthy
into one line.
