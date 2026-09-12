---
name: integration
description: "Merges accepted slices in dependency order, has an Engineer resolve conflicts, runs the full suite, offers the Human three options, and cleans up. Use before any merge into the base branch, even for tiny work with no ExecPlan."
---

# Integration

Every merge into the base branch goes through this skill, tiny and normal work included: merge
the accepted slices, get the Human's decision on where the result goes, and leave no stray
worktree, live Peer, or heartbeat. Output: an integration branch with a passing check run, the
options block, and a closing summary ending with the `LESSON:` line.

## Before you start

- Every slice in the ExecPlan's Progress is `accepted at SHA`, or dropped with a recorded ruling.
  With no ExecPlan, the accepted SHAs in your acceptance summary are the slices.
- `list_agents` shows none of this outcome's Peers running, so no one writes into a branch you
  merge.
- You know the base branch from the owner directive; otherwise ask the Human, since a merge into
  the wrong base is expensive to undo.

## Procedure

1. **Take inventory.** Run `git worktree list`, list the slice branches, and confirm each
   accepted SHA is on its branch:
   `git merge-base --is-ancestor "$sha" BRANCH && echo on-branch`.
   Done when every slice maps to one branch and one SHA.

2. **Create the integration worktree** with the `create_workspace` call in the decompose
   skill's step 9, with `branchName: "integrate/SLUG"`, `worktreeSlug: "integrate-SLUG"`, and
   `title: "SLUG integration"`, so the main checkout and any uncommitted work in it stay
   untouched and a conflict Peer can be placed in it. Keep the returned workspace ID, and call
   its directory `WORKTREE_PATH`. Done when `git -C WORKTREE_PATH status --short` is empty.

3. **Merge the slices in dependency order** (the ExecPlan's dependency graph, else acceptance
   order), running the fast check after each merge so a break points at one slice:
   `git -C WORKTREE_PATH merge --no-ff --no-edit task/SLUG-S1`.
   Done when every slice is merged, or a conflict stops you at step 4.

4. **Resolve conflicts.** Resolving writes code, so never resolve them yourself: brief an
   Engineer Peer from the Peer profile, pass the integration workspace's ID as `workspaceId`,
   and make the conflicted files in `WORKTREE_PATH` its owned scope. The Peer:

   1. Lists the conflicted files: `git diff --name-only --diff-filter=U`.
   2. Reads each side's intent from its commits, brief, and handoff:
      `git log --format='%h %s%n%b' BASE..task/SLUG-S1 -- FILE`, and likewise for the other side.
   3. Resolves hunk by hunk, keeping both intents where they coexist, else the side serving the
      ExecPlan's outcome, with the trade-off in the merge commit message. Adds no new behavior
      during a merge; a missing behavior becomes a new slice.
   4. Finishes with `git add` and `git commit`, never `git merge --abort` partway, which discards
      every resolved hunk and brings the conflict back.

   If both slices followed their briefs and the briefs contradict each other, the decomposition
   was wrong: finish the merge on the side matching the ExecPlan, record the contradiction as a
   ruling in Progress, and settle it (with council if contested) before step 5. Done when
   `git diff --name-only --diff-filter=U` prints nothing and the merge is committed.

5. **Run the full checks on the merged result** in the integration worktree: the acceptance
   command from `AGENTS.md`, with typecheck, the full test suite, and the formatter or linter.
   Hold the test lane while you do, so no other agent runs the suite at the same time. Done when
   every command exits 0 and its output is recorded.

   If a check fails, offer nothing yet. Find the slice that caused it (step 3's per-merge checks,
   or `git bisect run CHECK_COMMAND`), send the failure back as a fix round with the decompose
   skill, and rerun this step. An earlier green run proves only the tree it ran on.

6. **Offer exactly three options** in this form and wait for the Human's answer. When the
   directive says to proceed and reserves nothing, merge locally (option 1) and send the block
   with `Merged locally: the directive said to proceed`:

   ```text
   Integration ready: integrate/SLUG at SHA, based on BASE.
   Checks: ACCEPT_COMMAND passed (SUMMARY).
   Open items: OPEN_ITEMS

   1. Merge integrate/SLUG into BASE locally
   2. Open a pull request (push the branch and create the PR)
   3. Keep the branch as it is

   Which option?
   ```

   `OPEN_ITEMS` is unresolved findings, your rulings, and scheduled contract steps, or `none`.
   The list is fixed, since a push or PR leaves this machine. Discarding the work isn't on it:
   only when the Human asks in so many words, list the branch, commits, and worktrees it would
   delete, and wait for an explicit yes. Done when the Human has chosen, or the directive chose
   for them.

7. **Carry out the choice:**

   - **Merge locally.** Check that the main checkout is clean (`git status --short`), run
     `git switch BASE && git merge --no-ff integrate/SLUG`, and rerun the acceptance command on
     `BASE`. If it fails, stop and keep every branch and worktree; the merge is local, so ask
     the Human before undoing it.
   - **Pull request.** The push and PR are the Human's (this seat's deny list blocks `git push`
     and `gh`): give them the commands, such as `git push -u origin integrate/SLUG` and
     `gh pr create --base BASE --head integrate/SLUG`, and keep the worktrees for review fixes.
   - **Keep.** Report the branch and the worktree paths.

   Done when the merged `BASE` passes the acceptance command, the Human has the commands, or you
   have reported the paths.

8. **Remove the worktrees**, only after a local merge whose result passed. For each worktree of
   this outcome, first run `git -C PATH status --porcelain -uall`. If it prints anything, those
   files exist nowhere else: show the Human the output and ask whether to commit, move, or
   delete them. Once it is clean, archive a worktree `create_workspace` made with
   `archive_workspace` and its workspace ID, so Paseo archives its agents and removes the
   directory in step with its record; remove any other with `git worktree remove PATH`. Then
   run `git branch -d BRANCH`, which refuses an unmerged branch: the check you want. Done when
   `git worktree list` shows only the worktrees you were asked to keep.

9. **Archive and close.** Archive every listed Peer of this outcome, accepted or abandoned, with
   `archive_agent` (its subagents go with it), and delete each heartbeat you noted, in Progress
   or, with no ExecPlan, in your earlier replies, with `delete_heartbeat`; `list_schedules` shows
   schedules, never heartbeats. After a local merge, move durable decisions from the ExecPlan
   into their owners (ADRs, `AGENTS.md`, a contract document) and delete the plan in its own
   commit on `BASE`, unless `AGENTS.md` says to keep finished plans; otherwise the plan stays
   until the work lands. Done when
   `list_agents` shows no live agent for this outcome and the closing summary ends with
   `LESSON:`.

The rule that matters most: offer options only on a green merged result, and let the Human
decide anything that leaves this machine.
