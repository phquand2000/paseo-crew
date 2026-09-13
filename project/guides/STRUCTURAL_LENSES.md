# Structural lenses

Read this when a change or a system adds machinery, cites a proof, or names an outcome. These are search lenses, not a checklist every design must pass: report only what the code you read supports, and exonerate what earns its cost.

## Causal mechanism

- **Wrong product category:** every module is strong, but the whole behaves like a different class of product than the goal, workload, scale, latency or cost calls for.
- **Imported completeness:** the design perfects a capability mature systems omit, approximate, precompute or move offline; the machinery proves it can exist, not that the product should pay for it.
- **Mechanism-free claim:** the name promises an outcome whose state or process doesn't exist: prediction without history, reconciliation without authoritative correction, lifecycle without an owning state machine, idempotency without identity, durability without a durable commit.
- **Homemade proxy:** a snap, timer, counter, retry or partial state copy presented as prediction, admission, reconciliation, backpressure or a transaction.
- **Information insufficiency:** the owner can't compute its output from what it receives, so callers guess the missing facts.
- **Wrong archetype:** exact work modeled as latest state, supersedable state journaled as exact work, current state stored as an event queue, or eventual snapshots enforcing a transition that needs total order.

## Weak foundation, bent code

- A wrapper, cache, fallback, retry or flag owns cancellation, invalidation, reset, failure or lifecycle that the dependency should own, or feature code keeps duplicate state to keep a dependency usable.
- A neighbor exposes too little identity, capacity, cancellation or terminal semantics, so callers reach into its internals.
- A raw escape hatch, test constructor or fabricated accepted state is the only complete route while the claimed production route is disconnected.
- Special cases, mode flags, lossy translations, collapsed error types or impossible state combinations exist to bridge incompatible owners; cleanup, retry or polling grows at callers because no owner exposes a terminal transition.
- A compatibility facade keeps an obsolete authority alive, or layers convert one fact without adding information, isolation or policy.
- A local workaround survives after the foundation could be repaired.

## Avoidable taxes

- **Latency and ordering:** head-of-line blocking, global ordering for independent work, reliable delivery for state newer values already replace.
- **Hot path:** per-tick allocation, repeated encoding, scans proportional to all entities, locks across independent owners; optimization that mainly recovers the abstraction's own overhead.
- **Buffering and failure:** unbounded queues, retries without terminal classification, fallbacks with different semantics, recovery that revives stale work.
- **Ownership:** shadow authority, cross-module lifecycle coupling, hidden recovery state, a blast radius larger than the product claim needs.
- **Migration and proof:** permanent dual paths, compatibility branches without an external constraint, evidence that never crosses the production route.

## Overengineering

A generic framework, plugin system or public abstraction before a second real use; a state machine advertising states production never produces; scaffolding and later-cleanup phases where one final-state change was available; services or queues replacing a direct owner call without a required boundary; perfect modeling where a constraint, authored table or bounded approximation meets the real outcome.

## Local-excellence trap

Passing tests, polished modules, strong benchmarks, repository precedent and a small diff don't establish that the whole fits its archetype. Ask whether the whole would still look strange with every detail excellent, which impressive parts exist only to support an unusual macro choice, and what machinery disappears under the boring route.

## Boundary and proof laundering

- A send, ACK, queue drain, connection state or log line treated as acceptance, authoritative mutation or a visible outcome.
- Downstream code parsing payloads, timing or logs to infer a fact the owner should publish.
- A mock, replica, source scan, compile or isolated green suite cited for a production chain it never reaches; components individually green with no production entry connecting them.

## Domain examples

The level of detail an expected mechanism needs, from realtime multiplayer:

- Client prediction needs local input application plus retained input or deterministic state for correction; one position step at submit is not prediction.
- Reconciliation needs authoritative state and a rule for replaying local prediction; a partial record fabricated from an ACK is not it.
- Server-authoritative click-to-move needs an owned navigation mechanism, not direct movement toward a target.
- Supersedable movement usually wants sequenced latest-state delivery; exact commands want durable identity and typed outcomes.
- Remote actors usually get authoritative snapshots with interpolation and interest management; full rollback for every remote entity needs a specific product reason.

## Exoneration

Return `BORING_STANDARD` or `JUSTIFIED_DEVIATION` when the mechanism has the information and owner it needs, the counterexample is handled, and any deviation serves a named constraint at proportionate cost. Custom is not wrong, and complexity the domain requires is not overengineering.
