---
name: change-rollout
description: "Plans hard-to-undo schema, API, data, or release changes as parallel-change, strangler, or hard-cut steps with a proven rollback and preset abort metrics. Use when intake rates a change High on undo or leverage, or a hard-cut policy applies."
---

# Change rollout

Use this skill to turn a change `git revert` can't undo into steps that each can be undone, or,
where the repository's hard-cut policy applies, into one synchronized cut. It produces the
rollout part of the ExecPlan's "Acceptance and recovery" section, a rollout sheet for the Human
(template in `references/rollout-sheet.md`, relative to this skill's directory), and the slices
the decompose skill schedules.

Before you start, have the intake result, and know whether the repository's `AGENTS.md` sets a
hard-cut policy.

## Choose the route

Write one route and its reason into the ExecPlan's Direction section:

- **Hard cut**: `AGENTS.md` sets a hard-cut policy, typically a pre-release product with exactly
  one live contract. Go to "Hard-cut route".
- **Parallel change** (expand, migrate, contract): an interface, schema, or data format whose
  consumers can move in steps.
- **Strangler**: replacing a component or system behind a seam, one piece at a time.
- **None fits**: the change can't be staged, such as a destructive data change. It is an
  irreversible trade-off: take it to the Human with a backup and a restore proven as in step 1
  of "Before any rollout step".

Done when the Direction section names the route.

## Parallel change

1. **Expand.** Add the new form beside the old one, so both work and existing consumers don't
   change. For a schema: add the new column or table as nullable, write to both, backfill in
   batches small enough to stop between, then switch reads. Done when the old tests pass
   unchanged and new tests cover the new form.
2. **Migrate.** Move consumers in batches sized by blast radius, each its own slice that depends
   on the expand slice and is deployable and revertible alone. Done when
   `git grep -n -w OLD_NAME` is empty and consumers outside this repository show no use of the
   old form in logs or metrics.
3. **Contract.** In a final slice that depends on every batch, remove the old form, the dual
   writes, and the scaffolding. Drop an old column in a later release than the read switch, so
   rolling back the switch still finds its data. Done when every removal condition in the
   scaffolding register is met and `git grep -n "TEMPORARY(SLUG)"` is empty.

Parallel changes stall at the contract step, and a half-finished one leaves two forms to
maintain; step 2 of "Before any rollout step" schedules it.

## Strangler

1. **Build the seam**: a router, facade, or interception point for the state-changing events,
   first as a refactor with no behavior change. Done when the existing checks pass with it.
2. **Route one piece through the new component** while the old one keeps running. Where the old
   system expects its own conventions, make the new component speak them rather than changing
   the old system. Done when that piece's acceptance check passes through the new path.
3. **Shift the flow in steps** (by product, tenant, or ID range), comparing each step with the
   old behavior or the product's acceptance evidence. Done when each step has a recorded
   comparison.
4. **Retire the old part** once nothing routes to it, and remove the seam unless it has a
   lasting job. Done when the old code is deleted and its entry leaves the scaffolding register.

Copy only behavior someone still needs; full feature parity carries forward what the
replacement was meant to drop.

## Scaffolding register

Record every temporary piece (dual write, adapter, router, mimic, feature flag, compatibility
read) in two places, because unrecorded ones become permanent:

- at the code: `TEMPORARY(SLUG): REASON. Remove when: CONDITION.`, so `git grep -n "TEMPORARY("`
  lists them all;
- as a row in the rollout sheet's scaffolding table, with the slice that removes it.

This record also satisfies the acceptance check that a least-painful patch has its removal
condition in the repository.

## Before any rollout step

1. **Prove the rollback.** Run the way back for real, locally or in a test environment, before
   the forward step runs anywhere shared: the down migration against a copy of the data, the
   flag turned off, the previous build redeployed, or the restore from backup. Record the
   command and its output in the ExecPlan. Done when the output shows the prior state again,
   for example a schema dump identical to the one taken before, or the old tests passing. If no
   rollback has ever run, the step is irreversible: say so and take it to the Human.
2. **Schedule the contract step** as a slice with a trigger (a date, a usage threshold, or "one
   release after the read switch"), and name it in every acceptance summary until it is done.
   A date-based trigger outlives your session, so give it to the Human to track. Done when the
   rollout sheet's contract section is filled in.
3. **Declare the gradual rollout** where the product supports one (feature flags, canary
   deployments, staged percentages). Fix every value now, because thresholds chosen while
   watching the numbers fit whatever the numbers show:
   - a canary population, and a same-size control group running the old version at the same
     time, because a before-and-after comparison mixes in time-of-day and traffic effects;
   - at most about a dozen metrics users would notice (error rate, latency, a key business
     action) that this change could plausibly move;
   - an abort threshold per metric, and the action when it trips: stop, roll back, then
     investigate;
   - a duration per stage covering at least one full metric window and the time the failure
     would take to show, such as a peak hour or a daily batch;
   - one change in the canary at a time, so a tripped metric points at one cause.

   Where the product has no staged rollout, the sheet holds the smoke check after deploy and
   the rollback trigger instead. Done when every canary field in the rollout sheet is filled in.
4. **Hand off what leaves the machine.** Pushing, deploying, a migration on a shared database,
   flipping a hosted flag, and calling external services go to the Human with the rollout
   sheet: the exact commands in order, who watches which metric, and the abort action. Pushing
   always stays with the Human; a Peer's brief grants any of the others only when an owner
   directive authorizes it, and then its Authority field names it. Done when the Human has the
   sheet and their decision is recorded in the ExecPlan.

## Hard-cut route

Use this route when `AGENTS.md` sets a hard-cut policy. The policy exists to prevent a second
live path, so don't use the expand-and-contract machinery.

1. **Replace the contract in place.** If the policy fixes the version number until the first
   release, keep the number and replace the content. Done when the repository exposes one
   contract.
2. **Sync every consumer in the same change.** Every producer, consumer, and generated artifact
   that ships or that the toolchain loads moves in the same change, so no accepted state has
   two contracts live. In decompose, make this one slice, or slices merged before acceptance.
   Done when the acceptance command passes on the combined result.
3. **Fail fast on old data.** Reject data that doesn't match the current contract with a clear
   error; a failed path doesn't switch to other semantics. Leave out dual reads and writes,
   version branches, shims, adapters for old shapes, legacy parsers, and read-time upgrades.
   Done when a test feeds invalid data and sees the error.
4. **Reset development state instead of migrating it.** A reset deletes data, so name the
   command and get the Human's go-ahead before it runs. Done when the Human has agreed and the
   reset ran.
5. **Audit tests and fixtures rather than updating them mechanically.** Keep or update those
   that exercise the current contract. Derive negative cases from current constants and
   boundaries (`WIDTH - 1`, `WIDTH + 1`) instead of naming deleted fields or values. Delete
   tests whose only claim is that a retired contract is rejected. Done when each changed test
   answers "what current behavior does this protect?".
6. **Remove every trace of the old names.** List the removed identifiers and literals from the
   diff, then search for each one:

   ```bash
   git diff "$base" HEAD -U0 -- CONTRACT_PATHS | grep '^-[^-]'
   git grep -n -w REMOVED_NAME
   ```

   Done when each search is empty in code, tests, and fixtures. Put the list of searches in the
   handoff, not in the repository: a committed blacklist, tombstone list, or source-substring
   test keeps the dead name alive.
7. **Prove the rollback once**: `git revert` of the whole cut plus a rebuild of development
   state, run locally before the Human pushes. Done when the reverted tree passes the
   acceptance command.

The rule that matters most: prove the way back before taking a step forward, and leave every
step that reaches beyond this machine to the Human.
