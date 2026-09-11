---
name: integration
description: "Finishes accepted work: merges slice branches in dependency order, resolves conflicts by reading each side's intent from its commits, runs the full suite on the merged result before offering anything, offers the Human exactly three options, then removes verified worktrees and archives finished Peers. Use when every slice of an outcome is accepted and its branches need to come together."
---

# Integration

Use this skill to bring an outcome's accepted slices together, get the Human's decision on
where the result goes, and leave nothing behind: no stray worktree, live Peer, or heartbeat.

It produces an integration branch with a passing check run, the options block for the Human,
and a closing summary that ends with the `LESSON:` line.

## Before you start

- Every slice in the ExecPlan's Progress section is `accepted at SHA`, or dropped with a
  recorded ruling.
- `list_agents` shows none of this outcome's Peers still running, so no one writes into a
  branch while you merge it.
- You know the base branch from the ExecPlan or the owner directive. If it isn't written down,
  ask the Human, because merging into the wrong base is expensive to undo.

## Procedure

1. **Take inventory.** Run `git worktree list` and list the slice branches. For each accepted
   slice, confirm its SHA is on its branch:

   ```bash
   git merge-base --is-ancestor "$sha" BRANCH && echo on-branch
   ```

   Done when every slice maps to one branch and one SHA.

2. **Create the integration worktree** from the base, so the main checkout and any
   uncommitted work in it stay untouched:

   ```bash
   git worktree add WORKTREE_PATH -b integrate/SLUG BASE
   ```

   Put `WORKTREE_PATH` where the protocol's worktree rule says, for example
   `../REPO-wt/integrate-SLUG`. Done when `git -C WORKTREE_PATH status --short` is empty.

3. **Merge the slices in dependency order**, the order of the ExecPlan's dependency graph, and
   run the fast check after each merge, so a break points at one slice:

   ```bash
   git -C WORKTREE_PATH merge --no-ff --no-edit task/SLUG-S1
   ```

   Done when every slice is merged, or a conflict stops you at step 4.

4. **Resolve conflicts.** Resolving writes code, so brief an Engineer Peer whose owned scope is
   the conflicted files in the integration worktree, or resolve them yourself and open your
   summary with `LEAD-WROTE: <merge sha> — needs Human acceptance`. Whoever resolves works like
   this:

   1. List the conflicted files with `git diff --name-only --diff-filter=U`.
   2. Read each side's intent from its commits, its brief, and its handoff:
      `git log --format='%h %s%n%b' BASE..task/SLUG-S1 -- FILE`, and the same for the other
      side.
   3. Resolve hunk by hunk. Keep both intents where they can coexist. Where they can't, keep
      the side that serves the ExecPlan's outcome, and write the trade-off into the merge
      commit message. Add no new behavior during a merge; a behavior that turns out to be
      missing becomes a new slice.
   4. Finish the merge with `git add` and `git commit` rather than `git merge --abort` partway:
      aborting throws away every hunk already resolved, and the same conflict comes back.

   If both slices followed their briefs and the briefs contradict each other, the
   decomposition was wrong. Finish the merge on the side that matches the ExecPlan, record the
   contradiction as a ruling in the Progress section, and settle it (with council if it stays
   contested) before step 5. Done when `git diff --name-only --diff-filter=U` prints nothing and
   the merge is committed.

5. **Run the full checks on the merged result**: the acceptance command from `AGENTS.md`,
   including typecheck, the full test suite, and the formatter or linter, in the integration
   worktree. Hold the test lane while you do, so no other agent runs the suite at the same
   time. Done when every command exits 0 and its output is recorded.

   If a check fails, offer nothing yet. Find the slice that caused it (the per-merge checks
   from step 3, or `git bisect run CHECK_COMMAND`), send the failure back as a fix round with
   the decompose skill, and rerun this step. A green run earlier in the session proves only the
   tree it ran on.

6. **Offer exactly three options**, in this form, and wait for the Human's answer:

   ```text
   Integration ready: integrate/SLUG at SHA, based on BASE.
   Checks: ACCEPT_COMMAND passed (SUMMARY).
   Needs your acceptance first: LEAD_WROTE_SHAS
   Open items: OPEN_ITEMS

   1. Merge integrate/SLUG into BASE locally
   2. Open a pull request (push the branch and create the PR)
   3. Keep the branch as it is

   Which option?
   ```

   Replace `LEAD_WROTE_SHAS` with the commits you wrote, or `none`, and `OPEN_ITEMS` with
   unresolved findings, rulings you made, and scheduled contract steps, or `none`. The list is
   fixed because pushing and pull requests leave this machine, so the Human chooses. Discarding
   the work isn't on it: that happens only when the Human asks in so many words, and then you
   list the branch, commits, and worktrees it would delete and wait for an explicit yes. Done
   when the Human has chosen.

7. **Carry out the choice:**

   - **Merge locally.** Check that the main checkout is clean (`git status --short`), then run
     `git switch BASE && git merge --no-ff integrate/SLUG` and rerun the acceptance command on
     `BASE`. If it fails, stop and keep every branch and worktree; the merge is local, so ask
     the Human before undoing it.
   - **Pull request.** The push and the PR are the Human's, and this seat's deny list blocks
     `git push` and `gh`. Give the Human the commands, for example
     `git push -u origin integrate/SLUG` and `gh pr create --base BASE --head integrate/SLUG`.
     Keep the worktrees, because review feedback gets fixed there.
   - **Keep.** Report the branch and the worktree paths.

   Done when the merged `BASE` passes the acceptance command, or the Human has the commands, or
   you have reported the paths.

8. **Remove the worktrees**, only after a local merge whose result passed. For each worktree
   of this outcome:

   ```bash
   git -C PATH status --porcelain
   git worktree remove PATH
   git branch -d BRANCH
   ```

   `git branch -d` refuses a branch that isn't merged, which is the check you want. If
   `git worktree remove` refuses because of modified or untracked files, those files exist
   nowhere else: show the Human `git -C PATH status --porcelain -uall` and ask whether to
   commit, move, or delete them, and use `--force` only on their word. For a worktree that
   `create_workspace` made, archive its agents, then ask the Human to archive that workspace in
   the Paseo app instead of removing its directory yourself, so Paseo's record and the disk
   agree. Done when `git worktree list` shows only the worktrees you were asked to keep.

9. **Archive and close.** Archive every Peer of this outcome that is still listed, accepted or
   abandoned, with `archive_agent`; archiving an agent also archives its subagents. Confirm
   with `list_schedules` that no heartbeat for this outcome remains. After a local merge, move
   durable decisions from the ExecPlan into their owners (ADRs, `AGENTS.md`) and delete the
   plan in its own commit on `BASE`; for the other two options, the plan stays until the work
   lands. Done when `list_agents` shows no live agent for this outcome and the closing summary
   ends with `LESSON:`.

The rule that matters most: offer options only on a green merged result, and let the Human
decide anything that leaves this machine.
