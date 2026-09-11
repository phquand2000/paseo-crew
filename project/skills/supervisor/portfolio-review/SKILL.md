---
name: portfolio-review
description: "Produces a decision-oriented status across all workspaces for the Human: for each project the outcome, Lead health, pending acceptances, blocked items, one-way doors awaiting the Human, and stale projects with a recovery suggestion, filtered to one concern lens when you are specialized. Use when the Human asks where things stand, before priorities are set, or when coming back after a long gap."
---

# Portfolio review

Use this skill to tell the Human what needs them across every project, and to leave out
everything that doesn't. The Human owns priority; the review gives them the facts and the
questions, not the order.

The skill produces a report in the conversation. It isn't saved, because it's a snapshot, and
the durable facts already live in git and the notebook. Paths starting with `references/` are
relative to this skill's directory; every other path is relative to the repository root.

## Procedure

1. **Set the scope.** Read your first prompt for a concern. If it names one (architecture,
   product intent, safety, delivery, or cross-workspace integration), read
   [references/concern-lenses.md](references/concern-lenses.md) and keep only the items your lens
   watches. Set the stale threshold N: 7 days unless the Human gave another number. **Done** when
   the lens, N, and the project list are fixed. The project list is every workspace
   `list_agents` returns, plus any project the Human names.
2. **Read the Paseo state.** Run `list_agents` and group the agents by workspace. For each
   project, identify its Lead (provider `claude-lead-SLUG`), its Peers, their states, and the time of
   their last activity. **Done** when each project has a Lead row, or "no Lead".
3. **Sample the activity sparingly.** For each Lead, call `get_agent_activity` limited to the
   recent entries since your last review. Read a Peer's activity only when the Lead's activity
   points at a problem there, because every sample costs your context. Look for:
   - pending acceptance: a Peer handoff with no acceptance summary yet, or a `LEAD-WROTE:` line
     waiting for the Human;
   - blocked items: a `BLOCKED`, `DEPENDENCY_REQUEST`, or `REOPEN_REQUEST` without a ruling;
   - decisions waiting on the Human, especially irreversible ones;
   - signs of an unhealthy Lead, from the Observing list in `.seatworks/SUPERVISOR.md`.

   **Done** when each Lead has either findings or the word "healthy".
4. **Read each repository.** Run `git -C REPO log -1 --format=%ad --date=short` and
   `git -C REPO log --since=LAST_REVIEW --oneline`. Read the active ExecPlans if the repository
   keeps them (for example under `docs/exec-plans/active/`), and the project's directive under
   `.seatworks/records/directives/`. **Done** when each project has an outcome, a last commit date, and a last
   activity date.
5. **Classify each project.** Put it in the first class that fits:
   - Needs the Human: an irreversible decision waiting, a `LEAD-WROTE:` acceptance, or a
     reserved decision whose trigger point has come.
   - Blocked: an open blocking request with no ruling for more than a day.
   - Unhealthy Lead: signals from step 3.
   - Stale: no commit and no agent activity for N days while the outcome isn't met.
   - Healthy: none of the above.

   **Done** when every project has exactly one class.
6. **Check your own records.** Flag strategies in `.seatworks/records/strategy/*.md` past their review date,
   `.seatworks/records/safety/seat-matrix.md` older than the last provider or guard change, integration maps in
   `.seatworks/records/integration/*.md` with a phase open longer than its appetite, and notebook entries whose
   `Seen` shows two different days while the `Status` is still `open`. **Done** when each item is
   flagged or clear.
7. **Suggest a recovery for each stale project.** Suggest it; don't carry it out. The usual
   suggestion is a fresh Lead: create it on `claude-lead-SLUG` with the original outcome as an
   `OWNER DIRECTIVE:`, plus the old Lead's HANDOFF block if the old Lead is still alive, and have
   it rebuild the project's state first, with its project-state skill. The Human decides, and replacing a Lead follows "Replacing a Lead"
   in `.seatworks/SUPERVISOR.md`. **Done** when each stale project has one suggestion and the
   question for the Human.
8. **Order the work, if the Human asks.** For each candidate, estimate the cost of delay per week
   (value times urgency) and the duration, and compute the cost of delay divided by the duration;
   a higher score argues for going first. Show the estimates and their assumptions, and mark them
   as yours. The ordering is input, and the Human sets priority. **Done** when the table is shown,
   or the Human didn't ask.
9. **Write the report.** Use this shape, and leave out any empty section:

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
   project appears exactly once, either in a section or on the Healthy line.

The rule that matters most: report what needs a Human decision, and compress everything healthy
into one line.
