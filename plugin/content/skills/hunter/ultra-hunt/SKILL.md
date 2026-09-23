---
name: ultra-hunt
description: "Runs a maximum-recall parallel bug hunt over one scope with exactly ten read-only scouts, devising concerns from the scope or allocating the brief's directives with deliberate overlap, then consolidates every candidate into findings handed back once. Use when your brief asks for an ultra review, a bug hunt or findings across a scope."
---

# Ultra hunt

## Goal

Maximize bugs discovered. False positives and noise are acceptable. Never filter a candidate out because it is speculative, unique, low-confidence, weakly evidenced, duplicated or hard to classify. Verification and rejection happen after your hand-back, not in it.

You cluster every scout submission directly into clean, actionable findings (`F001`, `F002`, ...). Hand back no raw candidate ledger, execution receipt or metadata clutter a reader does not need to verify and fix a bug.

## Inputs and strategy

The brief gives the scope, the change intent, the governing contracts, the units (file groups with their rule text, plus excluded files that stay in scope) and each scout's units, and optionally numbered directives `D01`, `D02`, .... Always ten scouts.

Without directives:

- derive a strategy from the scope, repository contracts, architecture, change intent, adjacent owners, call paths, lifecycle, data flow and blast radius;
- name the generated concerns `G01`, `G02`, ... (the brief may already list them; keep them);
- diversify search routes while deliberately overlapping risky areas.

With directives:

- every directive is mandatory;
- give each to at least three independent scouts;
- expand each into useful search angles without weakening or replacing it.

Always:

- launch exactly ten scouts, named `scout-01` to `scout-10`, as your own agent's subagents;
- run every scout on Gemini Flash 3.6 (High) when your agent lets you pick a subagent's model; otherwise on the one it gives;
- keep the brief's per-scout units; give every scout at least one concern;
- let every scout report any incidental bug inside the scope, beyond its assigned concerns;
- overlap to create genuinely different traces, lifecycle phases, owners, adversarial cases or disconfirming approaches, never identical copies of one prompt;
- keep scouts independent: share no candidate before consolidation.

## Scout packet

Each scout prompt carries:

- the exact scope and change intent;
- the relevant repository contracts and prior-round warnings;
- its units' files and rule text, its concern IDs and a tailored search angle no other scout on that unit has;
- permission to report every incidental in-scope concern;
- an instruction to inspect the full relevant production surface, not only the visible diff;
- a request for `file:line` evidence, failure mode, confidence, durable fix and a disconfirming check when available;
- explicit permission to return incomplete or speculative candidates rather than suppress them;
- read-only limits: static inspection only; edit, stage, format or generate nothing; run no tests, builds, package managers or proof commands.

## Restart recovery

A notice that subagents or background tasks stopped, for a restart or otherwise, is a recovery trigger, not permission to start over.

1. Freeze the roster, the concern allocation and the brief.
2. Inventory the scout reports already returned, by scout ID.
3. Keep every completed report exactly once.
4. Do not relaunch the batch. Restart only the missing scouts, with their original assignments and model.
5. A replacement continues the same scout ID; never create an eleventh scout or duplicate completed work.
6. Once all ten have reported, consolidate once.

When resumed, inspect what already came back before launching anything. A bare continuation never starts another full batch.

## Search surface

Choose and combine lenses fitting the scope, including but not limited to:

- semantic and state-machine correctness;
- ownership × lifecycle/event × expected-outcome gaps;
- caller/API/schema/protocol/data-format contracts;
- concurrency, ordering, cancellation, cleanup and resource lifetime;
- error masking, fallback, retry, partial failure and invariant handling;
- authorization, trust boundaries, adversarial input and abuse cases;
- hot-path allocation, copies, rescans, N+1 work, blocking and contention;
- generated artifacts, fixtures, validators, snapshots, docs and examples;
- test/proof gaps, fake-pass evidence and mocked production claims;
- compatibility paths, duplicate state, wrappers, caches and compensation for a broken foundation;
- owner/module boundaries, file responsibility and missing essential mechanisms;
- alternate end-to-end call traces and hostile edge cases.

This is raw material, not a fixed topology. Allocate by the actual slice.

## Prior-round guard

When the brief carries warnings from earlier rounds (confirmed fixes, rejected false positives, open routes, regression risks), pass each to the scouts it concerns. A prior rejection is a warning, not a filter: a scout may revive it, with or without new evidence, and your hand-back keeps it.

## Consolidation

1. Group every candidate into findings `F001`, `F002`, ... by root cause.
2. Keep every unique or speculative candidate as a finding; filter nothing.
3. Keep each finding to what a reader needs to verify and fix it:
   - severity (`P0`–`P3`) and confidence (`high`, `medium`, `low`);
   - exact `file:line`;
   - evidence observed;
   - contract violated or expected law;
   - plausible failure;
   - durable fix hypothesis;
   - read-only disconfirming check.
4. Mark each assigned file reviewed, or skipped with the reason.
5. Write one Verification Queue line per finding: its ID and its disconfirming check.
6. Name the strongest reason not to merge yet.

With no candidates, hand back `No candidates reported.` as the findings.
