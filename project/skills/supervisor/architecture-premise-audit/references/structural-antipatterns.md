# Structural misfits and avoidable costs

Search lenses, not a checklist every design must pass: report a pattern only when the audit's
evidence supports it.

## Causal mechanism

- **Wrong product category:** each module is sound, but the whole acts like a different class of
  product than the goal, workload, scale, latency, cost, or operating model calls for.
- **Imported realism or completeness:** the design perfects a capability that mature systems
  deliberately omit, constrain, approximate, precompute, or move offline. The machinery proves
  the capability can exist, not that this product should pay for it.
- **Claim without a mechanism:** the name promises an outcome whose state or causal process
  doesn't exist: prediction with no simulation or history; reconciliation with no authoritative
  correction; a lifecycle no state machine owns; idempotency with no identity binding; durability
  with no durable commit.
- **Homemade stand-in for a mature mechanism:** a snap, timer, counter, retry, straight-line
  interpolation, or partial copy of state presented as prediction, navigation, admission control,
  reconciliation, backpressure, or a transaction.
- **Missing information:** the owner can't compute its claimed output from the data it receives,
  so callers or downstream consumers guess the missing facts.
- **Wrong archetype:** exact transactional work modeled as latest state; rapidly superseded state
  journaled as exact work; keyed current state stored as an append-only queue; or eventually
  consistent snapshots enforcing a transition that needs total ordering.

## Accommodating a weak foundation

- A wrapper, adapter, cache, fallback, retry loop, ordering rule, or feature flag carries
  cancellation, invalidation, reset, synchronization, failure, or lifecycle semantics that belong
  to the dependency beneath it.
- Feature code keeps duplicate state or a parallel implementation only to keep a dependency
  usable.
- A neighboring module exposes too little identity, admission, capacity, cancellation, typed
  output, or terminal state, so callers reach into its internals or reconstruct the truth.
- A raw escape hatch, legacy path, test constructor, manual bootstrap, or faked accepted state is
  the only complete route, and the production route it stands in for isn't connected.
- A local workaround outlives the point where its foundation could be fixed, and becomes
  permanent architecture.

## Bent code

- Special cases, mode flags, lossy translations, synthetic states treated as real, collapsed
  error types, duplicated counters, or impossible state combinations bridge owners that don't
  fit together.
- One module must know another's private queue, timing, allocation, or reset behavior to stay
  correct.
- Cleanup, retry, polling, or timeout logic grows at the callers, because no owner exposes a
  complete terminal transition.
- A compatibility facade keeps an obsolete authority alive, or lets callers bypass the new
  contract.
- Several layers convert the same fact without adding information, isolation, ownership, or
  policy.
- An interface is nearly as complex as what it hides, or deleting a pass-through layer removes
  complexity without pushing a responsibility onto a real owner.
- A custom parallel pipeline fights an owner the framework already provides, and later code pays
  to keep the two in sync.

## Avoidable costs

- **Latency and ordering:** head-of-line blocking, global ordering of independent work, extra
  round trips, synchronous coordination, or reliable delivery for state whose older values are
  already obsolete.
- **Bandwidth and amplification:** duplicate carriers, catch-up bursts, redundant snapshots, full
  state where bounded deltas would do, or per-client output that could safely be shared.
- **Hot-path cost:** allocation on every tick, repeated encoding and decoding, avoidable copies,
  scans over every entity, locks across independent owners, or expensive work at the wrong
  frequency. Performance work that mostly recovers an abstraction's overhead is itself evidence
  of the cost.
- **Buffering and failure:** unbounded queues, retries with no terminal classification, overflow
  that kills the session, a fallback with different semantics, or recovery that revives stale
  work.
- **Ownership and operations:** shadow authority, lifecycles coupled across modules, extra
  processes or deployments, hidden recovery state, partial failures that are hard to see, or a
  larger blast radius than the product claim needs.
- **Migration and proof:** permanent dual paths, compatibility branches with no external
  constraint behind them, tests that must duplicate the implementation, evidence that never
  crosses the production route, or validation made expensive by an abstraction.
- **Maintenance load:** generic vocabulary that hides domain rules, many impossible states,
  configuration combinations with no product meaning, or an extension surface larger than any
  real use.

## Overengineering

- A generic framework, plugin system, compatibility layer, or public abstraction exists before a
  second real use case needs it.
- A full state machine or schema advertises states the production runtime can't produce or
  consume.
- Temporary scaffolding, parallel owners, or "clean up later" phases are planned where one
  coherent final change is available.
- Several services, queues, or coordination layers replace a direct call to an owner without
  adding a needed isolation or scaling boundary.
- Exhaustive future-proofing, speculative failure taxonomies, or configurable policies obscure
  the one mechanism the product uses today.
- The design models a capability exactly where a hard limit, an authored table, a bounded
  approximation, precomputation, or leaving it out of scope would meet the real outcome.

## The local-excellence trap

Passing tests, polished modules, internal coherence, strong benchmarks, realism, precedent in the
repository, and a small diff don't show that the archetype fits; precedent may be accumulated
drift. Ask whether the whole would still look strange if every local detail were excellent, which
impressive parts exist only to support an unusual large-scale choice, and what machinery would
disappear on the plain, established route.

## Laundered boundaries and proof

- A transport send, an ACK, a drained queue, a connection state, adjacent timestamps, or a log
  line is treated as application acceptance, an authoritative change, a completed command, or an
  outcome the user sees.
- Downstream code parses payloads, timings, logs, or counters to infer a typed fact the owner
  should publish directly.
- A mock, replica, fixture, source scan, successful compile, or isolated green suite is cited for
  a production causal chain it never reaches.
- Components pass individually, but no production entry point connects them, or the real output
  bypasses the named authority.

## Domain examples: realtime and multiplayer

- Client-side prediction needs the local input applied at once, plus the retained input or
  deterministic state required to correct or re-simulate. Moving one step at submit time is a
  different mechanism.
- Reconciliation needs authoritative state or progress, and a rule for correcting or replaying
  the local prediction. A partial authoritative record built from an ACK is not equivalent.
- Server-authoritative click-to-move needs an owned navigation mechanism: a validated destination
  plus path or corridor facts, or another explicit authoritative route. Moving straight toward a
  target doesn't become navigation by being called that.
- High-frequency movement that newer values replace usually suits sequenced latest-state
  delivery; exact commands usually need durable identity and typed outcomes. Departing from this
  can be valid, but name its ordering, latency, bandwidth, and failure costs.
- Large multiplayer worlds usually predict the locally controlled actor, and show remote actors
  through authoritative snapshots with interpolation or extrapolation plus interest management.
  Full rollback, or exact journals for every remote entity, needs a specific product reason.

## Exoneration

Return `BORING_STANDARD` or `JUSTIFIED_DEVIATION` when the production mechanism has the
information and the owner it needs, the counterexample is handled, and any deviation serves a
named constraint at a proportionate cost. Custom doesn't mean wrong, and visible complexity isn't
overengineering when the domain itself demands it.
