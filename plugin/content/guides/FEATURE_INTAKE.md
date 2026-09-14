# Feature intake

Pick the smallest lane that honestly covers the work's blast radius, reversibility, uncertainty and
proof, and state the result before you brief anyone.

| Lane | When | What it takes |
|---|---|---|
| Tiny | local, reversible, directly verifiable | patch it and keep affected docs true |
| Normal | one owner and contract, local rollback, an honest way to validate | acceptance in the task; no repository artifact unless state must outlive it |
| High-risk | a hard gate below, irreversible state, broad uncertainty, weak proof, or a restart or handoff | an ExecPlan per `PLANS.md` before implementation |

## Hard gates

Work is high-risk when it materially changes:

- authentication, authorization, privacy, audit or secret handling;
- data loss, irreversible migration, deletion, retention, replay or recovery;
- money, credentials, user-visible delivery, or non-idempotent external side effects;
- a current contract replaced in coordination, or a development-state reset;
- runtime owner boundaries, concurrency, lifecycle or ordering;
- proof that protects a security, data, contract or external-system claim;
- compatibility (a fallback, shim, dual read/write, legacy parser or version branch) unless
  `AGENTS.md` allows it, because such a layer outlives whoever asked for it: it is the Human's
  call and needs a recorded removal condition.

A label alone does not set the lane; material impact does.

## Design gate

Before implementation, settle every choice that changes ownership, public behavior, safety,
compatibility or data, or is otherwise expensive to reverse, as an ADR per
`ADR.md`, without prescribing files, symbols or control flow. Ask the Human when
the requested behavior, the destructive scope or a weakened proof stays ambiguous.

## Intake result

State these five lines in your reply; a plan carries its lane and reason in its header:

```text
Lane: <tiny | normal | high-risk>
Reason: <the material reason>
Owners: <the canonical docs and contracts>
Plan: <the active plan's path, or none>
Validation: <the evidence that would show the claim>
```
