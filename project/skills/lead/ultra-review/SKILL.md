---
name: ultra-review
description: "Lead-only: a maximum-recall bug hunt over one named scope, run by ten independent read-only scout seats with deliberate overlap, consolidated into one durable report of every candidate. Use only when the Human asked for an ultra review; ten seats is the cost, and an ordinary review is one Reviewer."
---

# Ultra Review

## When an ultra review is allowed

Ten read-only seats over one scope is the most expensive thing in this project, so the Human
decides to spend it. Run this skill only when the Human asked for an ultra review or an
`OWNER DIRECTIVE:` names one. One Reviewer on the change is the ordinary answer; this is for a
scope where a missed bug costs more than ten seats.

## Goal

Maximize bugs discovered. False positives and noise are acceptable. Never filter a candidate out of the artifact because it is speculative, unique, low-confidence, weakly evidenced, duplicated, or hard to classify.

The coordinator clusters all scout submissions directly into clean, actionable Findings (`F001`, `F002`, ...). Do not include Raw Candidate Ledgers, Execution Receipts, or metadata clutter that an agent does not need to read to verify and fix bugs. Verification and rejection belong to your ruling after the report exists, not to the hunt.

## Inputs And Strategy

The review brief provides scope, an identity digest, and optionally numbered caller directives. An
ultra review always uses 10 scouts, each one a seat on the read-only Reviewer profile
(`list_profiles`), created with your own `create_agent` in your own workspace: leave `workspaceId`
out, pass provider `reviewer` and let the orchestrator apply the profile's model and mode, and
leave `notifyOnFinish` at its default so every scout's completion reaches you. Label each one `review.name` and
`review.scout: scout-NN` so `list_agents` maps them back after a compaction.

If no directives were supplied:

- derive a bug-hunting strategy from the scope, repository contracts, architecture, change intent, adjacent owners, call paths, lifecycle, data flow, and likely blast radius
- name generated concerns `G01`, `G02`, and so on
- diversify search routes while deliberately overlapping risky areas

If directives `D01`, `D02`, ... were supplied:

- treat every directive as mandatory
- assign every directive to at least three independent scouts
- expand each directive into useful search angles without weakening or replacing it

For both modes:

- launch exactly 10 scouts, named consecutively `scout-01` through `scout-10`
- give every scout the same profile and thinking level, so no scout's depth differs from another's
- give every scout at least one assigned concern
- give every scout permission to report any incidental bug inside scope, even outside its assigned concerns
- use overlap to create genuinely different traces, lifecycle phases, owners, adversarial cases, or disconfirming approaches—not identical copies of one prompt
- preserve scout independence and do not share candidate findings before consolidation

## Scout Packet

Each scout prompt must contain:

- exact review scope and change intent
- relevant repository contracts and prior-round warnings
- assigned concern IDs and tailored search angles
- permission to report every incidental in-scope concern
- instruction to inspect the full relevant production surface, not only the visible diff
- request for file/line evidence, failure mode, confidence, durable solution, and a disconfirming check when available
- explicit permission to return incomplete or speculative candidates rather than suppressing them
- read-only restrictions

The Reviewer profile already blocks a scout's edits and repository-changing git; say so in the packet anyway, because the rest of the restriction is asked for rather than enforced. Scouts must not edit, stage, format, generate, or mutate source files. Use static read-only inspection only; do not run tests, builds, package managers, or proof commands. The coordinator may create exactly one report under `docs/ultrareview/` and no other workspace artifact.

## Restart Recovery

A notice that scout seats stopped because the daemon restarted is a recovery trigger, not permission to restart the review from scratch.

1. Freeze the existing logical roster, concern allocation, report path, and review-brief digest.
2. Inventory the reports already received, by logical scout ID, from the report file and `list_agents`.
3. Preserve every completed scout report exactly once.
4. Do not relaunch the full scout batch. Revive or restart only missing logical scouts with their original assignments and the same profile and thinking level.
5. A replacement attempt continues the same logical scout ID; never create an eleventh logical scout or duplicate completed work.
6. After all ten logical scouts complete, consolidate once into the existing report.

When resumed with a recovery prompt, inspect persisted state before taking any launch action. A bare continuation must never create another full batch.

## Search Surface

Choose and combine lenses appropriate to the scope, including but not limited to:

- semantic and state-machine correctness
- ownership × lifecycle/event × expected-outcome gaps
- caller/API/schema/protocol/data-format contracts
- concurrency, ordering, cancellation, cleanup, and resource lifetime
- error masking, fallback, retry, partial failure, and invariant handling
- authorization, trust boundaries, adversarial input, and abuse cases
- hot-path allocation, copies, rescans, N+1 work, blocking, and contention
- generated artifacts, fixtures, validators, snapshots, docs, and examples
- test/proof gaps, fake-pass evidence, and mocked production claims
- compatibility paths, duplicate state, wrappers, caches, and compensation for a broken foundation
- owner/module boundaries, file responsibility, and missing essential mechanisms
- alternate end-to-end call traces and hostile edge cases

This list is raw material, not a fixed topology. Allocate according to the actual slice.

## Prior Round Guard

Before round 2 or later, read every earlier report with the same review name. Give relevant scouts concise warnings about confirmed fixes, rejected false positives, unresolved routes, and regression risks, but do not use prior rejection as a filter: a scout may revive it with or without new evidence, and the artifact must retain that candidate.

## Artifact Contract

Create exactly one report with:

```bash
python3 .seatworks/skills/lead/ultra-review/scripts/create_ultra_review_report.py \
  --workspace "$(git rev-parse --show-toplevel)" --review-name REVIEW_NAME \
  --scope "SCOPE" --review-brief-sha256 SHA256 --scout-count 10 --directive-count COUNT
```

Use the script's `report_path`; never improvise or overwrite it. Replace every `TODO`. If scouts submitted no candidates, state `No candidates reported.` After writing, print the report path and full content.

## Finding Consolidation

1. Group every bug candidate reported by scouts into consolidated Findings (`F001`, `F002`, ...) by root cause. Do NOT add a `Raw Candidate Ledger`, `Execution Receipt`, `Scout preservation counters`, or `Merge Notes` checklist.
2. Preserve all unique or speculative bug candidates in `Findings`. Do not filter out candidates during review.
3. Keep finding descriptions concise and focused purely on actionable information needed by an agent to verify and fix the bug:
   - Severity (`P0`, `P1`, `P2`, `P3`) & Confidence (`high`, `medium`, `low`)
   - Source pointer (exact `file:line`)
   - Evidence observed
   - Contract violated / expected law
   - Plausible failure mode
   - Durable solution hypothesis
   - Disconfirming check
4. Build a Verification Queue containing every finding and its read-only disconfirming check.

## Report Shape

Preserve these headings:

- Metadata header (Date, Review name, Round, Scope, Report path)
- Prior Round Guard
- Findings
- Verification Queue
- Strongest Reason Not To Merge Yet
- Next Receive Prompt

End with the handoff: you rule on every finding in the Verification Queue, and each confirmed
fix goes to an Engineer Peer as an ordinary brief naming the finding IDs, the owned scope, and the
disconfirming check as its acceptance. Scouts never implement, and a finding you reject keeps its
row with your reason.
