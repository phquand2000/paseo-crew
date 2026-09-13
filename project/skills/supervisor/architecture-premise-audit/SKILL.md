---
name: architecture-premise-audit
description: Audit a whole project for a possibly wrong system archetype by deriving expected product capabilities before trusting repository vocabulary. Use when the Human asks whether the whole project is built around the right system archetype, not for ordinary architecture review or one named design concern.
---

# Architecture premise audit

Determine whether the project is built around the right system archetype, not
merely whether its current modules are internally consistent. Audit read-only
unless the user separately requests changes.

## Boundaries

- Work at the whole-project or named broad-system boundary requested by the user.
- Derive the expected product model before treating repository terminology,
  architecture docs, tests, or benchmarks as authoritative.
- Treat passing proof as evidence about an implementation, not proof that the
  mechanism should exist.
- Complexity is a finding only when it lacks a required product need, owner,
  lifecycle, consumer, scaling contract, or failure contract.
- Do not turn a broad audit into implementation, issue creation, or a second
  review workflow.
- Ask only when one missing fact would reverse the verdict and cannot be bounded
  with an explicit assumption.

For realtime or multiplayer domains, build the expected atlas from established
domain mechanisms: prediction and reconciliation for the locally controlled
actor, authoritative snapshots with interpolation and interest management for
remote actors, sequenced latest-state delivery for state that newer values
replace, and durable identity with typed outcomes for exact commands. The domain
examples in the structural lenses named in step 4 show the level of detail to aim
for.

## Audit slice

Judge work by product responsibility rather than repository module. Each audit
slice should identify:

- job to be done and production consumer;
- authoritative owner, state, and lifecycle;
- inputs, outputs, and trust boundaries;
- scaling or adversarial variable;
- failure, overload, and backpressure behavior;
- reusable-platform versus application responsibility.

A slice may cross modules, and one module may contain several slices.

## Procedure

1. **Set the claim.** State the product category, requested boundary, expected
   outcome, material assumptions, and completion rule.
2. **Build the expected atlas.** From product needs and established domain
   mechanisms, list the responsibilities that should exist, likely owners,
   scaling variables, and work that must be bounded or isolated.
3. **Build the observed map.** Trace production entry points, authoritative
   state, durable effects, expensive operations, queues, schedulers, external
   outputs, deployment boundaries, and cited proof. Do not copy the repository's
   decomposition without testing it.
4. **Compare every slice.** Ask what demonstrated requirement forces each
   mechanism, whether cost follows useful work, whether normal and exceptional
   paths are reversed, and whether removing or relocating the mechanism loses
   an established requirement. Use the project's one catalog of structural
   misfits and avoidable costs,
   `.seatworks/skills/reviewer/reviewing-a-change/references/structural-lenses.md`,
   as search lenses rather than a checklist every design must satisfy.
5. **Deep-check serious candidates.** Trace real callers and consumers, name the
   exact amplification route, construct the cleaner counterfactual, identify
   machinery that disappears, give the strongest counterargument, and state
   evidence that would falsify the finding.
6. **Check coverage.** Stop only when every discovered ingress, authoritative
   state family, durable effect, expensive operation, and external output is
   represented in the coverage ledger or explicitly excluded by scope.

Do not report generic improvements. Classify supported candidates as architecture
defect, owner defect, implementation drift, justified divergence, quarantined
scaffold, or insufficient evidence.

## Delegating slices

A project too large to read yourself divides into slices, one or a few per
reader. Every reader comes from the read-only Reviewer profile. Its prompt is a
brief from `.seatworks/guides/BRIEF.md` with disposition Architect,
owned scope `none`, the claim, and the expected-atlas rows for its slices; ask
for observed-map rows and candidate findings with file and line evidence. Leave
the orchestration, the other readers' findings and your own suspicion out, so
each report stays an independent judgment. Run `git -C <repo> status --porcelain`
before and after, and archive each reader once its report is in.

## Verdict and output

Lead with one verdict:

- `KEEP_FOUNDATION`
- `REPAIR_FIRST`
- `REDIRECT_RECOMMENDED`
- `STOP_AND_REDIRECT`
- `INSUFFICIENT_EVIDENCE`

Then provide only the material sections needed to support it:

1. expected-versus-observed map;
2. compact coverage ledger and exclusions;
3. ranked findings with production evidence, hidden premise, tax, and
   amplification route;
4. counterfactual architecture and machinery removed or relocated;
5. counterargument and falsifier for each serious finding;
6. `STOP_OPTIMIZING` and `PROBABLY_JUSTIFIED` items;
7. prioritized decisions and realistic fitness scenarios.

Make the best evidence-supported judgment available. Expose assumptions, but do
not end with an unranked option menu or an interview questionnaire.

Save the report at `.seatworks/records/audits/<repo>-YYYY-MM-DD.md`, then take the
verdict, the top findings and the decisions it asks for to the Human, keeping
what you observed apart from what you infer. Once the Human has decided, relay it
to the Lead as an `OWNER DIRECTIVE:` whose outcome and constraints carry the
decision, with the findings it rests on quoted with file and line inside the
directive itself, so the Lead works from its own repository rather than from a
file it cannot read.

The rule that matters most: build the expected atlas from the product before you
read the repository's own account of itself.
