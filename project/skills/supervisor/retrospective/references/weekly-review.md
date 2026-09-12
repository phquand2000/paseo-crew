# Weekly review

The `WEEKLY REVIEW` heartbeat runs this instead of the episode procedure: the week's log and
notebook become one action per pattern, and nothing is applied until the Human approves. Paths
are relative to the repository root.

1. **Collect the week.** Read the attention logs in `.seatworks/records/attention/` for the last
   seven days, where the watcher has already logged each `decision`, `detour`, `acceptance`, and
   `check answer` it saw, and the notebook entries added or seen this week. Call
   `get_agent_activity` only to fill a gap: a day a Lead ran with no log line, or a quote too
   short to judge. **Done** when each item has a date and a source.
2. **Group by pattern.** Merge items that describe the same behavior, and count the distinct days
   each pattern appeared. From the `check answer` and `-> checked` lines, note which `CHECK:`
   questions found something and which found nothing. Look also for patterns that show only over
   time: a Peer that agrees with every brief or objects for show, and a Lead that never changes a
   ruling after evidence or folds on every objection. **Done** when every item belongs to one
   pattern.
3. **Choose one action per pattern:**
   - `notebook-only` for a first sighting: add or update its notebook entry.
   - `patch` through the protocol-patch skill, when the pattern appeared on two different days.
   - `watch`: a new trigger in `.seatworks/WATCHER.md`, or a new question or default step in the
     attention-watch skill's `references/questions.md`, when a question at the right moment
     would have caught it. This goes through protocol-patch too.
   - `kit`: when `grep` finds the pattern in another project's `.seatworks/NOTEBOOK.md` too, a
     kit diff for the Human through protocol-patch, since that sighting is the second day.

   **Done** when every pattern has one action.
4. **Check earlier patches.** For each notebook entry whose status is `applied SHA`, did the
   pattern stop after that commit? A patch that changed nothing is a pattern of its own. **Done**
   when each is marked held or not held.
5. **Report** in at most eight lines: the patterns, the proposed changes, strategies in
   `.seatworks/records/strategy/` past their `Review by` date, and what needs a Human decision.
   **Done** when the report is sent.
