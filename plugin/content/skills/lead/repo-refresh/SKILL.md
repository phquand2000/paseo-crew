---
name: repo-refresh
description: "Refreshes one named repository around current production truth: audits documentation, plans, issues, tests, proof machinery, scripts and generated debris, classifies each suspect, and has the stale ones merged or deleted through tasks. Use when documentation, plans, tests or scripts have drifted from what production does, or when the owner asks for a refresh. Not for routine housekeeping on one change, or for redesigning working architecture."
---

# Repository refresh

You refresh the named repository around what is true in production now. It is a repository-wide cleanup, not routine housekeeping and not a license to redesign working architecture. Read [references/refresh-standard.md](references/refresh-standard.md) before you audit.

## Mode

Take it from the directive's wording, or audit when you start one yourself:

- **audit**, the default for a bare request: inspect and report.
- **apply**, when the directive says refresh, clean, fix, remove or consolidate: audit, get the cut made, and verify. The audit is yours; every change goes through `add_tasks`, one task per coherent group of deletions, with the audit rows as its goal and context, the paths as its hints and step 5 as its acceptance. Verify from the handback's commit, not its summary, before you `accept`.
- **verify:** check an earlier refresh without widening its scope.

An age threshold marks suspects, never deletion targets. Leave unrelated and pre-existing changes where they are, and don't change production behavior to simplify the cleanup; `ask` about a production defect separately. Git is the history: no archives, backup folders or compatibility copies inside the repository.

## Procedure

1. **Establish the current contract:** product entry points and owners, canonical architecture, product and process documents, active plans, test and proof owners, generated files and their producers, and the commands that define acceptance. Check filenames, folder names, issue states and "authoritative" labels against current code and consumers before you trust them.
2. **Inventory the suspects:** duplicate docs, indexes and archives; terminal, orphaned or superseded plans and issues; tests and proof machinery; scripts, fixtures, snapshots, reports and tracked build output; dead links, commands and owner names. For each, record its owner, production consumer, unique current information, destination, and what deleting it would break.
3. **Classify before changing anything**, with only these: `KEEP` (current, uniquely owned truth or proportionate proof), `MERGE` (unique truth belongs in another owner), `REWRITE` (the owner is valid but history obscures it), `DEMOTE` (useful only as a non-gating diagnostic), `DELETE` (stale, duplicated, generated, dead proof, or history Git owns), `BLOCKED` (deletion crosses an unresolved product, compatibility, legal or operational decision). Age, size and ugliness are signals, not dispositions. A row reads like: `docs/deploy.md` — `DELETE` after a `MERGE`: it documents a deploy script removed last year and has no consumer, but its release-tag rule is still true, so that rule moves into `RELEASING.md` in the same change.
4. **Cut coherently.** Merge unique current truth into its owner, update live references, and delete the superseded sources in the same change, in dependency order, so the repository never holds two sources of truth. Remove proof and tests that fail the standard's retained-proof test, dead scripts, unowned fixtures and reproducible reports.
5. **Verify proportionately:** links and references resolve, each contract has one owner, retained plan and tracker schemas are valid, generated files match their producers, changed tooling passes its tests, and the smallest acceptance command whose contract changed passes. Add no new proof framework to prove the cleanup.

## Ends in

A report, kept with `note` in repo-refresh as `YYYY-MM-DD.md`, of the before and after inventory; what was merged, deleted, rewritten and deliberately kept; the proof machinery removed or demoted and why; the validation actually run; and blocked decisions with remaining debt, summarized to the owner in `report`. It isn't complete while live references point at removed material, two documents own one contract, finished plans still read as active, or a mandatory proof route has no named risk and consumer.
