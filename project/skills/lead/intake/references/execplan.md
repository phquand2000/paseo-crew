# ExecPlan template

An ExecPlan is a short direction document for work that has to survive a restart, a compaction,
or a handoff, checked into the target repository at `docs/exec-plans/active/SLUG.md`, one file
per outcome. It records the outcome, the decisions, and the acceptance evidence, not the
implementation in prose: files, symbols, and control flow stay with the Peers who write them.

## Rules

A plan is good when each of these holds:

- Someone with only the plan and the working tree, none of the chat, can name the next step.
  Test it by rereading the plan as if you had just been started.
- Work is divided by outcomes or owner boundaries, not files, which go stale on the first
  discovery.
- Every acceptance claim names evidence that would fail if the claim were false: a command, a
  query, or an observation a person can make.
- Work that changes external state or isn't idempotent has a rollout, a rollback, and a
  recovery path from the change-rollout skill.
- Canonical owner documents (`AGENTS.md`, ADRs, contracts) are linked, not restated, so there
  is one place to update.
- Material product, architecture, cutover, and safety decisions are made in the plan or marked
  as reserved for the Human; none is left for an Engineer to make by accident.

Keep these out, since each pre-solves the Peer's work or turns the plan into a log nobody
rereads:

- exact symbols, pseudocode, private control flow, or a line-by-line edit sequence;
- completion defined as "edits made", a coverage percentage, or a report existing;
- a diary, an evidence archive, or a review transcript; put logs in files and link them.

When the direction changes, rewrite the Direction and Acceptance sections to the current
direction and add a Decision log line; git keeps the old text. Include Progress when the plan
has more than one slice, and Decision log and Discoveries only when their content has to
survive the current session; an empty section is ceremony.

Keep agent IDs and tool names out of the plan: Peers read the repository, and those details only
distract them. Label the agents instead (`plan: SLUG`, `task: S1`) and recover their IDs with
`list_agents`.

When the outcome is accepted, move durable decisions into their owners (an ADR, `AGENTS.md`, a
contract document) and delete the plan in the same commit; git keeps its history. If the
repository's `AGENTS.md` says to keep finished plans, follow that instead.

## Template

Copy this block to `docs/exec-plans/active/SLUG.md`:

```md
# OUTCOME_TITLE

## Outcome and constraints

Intake: LANE, because REASON
Outcome: OBSERVABLE_OUTCOME
Governing policy: POLICY_LINKS
Excluded: EXCLUDED_SCOPE
Reserved for the Human: HUMAN_DECISIONS

## Context and ownership

OWNERS_AND_BOUNDARIES

## Direction and work units

DIRECTION

| Slice | Outcome | Owned scope | Depends on | Decide-first |
|---|---|---|---|---|
| S1 | SLICE_OUTCOME | OWNED_GLOBS | none | DECIDE_FIRST_POINT or none |

Invariants: INVARIANTS

Failure modes and likely wrong turns: FAILURE_MODES

## Acceptance and recovery

| Claim | Evidence that would falsify it |
|---|---|
| CLAIM | `CHECK_COMMAND` or observation |

Rollout, rollback, and recovery: RECOVERY

## Progress

- S1: pending

## Decision log

- DATE: DECISION. Reason: REASON. Record: ADR_LINK or none

## Discoveries

- DATE: DISCOVERY. Evidence: EVIDENCE_PATH
```

Replace the following:

- `SLUG`: a short kebab-case name for the outcome, for example `export-csv`.
- `OUTCOME_TITLE`: the outcome as a title, for example `Users can export invoices as CSV`.
- `LANE` and `REASON`: the lane from the intake result and the gate or rubric answer that set it.
- `OBSERVABLE_OUTCOME`: what a user, operator, or caller can observe when the work is done.
- `POLICY_LINKS`: links to the rules that govern the change, such as the hard-cut policy in
  `AGENTS.md` or an ADR.
- `EXCLUDED_SCOPE`: what this outcome deliberately leaves out.
- `HUMAN_DECISIONS`: decisions the Human holds for this outcome, or `none`.
- `OWNERS_AND_BOUNDARIES`: the owning area, the interfaces and contracts it touches, and only
  the context needed to find your way.
- `DIRECTION`: the owner-clean route in a few sentences, and the alternatives it rejected.
- `SLICE_OUTCOME`, `OWNED_GLOBS`, `DECIDE_FIRST_POINT`: one row per slice, filled in by the
  decompose skill.
- `INVARIANTS`: what has to stay true throughout the work.
- `FAILURE_MODES`: how this work usually goes wrong, and the tempting wrong turns.
- `CLAIM` and `CHECK_COMMAND`: each acceptance claim and the evidence that would fail if it were
  false.
- `RECOVERY`: rollout steps, the proven rollback, and recovery for risky state, or
  `local revert` when `git revert` restores everything.
- `DATE`, `DECISION`, `ADR_LINK`, `DISCOVERY`, `EVIDENCE_PATH`: one line per decision or
  discovery that has to survive the session.

## Progress line formats

The decompose skill keeps Progress as the ledger: one line per event, newest last, so the state
survives a compaction:

```text
S1: pending
S1: briefed, Engineer, thinking medium, base 3f2a1c9
S1: fix round 2/5, open F003 F004
S1: reopened, REOPEN_REQUEST on the API layer, ruling: RULING
S1: accepted at 9b8e7d6
```
