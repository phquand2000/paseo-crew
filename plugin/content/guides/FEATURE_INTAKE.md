# Feature intake

Pick the smallest lane that honestly covers the work's blast radius, reversibility, uncertainty and
proof, and decide it before any work starts.

| Size | When | What it takes |
|---|---|---|
| Tiny | local, reversible, directly verifiable | no lane: one session patches it |
| Normal | one owner and contract, local rollback, an honest way to validate | a lane whose acceptance is checkable; no repository artifact |
| High-risk | a hard gate below, irreversible state, broad uncertainty, or weak proof | a lane whose Lead writes a plan per `PLANS.md` before any task starts |

## Hard gates

Work is high-risk when it materially changes:

- authentication, authorization, privacy, audit or secret handling;
- data loss, irreversible migration, deletion, retention, replay or recovery;
- money, credentials, user-visible delivery, or non-idempotent external side effects;
- a current contract replaced in coordination, or a development-state reset;
- runtime owner boundaries, concurrency, lifecycle or ordering;
- proof that protects a security, data, contract or external-system claim;
- compatibility (a fallback, shim, dual read/write, legacy parser or version branch) unless
  `AGENTS.md` allows it, because such a layer outlives whoever asked for it. That is the Human's
  call and needs a recorded removal condition.

A label alone does not set the size; material impact does.

## Design gate

Settle every choice that changes ownership, public behavior, safety, compatibility or data, or is
otherwise expensive to reverse, before tasks that depend on it start. Record it in the lane's plan
with the options weighed and the reason, without prescribing files, symbols or control flow. The
Human decides only when the behavior users see, the destructive scope or a weakened proof stays
ambiguous.

## Parallel lanes

Lanes run side by side only when they don't change the same code or contract. When two outcomes
share a contract, settle the contract first (one lane), then open the dependent lanes.
