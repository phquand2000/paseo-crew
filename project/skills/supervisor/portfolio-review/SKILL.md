---
name: portfolio-review
description: "Reports what needs the Human across projects (Lead health, pending acceptances, blocks, one-way doors, stale work) and maps the seams between projects, giving each one owning Lead, consumer checks, and a gate per phase. Use when the Human asks where things stand, for help with priorities, or to coordinate a change another project relies on."
---

# Portfolio review

Use this skill to tell the Human what needs them across every project, and to own the seams
between projects that no single Lead can see. The Human owns priority; the review gives facts and
questions, not the order.

The status report goes in the conversation and isn't saved: it's a snapshot, and the durable facts
live in git, the notebook, and the integration map at `.seatworks/records/integration/NAME.md`,
written from
[references/integration-map-template.md](references/integration-map-template.md). `references/`
paths are relative to this skill's directory; the rest to the repository root.

## Review the portfolio

1. **Set the scope.** If the Human names a concern (architecture, product intent, safety,
   delivery, or integration), read [references/concern-lenses.md](references/concern-lenses.md)
   and keep only what that lens watches. The stale threshold N is 7 days unless the Human gave
   another number. The project list is every workspace `list_agents` returns with `cwd: "/"`, plus
   any project the Human names. **Done** when the lens, N, and the project list are fixed.
2. **Read the Paseo state, and sample it sparingly.** Group `list_agents` (with `cwd: "/"`) by
   workspace; a project's Lead is the agent on the `lead` provider in that project's workspace.
   Call `get_agent_activity` on each Lead for entries since your last review, and on a Peer only
   when the Lead's points at a problem there, since every sample costs context. Look for a Peer
   handoff with no acceptance summary; a `BLOCKED`, `DEPENDENCY_REQUEST`, or `REOPEN_REQUEST` with
   no ruling; a decision waiting on the Human, especially an irreversible one; and the Lead
   triggers in `.seatworks/WATCHER.md` against that project's recent
   `.seatworks/records/attention/`. **Done** when each project has a Lead row, or "no Lead", with
   findings or the word "healthy".
3. **Read each repository.** Run `git -C REPO log -1 --format=%ad --date=short` and
   `git -C REPO log --since=LAST_REVIEW --oneline`, read the active ExecPlans if the repository
   keeps them (for example under `docs/exec-plans/active/`), and read the project's directive
   under `.seatworks/records/directives/`. **Done** when each project has an outcome, a last commit
   date, and a last activity date.
4. **Classify each project** into the first class that fits: needs the Human (an irreversible
   decision waiting, or a reserved decision whose trigger point has come); blocked (an open
   blocking request with no ruling for over a day); unhealthy Lead (signals from step 2); stale (no
   commit and no agent activity for N days while the outcome isn't met); healthy. **Done** when
   every project has exactly one class.
5. **Check your own records.** Flag strategies in `.seatworks/records/strategy/*.md` past their
   review date, integration maps with a phase open longer than its appetite, and notebook entries
   whose `Seen` shows two different days while `Status` is still `open`. **Done** when each item is
   flagged or clear.
6. **Suggest a recovery for each stale project**; don't carry it out. Usually a fresh Lead with the
   original outcome as an `OWNER DIRECTIVE:`, plus the old Lead's HANDOFF block if that Lead is
   still alive, which rebuilds state with its project-state skill. Replacing this project's Lead
   follows the steps for it in your seat prompt; another project's Supervisor decides for that
   project. **Done** when each stale project has one suggestion and the question for the Human.
7. **Order the work, if the Human asks.** Estimate each candidate's cost of delay per week (value
   times urgency) and its duration, then divide: a higher score argues for going first. Show the
   estimates and assumptions as yours; the Human sets priority. **Done** when the table is shown,
   or the Human didn't ask.
