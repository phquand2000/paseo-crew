# Structural lenses

Use these lenses to look for structural problems in a change. They are questions to ask, not a checklist every change has to pass. Report a lens only when the code you read supports it, using the finding block from `SKILL.md`.

## Weak foundation accommodation

The change works around a dependency instead of getting the dependency fixed. Look for:

- a wrapper, adapter, cache, fallback, retry loop, ordering rule, or flag that takes over cancellation, invalidation, reset, synchronization, failure, or lifecycle behavior that the dependency should own;
- feature code keeping duplicate state, or a parallel implementation, only to keep a dependency usable;
- callers reaching into a neighbor's internals because it doesn't expose identity, capacity, cancellation, typed output, or a terminal state;
- a raw escape hatch, legacy path, test constructor, or hand-built accepted state that is the only complete route, while the claimed production route is disconnected;
- a local workaround kept after the foundation could be fixed, so the workaround turns into permanent structure.

Ask: if the dependency did its job correctly, which lines of the change would disappear? The fix is often a request to the dependency's owner, with the workaround recorded as temporary and a condition for removing it.

## Bent code shape

Code bends to bridge owners that don't fit together. Look for:

- repeated special cases, mode flags, lossy translations, synthetic states treated as real facts, a collapsed error taxonomy, duplicated counters, or combinations of state that shouldn't be possible;
- one module that has to know another module's private queue, timing, allocation, or reset behavior to stay correct;
- cleanup, retry, polling, or timeout logic growing at the callers because no owner exposes a complete terminal transition;
- a compatibility facade that keeps an obsolete authority alive or lets callers bypass the new contract;
- several layers converting the same fact without adding information, isolation, ownership, or policy;
- an interface nearly as complex as the implementation behind it;
- a custom pipeline running alongside a framework-native one, so later code pays to keep the two in sync.

Ask: delete the layer in your head. If the complexity vanishes, the layer was pass-through; if it reappears across the callers, the layer was earning its place.

## Boundary and proof laundering

Something is treated as a stronger fact than it is. Look for:

- a send, acknowledgement, queue drain, connection state, timestamp, or log line treated as acceptance, a committed change, a completed command, or an outcome the user sees;
- downstream code parsing payloads, timing, logs, or counters to rebuild a typed result that the owner should publish directly;
- a mock, replica, fixture, source scan, successful compile, or isolated green suite cited for a production chain it never runs;
- components that are each green while no production entry point connects them, or real output that bypasses the owner the brief names.

Ask: which production entry point produces this outcome, and which proof actually runs through it? A proof that never reaches the production route is weak proof; report it as at least P2.

## Avoidable hot-path taxes

The change adds cost that follows the structure rather than the useful work. Look for:

- allocation per item or per tick, repeated encoding and decoding, avoidable copies, or a scan proportional to the total size inside a loop;
- one query or call per item where one batched call would do;
- locks held across independent owners, global ordering imposed on independent work, extra round trips, or synchronous coordination;
- unbounded queues or buffers, retries without a terminal outcome, or a fallback whose meaning differs from the main path;
- performance work that mainly wins back overhead an abstraction introduced; that overhead is itself the finding.

Ask: what does this cost per unit of useful work, and how does that grow with the scaling variable? Cite the loop or call site, and the variable it grows with.

## When the structure is fine

Report no structural finding when the production mechanism has the information and the owner it needs, the counterexample is handled, and any departure from the usual route serves a named constraint at a proportionate cost. Custom code isn't wrong because it is custom, and complexity the domain requires isn't overengineering.
