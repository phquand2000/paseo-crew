---
name: repo-refresh
description: "Refreshes one named repository around current production truth by removing stale documentation, plans, issues, tests, proof machinery, scripts, and generated debris. Use when the Human asks for a repository refresh."
---

# Repository refresh

Refresh the named repository around current production truth. This is a repository-wide cleanup, not routine housekeeping and not an excuse to redesign working production architecture. Read [references/refresh-standard.md](references/refresh-standard.md) before auditing or changing a repository.

## Mode

Take the mode from the Human's wording:

- `audit`, the default for a bare request: inspect and report.
- `apply`: audit, get the cleanup performed, and verify. Words such as `refresh`, `clean`, `fix`, `remove`, or `consolidate` ask for this mode. The audit and `docs/` are yours; the rest of the repository belongs to an Engineer. Each coherent group of deletions goes out as one brief from `.seatworks/guides/BRIEF.md`, with the audit rows as its objective, the paths as its owned scope, and step 5 as its acceptance. Verify from the returned SHA, not from the Peer's summary.
- `verify`: validate an earlier refresh without expanding its scope.

An age threshold identifies suspects, never automatic deletion targets. Without one from the Human, use repository evidence, current consumers, and ownership rather than inventing one.

## Boundaries

- Read the complete applicable instruction hierarchy before acting.
- Inspect the worktree first, and preserve unrelated and pre-existing changes.
- Repository law may add stricter constraints, but it never justifies keeping stale duplication, dead proof, or history disguised as current truth.
- Don't change production behavior merely to simplify cleanup. Report a production defect separately unless its repair was also authorized.
- Git is the history: no archives, backup directories, migration diaries, or compatibility copies inside the repository.

## Procedure

### 1. Establish the current contract

Identify:

- product entry points and production owners;
- canonical architecture, product, process, and operational documents;
- active plans and nonterminal work;
- test, benchmark, validator, gate, and artifact owners;
- generated files and their source-of-truth producers;
- repository commands that actually define acceptance.

Don't trust filenames, folder names, issue state, timestamps, or claims of "authoritative" without checking current code and consumers.

### 2. Inventory the repository

Build a compact ledger covering:

- governing docs, duplicate docs, indexes, archives, reviews, and postmortems;
- active, terminal, orphaned, and superseded plans or issues;
- tests and proof routes, including custom task-runner machinery;
- scripts, fixtures, snapshots, reports, generated outputs, and tracked build debris;
- dead paths, links, commands, owner names, and cross-references;
- unusually large or fragmented surfaces that hide one current contract.

For every suspect, identify its current owner, production consumer, unique current information, replacement destination, and deletion consequence.

### 3. Classify before changing

Use only these dispositions:

- `KEEP`: current, uniquely owned truth or proportionate proof.
- `MERGE`: unique current truth belongs in another canonical owner.
- `REWRITE`: the owner remains valid but history or duplication obscures it.
- `DEMOTE`: useful only as a non-gating diagnostic or closeout record.
- `DELETE`: stale, duplicated, generated debris, dead proof, or Git-owned history.
- `BLOCKED`: deletion would cross an unresolved product, compatibility, legal, or operational decision.

Age, size, ugliness, and low coverage are supporting signals, not dispositions.

### 4. Apply a coherent cut

In `apply` mode, the cut:

1. Merges unique current truth into its canonical owner.
2. Updates live references and instruction routing.
3. Deletes superseded sources in the same change.
4. Compacts terminal tracker records to identity, dependency fields, disposition, and concise durable closeout evidence.
5. Keeps only active plans, deleting completed execution diaries and review packets.
6. Removes or demotes proof that has no current risk, independent oracle, production consumer, or deletion sensitivity.
7. Removes tests that pin retired implementation detail or repository history without a current public, security, compatibility, or machine contract.
8. Removes dead scripts, unowned fixtures, stale tracked reports, and reproducible generated output unless distribution requires tracking it.
9. Prefers fewer canonical folders and one documentation index, without preserving empty taxonomy.

Edits land in dependency order, so the repository never temporarily acquires a second source of truth.

### 5. Verify the result

Run validation proportionate to the changed surfaces:

- missing Markdown links and a stale path/reference scan;
- tracker schema and generated roadmap checks when a tracker exists;
- plan and instruction references;
- generator/source parity for retained generated assets;
- targeted tests for changed tooling;
- repository formatting or whitespace checks;
- the smallest official acceptance command whose contract changed.

Don't add a new proof framework to prove the cleanup. If an existing mandatory gate is itself the debt under removal, verify its replacement directly.

## Completion

Report:

- the structural outcome and before/after inventory;
- merged, deleted, rewritten, and deliberately retained surfaces;
- test/proof machinery removed or demoted, and why;
- validation actually run and any unavailable checker;
- blocked decisions and remaining current debt.

Don't claim completion while live references point to removed material, two documents own the same contract, completed plans remain active, or a mandatory proof route has no named current risk and consumer.
