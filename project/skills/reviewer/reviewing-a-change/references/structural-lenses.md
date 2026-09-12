# Structural lenses

The one catalog of structural misfits and avoidable costs used across this project. These are search lenses, not a checklist every change or design must pass: report a lens only when the code you read supports it, in the finding shape the skill that sent you here defines.

Contents:

- Missing causal mechanism
- Accommodating a weak foundation
- Bent code shape
- Boundary and proof laundering
- Avoidable costs
- Overengineering
- The local-excellence trap
- Domain examples: realtime and multiplayer
- When the structure is fine

## Missing causal mechanism

A name or claim promises an outcome that no state and no owner produce. Look for:

- a name that promises an outcome (reconcile, retry, idempotent, exactly-once, predict, in sync, durable) with no state, identity binding, authoritative correction, or commit that makes it true;
- a mechanism of the wrong kind for the job: polling for an event the owner could publish, a lock around data that has one writer, or a snap, timer, counter, straight-line interpolation, or partial copy of state presented as prediction, navigation, admission control, reconciliation, backpressure, or a transaction;
- an owner that can't compute its claimed output from the data it receives, so callers guess the missing facts;
- the wrong archetype: exact transactional work modeled as latest state; rapidly superseded state journaled as exact work; keyed current state stored as an append-only queue; eventually consistent snapshots enforcing a transition that needs total ordering;
- the wrong product category: each module is sound, but the whole acts like a different class of product than the goal, workload, scale, latency, cost, or operating model calls for;
- imported completeness: a capability perfected that mature systems in this domain deliberately omit, constrain, approximate, precompute, or move offline. The machinery proves the capability can exist, not that this product should pay for it.

Ask: which state, held by which owner, makes the promised outcome true, and does the standard route in this domain already provide it?

## Accommodating a weak foundation

The code works around a dependency instead of getting it fixed. Look for:

- a wrapper, adapter, cache, fallback, retry loop, ordering rule, or flag that carries cancellation, invalidation, reset, synchronization, failure, or lifecycle behavior belonging to the dependency beneath it;
- feature code keeping duplicate state, or a parallel implementation, only to keep a dependency usable;
- callers reaching into a neighbor's internals, or reconstructing its truth, because it exposes too little identity, admission, capacity, cancellation, typed output, or terminal state;
- a raw escape hatch, legacy path, test constructor, manual bootstrap, or hand-built accepted state that is the only complete route, while the production route it stands in for isn't connected;
- a local workaround kept past the point where its foundation could be fixed, turning into permanent structure.

Ask: if the dependency did its job, which lines would disappear? The fix is often a request to the dependency's owner, with the workaround recorded as temporary with a removal condition.

## Bent code shape

Code bends to bridge owners that don't fit together. Look for:

- repeated special cases, mode flags, lossy translations, synthetic states treated as real facts, a collapsed error taxonomy, duplicated counters, or state combinations that shouldn't be possible;
- one module that must know another's private queue, timing, allocation, or reset behavior to stay correct;
- cleanup, retry, polling, or timeout logic growing at the callers because no owner exposes a complete terminal transition;
- a compatibility facade that keeps an obsolete authority alive or lets callers bypass the new contract;
- several layers converting the same fact without adding information, isolation, ownership, or policy;
- an interface nearly as complex as what it hides;
- a custom pipeline beside a framework-native one, so later code pays to keep the two in sync.

Ask: delete the layer in your head. If the complexity vanishes, it was pass-through; if it reappears across the callers, it earns its place.

## Boundary and proof laundering

Something is treated as a stronger fact than it is. Look for:

- a send, acknowledgement, queue drain, connection state, timestamp, or log line treated as acceptance, an authoritative change, a completed command, or an outcome the user sees;
- downstream code parsing payloads, timing, logs, or counters to rebuild a typed result the owner should publish directly;
- a mock, replica, fixture, source scan, successful compile, or isolated green suite cited for a production chain it never runs;
- components that are each green while no production entry point connects them, or real output that bypasses the named authority.

