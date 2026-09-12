---
name: design-options
description: "Draft two or three genuinely different designs for one problem, judge them against the boring standard route and the project's structural lenses, and recommend one. Use when a brief assigns the Architect disposition and asks for a route rather than a change."
---

# Design options

Use this skill to turn an Architect brief into the four artifacts its handoff carries: the problem slices, two or three designs, a comparison table, and one recommendation. Your instructions already set the Architect disposition's boundaries and the report shapes; this skill adds the method.

## Reconstruct the problem

Fill in one slice per responsibility the brief touches, working from the code rather than from the brief's vocabulary or the module names:

- Job and consumer: the outcome, and the production code that consumes it.
- Owner, state, and lifecycle: which module holds the authoritative state, how it is created, changed, and ended, and who cleans it up.
- Inputs, outputs, and trust boundaries: what enters, what leaves, and where untrusted data crosses.
- Scaling or adversarial variable: what grows (entities, rate, payload size, tenants), or who would abuse it and how.
- Failure and overload: what happens on an error, a timeout, a full queue, a partial failure, and a restart.

Done when every field has a `path:line`, or "not found; looked in PATHS". If a slice contradicts the brief's Decided / ruled out, that goes first in your report; it may call for a `REOPEN_REQUEST` rather than a design.

## Name the boring route

Describe how a mature system in this domain usually does the job: the framework-native mechanism, the standard library, or the well-known pattern. List the machinery it would remove, such as wrappers, parallel state, sync code, custom retries, or proofs that exist only to hold a custom route together. Any custom design has to earn its cost against this baseline.

## Design it more than once

Produce two or three designs whose interfaces differ in shape, not only in names. These constraints help pull them apart:

- the smallest interface: one to three entry points, with most behavior hidden;
- the interface that makes the most common caller trivial;
- ports and adapters, where a dependency crosses a real boundary.

The boring route can be one of them. For each design, give:

1. the interface: signatures plus invariants, ordering rules, and error modes;
2. a caller example of at most 15 lines;
3. what it hides behind the seam;
4. its dependencies and adapters;
5. the migration from the current code, and what it deletes.

Done when a reader could tell the designs apart from their interfaces alone.

## Judge the designs

Compare them in a table. Run each design past the project's catalog of structural misfits and avoidable costs, `.seatworks/skills/reviewer/reviewing-a-change/references/structural-lenses.md`, and add the two tests that only a design choice raises:

- Seams: one adapter makes a hypothetical seam, and two (production and test, or two real backends) make a real one. A port with one adapter is only indirection.
- Reversibility: which parts are hard to undo, such as a schema, a public API, or stored data.

## Recommend one

Give one recommendation, not a menu, and say why it wins on the tests above. Reversal conditions are specific observations, such as a second consumer appearing, load passing a named rate, or the dependency gaining cancellation. If the evidence can't support a recommendation, name the one fact that would decide it and where to find it.