8. **Write the report** in this shape, leaving out any empty section:

   ```text
   Needs you
   - PROJECT: QUESTION (default if you don't answer: DEFAULT)
   Blocked
   - PROJECT: ITEM, blocked since DATE, waiting on WHO
   Stale or unhealthy
   - PROJECT: EVIDENCE. Suggestion: RECOVERY
   Seams and records due
   - ITEM: PHASE or DATE, waiting on GATE
   Healthy: PROJECT, PROJECT
   ```

   Keep what you observed, with its source, apart from what you infer. **Done** when every project
   appears exactly once, in a section or on the Healthy line.

## Map a seam between projects

Each Lead sees only its own workspace, so a contract between projects has no owner until you map
it. Work through this when the Human asks you to coordinate a change another project relies on.

1. **List the seams.** For each pair of projects, record what crosses (a package, an API, a schema,
   an event or file format, an auth token or secret, a shared database, or a deploy order), where
   the provider defines it, and where each consumer uses it; find the uses by searching the
   consumer repositories for import names, endpoint paths, or table names (`grep -rn`). **Done**
   when every use the search finds is attached to a seam in the map.
2. **Propose one owning Lead per seam**, normally the provider's: it decides the contract's shape
   and sequences changes, while consumers state what they need. Two owners means nobody owns it,
   and an unowned seam breaks at the first change. Ownership across projects is the Human's
   decision, so propose it and ask. **Done** when each seam has one owning Lead, recorded by
   project and agent ID, and confirmed by the Human.
3. **Turn consumer needs into checks the provider runs.** Ask each consumer's Lead to write, in its
   own repository, a runnable check covering only what that consumer relies on (the fields, calls,
   and behavior it uses), and to report its path and SHA. The provider's Lead adds those checks to
   what it runs before acceptance, so it can change the rest freely and a consumer learns of a
   break before it ships. **Done** when every seam lists its consumer checks and the provider
   command that runs them.
4. **Classify the change and set each phase's gate.** Additive: one directive to the provider and a
   notice to the consumers. Breaking: the owning Lead runs it as the parallel change in its
   change-rollout skill, which holds the expand, migrate, and contract mechanics; what you add is
   the gate that opens each phase across projects.

   | Phase | Gate |
   |---|---|
   | Expand | every consumer check passes against the provider's new SHA |
   | Migrate | every consumer has an accepted SHA on the new form, and its check now covers that form |
   | Contract | every consumer check passes against a provider build without the old form |

   Removing the old form is irreversible once external consumers exist, so the contract phase is
   reserved for the Human. When every consumer is one of these projects and none has shipped the
   old form, propose a hard cut instead. **Done** when the map records the change's class and, for
   a breaking change, each phase's gate.
5. **Get the Human's approval, then relay.** Show the map, the owners, the checks, and the phase
   plan. Once the Human approves, write each project an `OWNER DIRECTIVE:` with its outcome, the
   seam and its owner, the checks it runs or writes, the current phase and gate, the decisions
   reserved for the Human, and the other project's Lead as counterpart. Add this line, because a
   Lead treats an unlabeled message as the Human's: "Messages from the Lead of PROJECT about this
   seam are requests between Leads: settle them with evidence, and report any decision that changes
   the seam." Send this project's directive to its Lead, as in "Sending the directive" in the
   intent-interview skill; another project's goes to that project's Supervisor, which is the agent
   `list_agents` shows in that repository's workspace. **Done** when every involved Lead has its
   directive, confirmed by `get_agent_activity` or by its Supervisor.
6. **Track the phases, then close the change.** Check each SHA a Lead reports with
   `git -C REPO log -1 "$sha"` and record it in the map; open the next phase only once the current
   gate passes. Mark the change `settled` when the last gate passes, and keep the seams and checks
   listed, since the next change starts from them. **Done** when the map's phase column matches the
   repositories and no phase is open.

The rule that matters most: report what needs a Human decision, compress everything healthy into
one line, and give every seam one owning Lead whose consumers state their needs as checks.
