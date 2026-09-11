# Rollout sheet template

The rollout sheet goes to the Human for every step that leaves this machine: the steps in order,
the proven way back from each, and the signals that stop the rollout. Write it before the first
step runs anywhere shared, because thresholds and rollback commands chosen under pressure fit
whatever is happening at the time. Keep it in the ExecPlan's "Acceptance and recovery" section,
or in a file next to the plan that the section links to.

Copy this block:

```md
## Rollout: OUTCOME

Route: ROUTE
Rollback proven: ROLLBACK_EVIDENCE

### Steps

| # | Step | Command | Run by | Check after | Rollback |
|---|---|---|---|---|---|
| 1 | STEP | `COMMAND` | RUNNER | `CHECK` | `ROLLBACK_COMMAND` |

### Canary

Population: POPULATION
Control: CONTROL
Stages: STAGES

| Metric | Source | Abort threshold | Action |
|---|---|---|---|
| METRIC | SOURCE | THRESHOLD | ABORT_ACTION |

### Temporary scaffolding

| Piece | Location | Removal condition | Removing slice |
|---|---|---|---|
| PIECE | `PATH` | CONDITION | SLICE |

### Contract step

Trigger: TRIGGER
Slice: CONTRACT_SLICE
Tracked by: TRACKER
```

Replace the following:

- `OUTCOME`: the outcome from the ExecPlan title.
- `ROUTE`: `parallel change`, `strangler`, or `hard cut`, with one line on why.
- `ROLLBACK_EVIDENCE`: the date, the command run, and where its output is recorded, for example
  `2026-09-11, down migration on a copy of staging data, output in the ExecPlan Discoveries`.
- `STEP`, `COMMAND`, `RUNNER`, `CHECK`, `ROLLBACK_COMMAND`: one row per step, in order. `RUNNER`
  is `Human` for anything that leaves this machine (push, deploy, migration on a shared
  database, a hosted flag, an external call), and `Peer` or `Lead` only for local steps.
- `POPULATION`: who gets the change first, for example `5% of requests, internal accounts
  first`. When the product has no staged rollout, write `none`, delete the canary table, and
  put the smoke check after deploy in the Steps table instead.
- `CONTROL`: the same-size group running the old version at the same time.
- `STAGES`: each stage's share and minimum duration, for example `5% for 24 h, 25% for 24 h,
  100%`. Each duration covers at least one full metric window and the time a failure would take
  to show.
- `METRIC`, `SOURCE`, `THRESHOLD`, `ABORT_ACTION`: at most about a dozen user-visible signals
  the change could move, each with a threshold fixed now and the action when it trips, normally
  `stop, roll back, then investigate`.
- `PIECE`, `PATH`, `CONDITION`, `SLICE`: one row per temporary piece; each also carries a
  `TEMPORARY(SLUG)` comment at `PATH`.
- `TRIGGER`: when the contract step runs, for example `one release after the read switch` or
  `zero reads of the old column for 7 days`.
- `CONTRACT_SLICE`: the slice ID that removes the old form and the scaffolding.
- `TRACKER`: who keeps the trigger in view across sessions, usually `Human` for a date-based
  trigger.