Ask: which production entry point produces this outcome, and which proof actually runs through it? A proof that never reaches the production route is weak proof, and rates no lower than a mid-severity finding.

## Avoidable costs

Cost that follows the structure rather than the useful work. Look for:

- **Hot path:** allocation per item or per tick, repeated encoding and decoding, avoidable copies, a scan proportional to the total size inside a loop, one query or call per item where one batched call would do, or expensive work at the wrong frequency;
- **Latency and ordering:** head-of-line blocking, global ordering imposed on independent work, extra round trips, locks held across independent owners, synchronous coordination, or reliable delivery for state whose older values are already obsolete;
- **Bandwidth and amplification:** duplicate carriers, catch-up bursts, redundant snapshots, full state where bounded deltas would do, or per-client output that could safely be shared;
- **Buffering and failure:** unbounded queues or buffers, retries with no terminal classification, overflow that kills the session, a fallback whose meaning differs from the main path, or recovery that revives stale work;
- **Ownership and operations:** shadow authority, lifecycles coupled across modules, extra processes or deployments, hidden recovery state, partial failures that are hard to see, or a larger blast radius than the product claim needs;
- **Migration and proof:** permanent dual paths, compatibility branches with no external constraint behind them, tests that must duplicate the implementation, or validation made expensive by an abstraction;
- **Maintenance load:** generic vocabulary that hides domain rules, many impossible states, configuration combinations with no product meaning, or an extension surface larger than any real use.

Performance work that mainly wins back overhead an abstraction introduced is itself the finding. Ask: what does this cost per unit of useful work, and how does it grow with the scaling variable? Cite the loop or call site and the variable it grows with.

## Overengineering

- A generic framework, plugin system, compatibility layer, or public abstraction exists before a second real use case needs it.
- A full state machine or schema advertises states the production runtime can't produce or consume.
- Temporary scaffolding, parallel owners, or "clean up later" phases are planned where one coherent final change is available.
- Several services, queues, or coordination layers replace a direct call to an owner without adding a needed isolation or scaling boundary.
- Exhaustive future-proofing, speculative failure taxonomies, or configurable policies obscure the one mechanism the product uses today.
- A capability is modeled exactly where a hard limit, an authored table, a bounded approximation, precomputation, or leaving it out of scope would meet the real outcome.

## The local-excellence trap

Passing tests, polished modules, internal coherence, strong benchmarks, realism, precedent in the repository, and a small diff don't show that the shape fits; precedent may be accumulated drift. Ask whether the whole would still look strange if every local detail were excellent, which impressive parts exist only to support an unusual large-scale choice, and what machinery would disappear on the plain, established route.

## Domain examples: realtime and multiplayer

The level of detail to aim for when you build the expected map for a domain:

- Client-side prediction needs the local input applied at once, plus the retained input or deterministic state required to correct or re-simulate. Moving one step at submit time is a different mechanism.
- Reconciliation needs authoritative state or progress, and a rule for correcting or replaying the local prediction. A partial authoritative record built from an acknowledgement is not equivalent.
- Server-authoritative click-to-move needs an owned navigation mechanism: a validated destination plus path or corridor facts, or another explicit authoritative route. Moving straight toward a target doesn't become navigation by being called that.
- High-frequency movement that newer values replace usually suits sequenced latest-state delivery; exact commands usually need durable identity and typed outcomes. Departing from this can be valid, but name its ordering, latency, bandwidth, and failure costs.
- Large multiplayer worlds usually predict the locally controlled actor and show remote actors through authoritative snapshots with interpolation or extrapolation plus interest management. Full rollback, or exact journals for every remote entity, needs a specific product reason.

## When the structure is fine

Report no structural finding, and list the mechanism as the plain standard or a justified divergence, when the production mechanism has the information and the owner it needs, the counterexample is handled, and any departure from the usual route serves a named constraint at a proportionate cost. Custom code isn't wrong for being custom, and complexity the domain requires isn't overengineering.
