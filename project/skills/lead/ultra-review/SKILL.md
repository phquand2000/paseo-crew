---
name: ultra-review
description: "A maximum-recall bug hunt over one named scope: ten independent read-only scouts with deliberate overlap, consolidated into one durable report that keeps every candidate. Use when the Human asks for an ultra review; an ordinary review of a change is one Reviewer."
---

# Ultra review

Ten scouts over one scope is the most expensive review in this project, worth it only where a missed bug costs more than ten seats. The goal is recall: noise and false positives are acceptable, and no candidate leaves the report for being speculative, unique, low-confidence, weakly evidenced, duplicated, or hard to classify. Verification is your ruling after the report exists, not part of the hunt.

## Strategy

The review brief gives the scope, its sha256 digest, and optionally numbered directives `D01`, `D02`, ...

- With no directives, derive concerns `G01`, `G02`, ... from the scope, repository contracts, architecture, change intent, adjacent owners, call paths, lifecycle, data flow, and blast radius.
- With directives, every one is mandatory: assign each to at least three scouts and expand it into search angles without weakening or replacing it.

Launch exactly ten scouts, `scout-01` to `scout-10`, each a seat on the Reviewer profile:

- every scout has at least one assigned concern and may report any incidental bug in scope;
- overlap on risky areas produces genuinely different traces, lifecycle phases, owners, adversarial cases, or disconfirming approaches, never copies of one prompt;
- scouts stay independent, and no candidate is shared before consolidation.

If scouts stop mid-review, relaunch only those whose report has not arrived, under their original ID and assignment.

## Scout packet

Each prompt carries:

- the exact scope, change intent, relevant repository contracts, and prior-round warnings;
- its concern IDs with tailored search angles, and leave to report any incidental in-scope concern;
- the full relevant production surface to inspect, not only the visible diff;
- a request for every candidate, incomplete or speculative ones included, with the finding fields below;
- static inspection only: no tests, builds, package managers, or proof commands.

## Search surface

Combine the lenses that fit the slice; this list is raw material, not a fixed topology:

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

## Prior rounds

Before round 2 or later, read every earlier report with the same review name. Give relevant scouts concise warnings about confirmed fixes, rejected false positives, unresolved routes, and regression risks. A prior rejection is a warning, not a filter: a scout may revive the candidate, and the report keeps it.

## Artifact contract

Create the report with:

```bash
python3 .seatworks/skills/lead/ultra-review/scripts/create_ultra_review_report.py \
  --workspace "$(git rev-parse --show-toplevel)" --review-name <review-name> \
  --scope "<scope>" --review-brief-sha256 <brief-sha256> --scout-count 10 --directive-count <directive-count>
```

The script owns the path under `docs/ultrareview/` and the round number. Write to its `report_path` and nowhere else, never overwrite a report, and replace every `TODO`. This report is the only file the review creates.

Group every scout candidate by root cause into findings `F001`, `F002`, ..., each with:

- severity (`P0` to `P3`) and confidence (`high`, `medium`, `low`);
- source pointer (`file:line`);
- evidence observed;
- contract violated;
- plausible failure mode;
- durable solution hypothesis;
- read-only disconfirming check.

A finding holds only what an agent needs to verify and fix the bug: no raw candidate ledger, execution receipt, preservation counters, or merge notes. If scouts reported nothing, write `No candidates reported.` under Findings.

## Report shape

Keep the script's metadata lines (Date, Review name, Round, Scope, Report path) and these headings:

- `Prior Round Guard`
- `Findings`
- `Verification Queue`: every finding with its disconfirming check
- `Strongest Reason Not To Merge Yet`
- `Next Receive Prompt`: replace the script's placeholder line with the handoff below

After writing, print the report path and the full content.

## Handoff

You rule on every finding in the Verification Queue. Each confirmed fix goes to an Engineer Peer as an ordinary brief naming the finding IDs, the owned scope, and the disconfirming check as its acceptance. Scouts never implement, and a rejected finding keeps its row with your reason.
