---
name: architecture-premise-audit
description: "Audits a whole project read-only for a wrong system archetype: derives the capabilities the product needs before trusting the repository's own vocabulary, compares the expected map with the observed one, checks coverage, and returns one verdict to the Human and, once decided, to the Lead. Use when the Human explicitly asks for a broad premise audit of a project, not for ordinary design review."
disable-model-invocation: true
---

# Architecture premise audit

Use this skill to check whether a project is built around the right kind of system, not only
whether its modules are consistent with one another. Every module can be well made while the
whole behaves like a different class of product than its goal calls for.

The skill produces an audit report at `records/audits/REPO-YYYY-MM-DD.md` in the kit, with one verdict
at the top. The verdict goes to the Human; once the Human decides, the decision goes to the Lead
as an `OWNER DIRECTIVE:`. Paths starting with `references/` are relative to this skill's
directory; every other path is relative to the kit.

## Boundaries

- The audit is read-only. You and any Peer you brief read the repository; nobody edits files,
  commits, or runs commands that write. Implementation, issues, and fixes come later, through the
  Lead.
- Work at the boundary the Human named: the whole project, or a broad system inside it.
- Derive what the product needs before you treat the repository's terminology, architecture docs,
  tests, or benchmarks as authoritative. A repository's names describe what it intended, not what
  the product requires.
- Treat passing tests as evidence that an implementation works, not that its mechanism should
  exist.
- Count complexity as a finding only when it lacks a product need, an owner, a lifecycle, a
  consumer, a scaling contract, or a failure contract.
- Ask the Human only when one missing fact would reverse the verdict and you can't bound it with
  a stated assumption.
- For realtime or multiplayer domains, build the expected capability map from established domain
  mechanisms: prediction and reconciliation for the locally controlled actor, authoritative
  snapshots with interpolation and interest management for remote actors, sequenced latest-state
  delivery for state that newer values replace, and durable identity with typed outcomes for exact
  commands. The domain examples in
  [references/structural-antipatterns.md](references/structural-antipatterns.md) show the level of
  detail to aim for.

## Audit slices

Divide the audit by product responsibility, not by repository module. A slice can cross modules,
and one module can hold several slices. For each slice, record:

- the job it does, and its production consumer;
- the authoritative owner, its state, and its lifecycle;
- its inputs, outputs, and trust boundaries;
- the variable that scales it, or that an adversary controls;
- its behavior on failure, overload, and backpressure;
- whether it is reusable platform or application-specific work.

## Procedure

1. **Set the claim.** Write the product category, the boundary, the expected outcome, the
   material assumptions, and the rule that ends the audit. **Done** when a reader could say what
   evidence would make the verdict wrong.
2. **Build the expected map.** From the product's needs and established mechanisms in its domain,
   list the responsibilities that should exist, their likely owners, their scaling variables, and
   the work that must be bounded or isolated. Build it before reading the code closely, so the
   repository's decomposition doesn't become your premise. **Done** when each responsibility has an
   owner and a scaling variable.
3. **Build the observed map.** Trace the production entry points, the authoritative state, the
   durable effects, the expensive operations, queues and schedulers, external outputs, deployment
   boundaries, and the proof the repository cites. **Done** when every entry point you found leads
   to a slice.
4. **Delegate slices if the project is too large to read yourself.** Give each read-only Peer one
   or a few slices. Create it with `create_agent` on `pi-peer-SLUG/<model>`, with
   `settings.thinkingOptionId: "high"` and no `settings.modeId`, in the project's workspace. Its
   `initialPrompt` is a brief with the fields under Delegation in the project's `.seatworks/LEAD.md`: disposition
   Architect, owned scope `none`, the claim, and the expected map rows for its slices. Ask for
   observed-map rows and candidate findings with file and line evidence. Leave out Paseo, seats,
   the Supervisor, and other Peers' findings, so that each report stays an independent judgment.
   Before and after, run `git -C REPO status --porcelain`, and archive each Peer once its handoff
   is in. **Done** when every slice has observed rows, and the repository is unchanged.
5. **Compare every slice.** For each mechanism, ask: which demonstrated requirement forces it?
   Does its cost follow useful work? Are the normal and exceptional paths reversed? Would removing
   or relocating it lose an established requirement? Use
   [references/structural-antipatterns.md](references/structural-antipatterns.md) as search lenses,
   not as a checklist. **Done** when every slice has a line of comparison.
6. **Deep-check the serious candidates.** For each one, trace the real callers and consumers, name
   the exact route by which its cost grows, sketch the cleaner counterfactual and the machinery
   that would disappear, give the strongest counterargument, and state the evidence that would
   falsify the finding. **Done** when each serious candidate has all five.
7. **Check coverage.** Every discovered entry point, authoritative state family, durable effect,
   expensive operation, and external output appears in the coverage ledger, or is excluded by
   scope with a reason. **Done** when nothing discovered is missing from the ledger.
8. **Classify and choose the verdict.** Classify each supported candidate as an architecture
   defect, owner defect, implementation drift, justified divergence, quarantined scaffold, or
   insufficient evidence; leave generic improvements out. Then choose one verdict:
   `KEEP_FOUNDATION`, `REPAIR_FIRST`, `REDIRECT_RECOMMENDED`, `STOP_AND_REDIRECT`, or
   `INSUFFICIENT_EVIDENCE`. **Done** when the verdict follows from the ranked findings.
9. **Write the report.** Lead with the verdict, then include only the sections that support it:
   the expected-versus-observed map; the coverage ledger and exclusions; ranked findings with
   production evidence, hidden premise, cost, and the route by which it grows; the counterfactual
   architecture and the machinery removed or relocated; the counterargument and falsifier for each
   serious finding; a `STOP_OPTIMIZING` list and a `PROBABLY_JUSTIFIED` list; and the prioritized
   decisions with realistic fitness scenarios. Give your best evidence-backed judgment rather than
   an unranked list of options. **Done** when the report is saved at `records/audits/REPO-YYYY-MM-DD.md`.
10. **Take the verdict to the Human.** Summarize the verdict, the top findings, and the decisions
    it asks for, keeping what you observed apart from what you infer. **Done** when the Human has
    decided.
11. **Relay the decision.** Send the Lead an `OWNER DIRECTIVE:` with the decision as an outcome and
    constraints, the findings it rests on, quoted with file and line, and the decisions still
    reserved for the Human. Include the findings in the directive itself, so that the Lead works
    from its own repository rather than a file in the kit. **Done** when `get_agent_activity` shows
    the Lead received it.

The rule that matters most: build the expected map from the product before you read the
repository's own account of itself.
