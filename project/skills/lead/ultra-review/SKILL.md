---
name: ultra-review
description: "Runs a maximum-recall bug hunt over one named scope with ten independent read-only scouts assigned overlapping concerns, and consolidates every candidate into one durable report with a verification queue. Use when the Human asks for an ultra review. Not for an ordinary review of a change, which is one Reviewer."
---

# Ultra review

The goal is recall, so noise and false positives are acceptable: no candidate leaves the report for being speculative, unique, low-confidence, weakly evidenced or duplicated. Verification is your ruling after the report exists, not part of the hunt.

## Assign concerns

The review brief gives the scope, its sha256 digest, and optionally numbered directives `D01`, `D02`, ...

- With no directives, derive concerns `G01`, `G02`, ... from the scope, repository contracts, change intent, adjacent owners, call paths, lifecycle, data flow and blast radius.
- Every directive is mandatory: give each to at least three scouts and expand it into search angles without weakening it.

Launch ten scouts, `scout-01` to `scout-10`, each a fresh agent from the `reviewer` profile. Every scout has at least one concern and may report any bug it meets in scope. Overlap on risky areas uses different traces, lifecycle phases, owners, adversarial cases or disconfirming approaches, never copies of one prompt, and no candidate is shared before consolidation. Relaunch only scouts whose report never arrived, under their original ID and assignment.

Each scout prompt carries the exact scope, change intent, relevant repository contracts and prior-round warnings; its concern IDs with tailored search angles; the full production surface to inspect, not only the diff; static inspection only, with no tests, builds or package managers; and a request for every candidate, speculative ones included, with the finding fields below. Lenses to combine for a slice: state-machine correctness; ownership and lifecycle gaps; caller, schema and protocol contracts; concurrency, cancellation and cleanup; error masking, fallback and retry; authorization and adversarial input; hot-path cost; generated artifacts, fixtures and docs; fake-pass proof; compatibility paths and duplicate state; missing essential mechanisms.

Before round 2 or later, read every earlier report of the same review name and give relevant scouts short warnings: confirmed fixes, rejected false positives, unresolved routes, regression risks. A prior rejection is a warning, not a filter; a scout may revive it, and the report keeps it.

## Write the report

```bash
python3 .seatworks/skills/lead/ultra-review/scripts/create_ultra_review_report.py \
  --workspace "$(git rev-parse --show-toplevel)" --review-name REVIEW_NAME \
  --scope "SCOPE" --review-brief-sha256 BRIEF_SHA256 --scout-count 10 --directive-count DIRECTIVE_COUNT
```

The script owns the path under `docs/ultrareview/` and the round number. Write only to its `report_path`, never overwrite a report, and replace every `TODO` and the script's comment block. Group candidates by root cause into findings `F001`, `F002`, ..., each with severity `P0`–`P3`, confidence, `file:line`, evidence observed, the contract violated, a plausible failure mode, a durable fix hypothesis, and a read-only disconfirming check. A finding holds only what someone needs to verify and fix it: no raw candidate ledger or merge notes. If scouts reported nothing, write `No candidates reported.` under Findings.

Keep the script's metadata lines and headings: `Prior Round Guard`, `Findings`, `Verification Queue` (every finding with its disconfirming check), `Strongest Reason Not To Merge Yet`, and `Next Receive Prompt`, whose placeholder line you replace with the handoff below.

## Ends in

The report, the only file the review creates; print its path and content. Then rule on every finding in the Verification Queue: each confirmed fix goes to an Engineer as an ordinary brief naming the finding IDs, owned scope, and the disconfirming check as acceptance, and a rejected finding keeps its row with your reason.
