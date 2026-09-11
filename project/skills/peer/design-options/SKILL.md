---
name: design-options
description: "Read-only design: reconstruct the real problem, draft two or three different designs, judge them against the boring standard route, recommend one with its counterargument and reversal conditions. Use when a brief assigns the Architect disposition."
---

# Design options

Use this skill, read-only, to turn an Architect brief into a recommendation the Lead can rule on: the real problem, two or three genuinely different designs, and one choice with the conditions that would reverse it. Stay inside the brief's scope, and write nothing to the repository.

## Reconstruct the problem

1. Fill in one slice for each responsibility the brief touches, working from the code rather than the brief's vocabulary or the module names:
   - Job and consumer: the outcome, and the production code that consumes it (`path:line`).
   - Owner, state, and lifecycle: which module holds the authoritative state, how that state is created, changed, and ended, and who cleans it up.
   - Inputs, outputs, and trust boundaries: what enters, what leaves, and where untrusted data crosses.
   - Scaling or adversarial variable: what grows (entities, rate, payload size, tenants), or who would abuse it and how.
   - Failure and overload: what happens on an error, a timeout, a full queue, a partial failure, and a restart.

   Done when every field has a `path:line`, or "not found; looked in PATHS".
2. Compare the slices with the brief's Decided / ruled out. If the code contradicts a premise (the named module doesn't own the state, or the consumer doesn't exist), put that first in your report; it may call for a `REOPEN_REQUEST` rather than a design.

## Name the boring route

Describe how a mature system in this domain usually does the job: the framework-native mechanism, the standard library, or the well-known pattern. List the machinery it would remove, such as wrappers, parallel state, sync code, custom retries, or proofs that exist only to hold a custom route together. Any custom design has to earn its cost against this baseline.

## Design it more than once

Produce two or three designs whose interfaces differ in shape, not only in names. These constraints help pull them apart:

- the smallest interface: one to three entry points, with most behavior hidden;
- the interface that makes the most common caller trivial;
- ports and adapters, where a dependency crosses a real boundary.

The boring route can be one of the designs. For each design, give:

1. the interface: signatures plus invariants, ordering rules, and error modes;
2. a caller example of at most 15 lines;
3. what it hides behind the seam;
4. its dependencies and adapters;
5. the migration from the current code, and what it deletes.

Done when a reader could tell the designs apart from their interfaces alone.

## Judge the designs

Compare the designs in a table on these tests:

- Depth: the interface should be much smaller than what it hides; one nearly as complex as its implementation is a smell.
- Deletion: delete the module in your head. If the complexity vanishes, it was pass-through; if it reappears in several callers, it earns its place.
- Seams: one adapter makes a hypothetical seam, and two (production and test, or two real backends) make a real one. A port with one adapter is only indirection.
- Owner fit: each responsibility sits with the module that has the information to compute it, with no caller left guessing facts the owner didn't pass on.
- Accommodation: whether the design adds a wrapper, cache, retry, or flag that takes over a job a dependency should do.
- Taxes: extra round trips, copies or allocation on hot paths, ordering imposed on independent work, dual paths during a migration, and test cost.
- Reversibility: which parts are hard to undo, such as a schema, a public API, or stored data.

## Recommend one

Give one recommendation, not a menu, with:

- why it wins on the tests above;
- the strongest counterargument: the best case for the runner-up;
- reversal conditions: specific observations that would flip the choice, such as a second consumer appearing, load passing a named rate, or the dependency gaining cancellation;
- decisions that belong to someone else, such as a public API, a schema, or product scope, under Unknown / risk.

If the evidence can't support a recommendation, name the one fact that would decide it and where to find it.

## Final message

Give the problem slices, the boring route, the designs, the comparison table, and the recommendation. End with the handoff: omit Snapshot, list the files you read under Scope, and put the commands you ran, such as searches and test runs, under Verification.
