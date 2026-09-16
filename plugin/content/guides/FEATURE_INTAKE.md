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

## Sizing for agents

The work is done by agents, not a human team over months. One strong agent finishes most features
and foundation changes in one sitting, so an outcome is one lane and a lane is usually one task.

- Split only for a reason you can name: parts whose write sets don't overlap and can run in parallel,
  a mechanical fan-out too large for one sitting, separately accepted deliverables, or shipped
  production state that needs a staged change.
- Don't split by layer, to show progress, or into phases that keep a half-built state compiling.
  Two lanes that write the same contract, schema or files are one lane, or the contract is settled in
  one lane before the others open.
- Intermediate states inside a lane may be red; the gate runs on the whole lane.
- A compatibility layer is legitimate only for a named shipped consumer: a published API, persisted
  production data, an independently deployed service or client. Before such a consumer exists a
  break costs one coordinated change, and after one exists it costs whoever depends on you, on their
  schedule, which is why the line sits at shipping rather than at difficulty. Record the consumer and
  when the layer goes. Everything else changes in place, callers and tests included.
