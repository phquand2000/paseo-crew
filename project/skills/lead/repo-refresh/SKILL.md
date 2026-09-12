---
name: repo-refresh
description: "Audits a whole repo for stale docs, plans, tests, proof, and debris, classifies suspects KEEP, MERGE, REWRITE, DEMOTE, DELETE, or BLOCKED, and in apply mode makes one verified local cut. Use only when the Human asks to refresh, clean up, or audit it."
disable-model-invocation: true
---

# Repository refresh

Use this skill to rebuild a repository around its current truth: one owner per contract, only
active plans, and only proof that protects a current risk. It is an explicit, repository-wide
cleanup that runs when the Human asks for it, not routine housekeeping and not a reason to
redesign working production code. It produces a refresh ledger in a file outside the repository
and, in apply mode, local commits and a completion report.

Before you audit or change anything, read `references/refresh-standard.md` (relative to this
skill's directory). It defines current truth, and every disposition below is judged against it.

## Choose the mode

Take the mode from the request given with this skill:

- `audit`, the default for a bare request: inspect and report; change nothing.
- `apply`: audit, make the cut, and verify it. Refresh, clean, remove, or consolidate ask for
  this mode.
- `verify`: check an earlier refresh against its ledger, without widening its scope.

An age threshold in the request marks suspects for a closer look, not deletion targets. Without
one, judge by current consumers and ownership, not by dates.

## Boundaries

- Run `git status --short` first. Uncommitted changes you didn't make belong to someone else:
  leave them, and keep their paths out of the ledger.
- Delete only tracked files, with `git rm`, so git keeps their history. An untracked or ignored
  file exists nowhere else: list it as `BLOCKED` and ask the Human.
- Commit locally only; pushing, opening pull requests, and closing tracker issues are the
  Human's.
- Keep production behavior as it is. Report a production defect as a separate item; don't fix
  it in the refresh.
- Git is the archive: create no `archive/`, backup, or `old/` directory and no forwarding
  stubs, because each would become a second source of truth.
- `AGENTS.md` may add stricter rules; follow them. If it seems to require keeping material the
  standard says to remove, raise the conflict with the Human instead of choosing.

## Procedure

1. **Establish the current contract**: product entry points and production owners; canonical
   architecture, product, process, and operational documents; active ExecPlans and open work;
   owners of tests, benchmarks, validators, and gates; generated files and their producers; and
   the commands that define acceptance. Trust code and consumers over filenames, folder names,
   issue states, timestamps, and labels such as "authoritative". Done when each item has a path
   and the consumer or command that shows it is current.

2. **Build the inventory ledger** outside the repository: run `echo "${TMPDIR:-/tmp}"` and
   write `refresh-REPO-DATE.md` under the absolute path it prints (the Write tool expands no
   variables), one row per suspect:

   ```text
   | Path | Kind | Owner | Current consumer | Unique current information | Destination | If deleted | Disposition | Evidence |
   ```

   Cover docs (governing, duplicate, indexes, archives, reviews, postmortems); plans and issues
   (active, finished, orphaned, superseded); tests and proof routes, including custom
   task-runner machinery; scripts, fixtures, snapshots, reports, generated output, and tracked
   build debris; dead links, paths, commands, and owner names; and unusually large or
   fragmented surfaces that hide one contract. For a large repository, split the inventory by
   top-level area across Scout Peers from the read-only Peer profile (`pi-peer-ro`, `low`
   thinking), each returning rows for its area, and merge the rows yourself. Done when every
   row has its owner, consumer, unique information, destination, and deletion consequence, or
   `none` where that is the finding.

3. **Classify each row** with exactly one disposition:

   - `KEEP`: current truth with a unique owner, or proportionate proof.
   - `MERGE`: unique current truth that belongs in another canonical owner.
   - `REWRITE`: the owner is right, but history or duplication hides the current content.
   - `DEMOTE`: useful only as a non-gating diagnostic or a closeout record.
   - `DELETE`: stale, duplicated, generated debris, dead proof, or history git already holds.
   - `BLOCKED`: removing it would cross an unresolved product, compatibility, legal, or
     operational decision.

   Age, size, ugliness, and low coverage support a disposition but are never one. Done when
   every row has one disposition and a line of evidence.

4. **Report the audit** to the Human: the ledger path, the count per disposition, and each
   `BLOCKED` row with the decision it waits on. In audit mode, stop here. Done when every
   `BLOCKED` row names the Human decision that would unblock it.

5. **Make the cut** (apply mode). Brief one Engineer Peer with the ledger as its input. Its
   owned scope is every path marked `MERGE`, `REWRITE`, `DEMOTE`, or `DELETE`, plus the files
   whose references it has to update; its authority is local commits only; its verification is
   step 6. Use one writer, because the cut edits references across the whole repository and two
   writers would collide. The Peer works in this order, so no commit leaves two sources of
   truth:

   1. Merge unique current truth into its canonical owner.
   2. Update live references and instruction routing.
   3. Delete the superseded sources in the same commit as the merge.
   4. Compact finished tracker records to identity, dependencies, disposition, and a short
      closeout.
   5. Keep only active plans; delete finished plans, review packets, and `docs/reviews/`
      reports whose findings are fixed, once their durable decisions have reached their owners.
   6. Remove or demote proof that has no current risk, independent oracle, production
      consumer, or sensitivity to the behavior disappearing.
   7. Remove tests that pin retired implementation detail or repository history and protect no
      current public, security, compatibility, or machine contract.
   8. Remove dead scripts, unowned fixtures, stale tracked reports, and reproducible generated
      output, unless distribution needs it tracked.
   9. Collapse to one documentation index and fewer folders, leaving no empty taxonomy.

   Done when the handoff's SHAs pass your acceptance checklist.

6. **Verify the result** (apply and verify modes) with proportionate checks, adding no new proof
   framework. Start with deleted paths that are still referenced; this prints nothing when the
   cut is clean:

   ```bash
   base=BASE_SHA
   git diff --name-only --diff-filter=D "$base" HEAD | while read -r p; do
     git grep -n -F -e "$p" -e "$(basename "$p")" -- . && echo "STILL REFERENCED: $p"
   done
   ```

   Then run, where they exist: the link checker, tracker and plan schema checks, parity checks
   between retained generated files and their producers, the tests for changed tooling, the
   formatter, and the smallest acceptance command in `AGENTS.md` whose contract the cut
   touched. If a mandatory gate is itself the debt being removed, verify its replacement
   directly. Done when every command has recorded output or is named as unavailable.

7. **Report completion**: the structural outcome with before and after counts; what was merged,
   deleted, rewritten, and deliberately kept; proof machinery removed or demoted and why; the
   checks run and any that were unavailable; blocked decisions and remaining debt. Done when
   each item has a line.

The refresh isn't complete while a live reference points to removed material, two documents own
one contract, a finished plan is still in `docs/exec-plans/active/`, or a mandatory proof route
has no named current risk and consumer. Report any of these as open instead.

The rule that matters most: move current truth into its owner before deleting anything, and
let git hold the history.
