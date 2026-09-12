# Execution Plans

An ExecPlan is a concise, checked-in direction document for work that must survive restart or
handoff. It preserves decisions and acceptance; it is not implementation written in prose.

## When Required

Use `.seatworks/guides/FEATURE_INTAKE.md`. A task or issue is enough for tiny and bounded normal work.
Create an active ExecPlan for material risk, irreversibility, uncertainty, broad owner/contract
impact, external side effects, or restart/handoff.

Active plans live in `docs/exec-plans/active/`.

## Required Content

```md
# [Outcome-oriented title]

## Outcome And Constraints
[Observable outcome, governing policy, and excluded scope.]

## Context And Ownership
[Owning area, affected boundaries/contracts, and only the context needed to navigate.]

## Direction And Work Units
[Owner-clean direction, coherent outcome slices, invariants, failure modes, and likely wrong turns.]

## Acceptance And Recovery
[Claims, evidence capable of falsifying them, rollout/rollback, and recovery for risky state.]
```

Add `Progress`, `Decision Log`, or `Discoveries` only when their information must survive the
current session. Empty sections are ceremony.

## Rules

An ExecPlan must:

- be restartable from the plan and working tree without prior chat;
- preserve settled architecture, single-contract hard-cut, reset/rebuild, safety, and data rules;
- divide work by outcomes or owner boundaries rather than files;
- state observable acceptance and claim-shaped evidence;
- define rollout, rollback, and recovery when work is externally stateful or non-idempotent;
- link canonical owner docs instead of restating them.

It must not:

- prescribe exact symbols, pseudocode, private control flow, or a line-by-line edit sequence;
- leave material product, architecture, contract-cutover, or safety decisions to the implementer;
- define completion as internal edits, coverage percentage, report existence, or ceremony;
- become a diary, evidence archive, or review transcript.

When direction changes, update the current direction and acceptance. Git owns ordinary history.
