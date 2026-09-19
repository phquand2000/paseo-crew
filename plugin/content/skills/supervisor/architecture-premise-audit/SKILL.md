---
name: architecture-premise-audit
description: "Audits whether a whole project is built around the right kind of system, by deriving the capabilities its product needs before trusting the repository's own vocabulary, and returns one verdict with ranked, falsifiable findings. Use when the Human asks, or the evidence suggests, that the project may be the wrong kind of system. Not for reviewing a change or one named design concern."
---

# Architecture premise audit

The rule that matters most: build the expected atlas from the product before you read the repository's account of itself.

You judge whether the project is built around the right system archetype, not whether its modules are internally consistent. It answers whether the shape is right, not where the defects are: what breaks a system in production is usually local and dull, so an outcome that needs bugs found wants a lane and a review instead. The audit reads; it doesn't implement, open issues, or become a second review.

- Build the expected model from the product before you treat repository terms, architecture docs, tests or benchmarks as authoritative.
- Passing proof is evidence about an implementation, not proof the mechanism should exist.
- Complexity is a finding only when it lacks a product need, owner, lifecycle, consumer, scaling contract or failure contract. A candidate you can't falsify is noise, and an audit read as noise is set aside whole, so carry it as an open question instead of ranking it.
- Ask the Human only when one missing fact would reverse the verdict and no stated assumption can bound it.

## Procedure

1. **Set the claim:** product category, boundary, expected outcome, assumptions, and when you are done.
2. **Build the expected atlas** from product needs and established domain mechanisms: the responsibilities that should exist, their likely owners, scaling variables, and work that must be bounded or isolated. Slice by product responsibility, not by module: each slice names its job and consumer, its authoritative owner, state and lifecycle, its inputs, outputs and trust boundaries, its scaling or adversarial variable, and its failure and backpressure behavior.
3. **Build the observed map:** production entry points, authoritative state, durable effects, expensive operations, queues and schedulers, external outputs, deployment boundaries and cited proof, without copying the repository's decomposition untested.
4. **Compare every slice.** What demonstrated requirement forces each mechanism? Does cost follow useful work? Are the normal and exceptional paths reversed? What is lost by removing or moving it? Use `$SEATWORKS_KIT/content/guides/STRUCTURAL_LENSES.md` as search lenses; its domain examples show the detail an expected mechanism needs.
5. **Deep-check serious candidates:** trace real callers, name the amplification route, build the cleaner counterfactual and the machinery it removes, and give the strongest counterargument and the evidence that would falsify the finding.
6. **Stop on coverage,** when every ingress, state family, durable effect, expensive operation and external output is in the ledger or excluded by scope.

Classify each supported candidate as architecture defect, owner defect, implementation drift, justified divergence, quarantined scaffold, or insufficient evidence; generic improvements aren't findings.

You read the repository yourself for the atlas and the comparison. A project too large to map alone gets a read-only lane: `open_lane` with the claim and the atlas rows in its outcome, "observed-map rows and candidates for these slices" in acceptance, and any code change out of scope; then `message` its Lead to use one sealed reviewer per slice or few slices, each started with `start_review` whose focus asks for observed-map rows and candidates with file and line evidence. Leave out your own suspicion so each reader stays an independent judgment. A report is fifteen lines, so tell the Lead to put the full result in `$SEATWORKS_STATE/plans/` and name the file in its report; read that, then `close_lane` with land false.

## Ends in

A report at `$SEATWORKS_STATE/architecture-premise-audit/YYYY-MM-DD.md` that leads with one verdict, `KEEP_FOUNDATION`, `REPAIR_FIRST`, `REDIRECT_RECOMMENDED`, `STOP_AND_REDIRECT` or `INSUFFICIENT_EVIDENCE`, followed only by the sections that support it: expected versus observed map, coverage ledger and exclusions, ranked findings with evidence, hidden premise and amplification route, the counterfactual, counterarguments and falsifiers, `STOP_OPTIMIZING` and `PROBABLY_JUSTIFIED` items, and the decisions it asks for. Make the best judgment the evidence supports; don't end with an unranked option menu.

Take the verdict, top findings and decisions to the Human, observation kept apart from inference. The resulting work reaches a Lead as a `message` or a new lane's directive that quotes the findings it rests on with file and line, since the Lead doesn't read your report.
