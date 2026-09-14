---
name: ultra-review
description: "Hunts bugs across one named scope with ten independent read-only scouts, or packs the scope for an outside reviewer, with Open Code Review selecting the files and grouping them by review rule. Use at the protocol's ultra-review gate, when a missed bug would cost more than ten scouts, or when someone outside the project is to review it. Not for reviewing one change, which is one Reviewer."
---

# Ultra review

**hunt**, the default, is for recall: a false positive costs a verification step and a missed bug costs far more, so no candidate leaves the report for being speculative, unique, low-confidence or duplicated, and verification is your ruling after the report exists. **pack** gives a reviewer outside the project one artifact it can read without the repository. The scripts own file selection, scout assignment and the report's layout; your judgment goes into concerns, prompts and rulings.

## 1. Scope

```sh
ocr delegate preview --format json --commit "$sha" > "$TMPDIR/ocr-preview.json"   # or --from BASE --to "$sha"
ocr scan --preview --path PATH,PATH --format json > "$TMPDIR/ocr-preview.json"     # an area, no diff
ocr delegate rule --format json $(jq -r '(.reviewable_files // [.files[] | select(.will_review)])[].path' "$TMPDIR/ocr-preview.json") > "$TMPDIR/ocr-rules.json"
```

Skip the rule call when nothing is reviewable. The tool filters by file type, so an excluded file is not a cleared one; the hunt script keeps excluded files in scope. Without `ocr`, say so and run the scripts without the two JSON files.

The review brief gives the scope, its sha256 and optional directives `D01`, `D02`, .... Without directives, write concerns `G01`, `G02`, ... from repository contracts, change intent, call paths, lifecycle, data flow and blast radius.

## 2a. hunt

```bash
python3 "$SEATWORKS_KIT/content/skills/lead/ultra-review/scripts/create_ultra_review_report.py" \
  --workspace "$(git rev-parse --show-toplevel)" --review-name NAME --scope "SCOPE" \
  --review-brief-sha256 SHA256 --directive-count N \
  --ocr-preview "$TMPDIR/ocr-preview.json" --ocr-rules "$TMPDIR/ocr-rules.json"
```

It writes this round's report under `docs/ultrareview/`, never over an earlier one, with a coverage ledger, and prints the units (each rule group with its files and rule text, plus the excluded files) and each scout's units and directives: two scouts per unit, three per directive. Give a risky unit a third scout yourself.

Launch `scout-01` to `scout-10`, each a fresh agent from the `reviewer` profile with the model and thinking level of the `Ultra-review scouts` line in `$SEATWORKS_STATE/protocol.md`, or the profile's defaults without it. Each prompt carries:

- the scope, change intent and relevant repository contracts;
- its units' files and rule text, and its directives and concerns, each with a search angle no other scout on that unit has, because copies of one prompt find the same bugs twice;
- warnings from earlier rounds: confirmed fixes, rejected false positives, open routes, where a rejection is a warning, not a filter;
- `Machine pass: skip` and static inspection only, since ten scouts building and testing at once collide;
- the ask: every candidate, speculative ones included, with severity `P0`–`P3`, confidence, `file:line`, evidence, contract violated, plausible failure, durable fix hypothesis and a read-only disconfirming check; and each assigned file marked reviewed, or skipped with a reason.

Share no candidate before consolidation, and relaunch only a scout whose report never arrived, under its original ID and assignment. Then fill the report's TODOs: each file's coverage status, findings `F001`, `F002`, ... grouped by root cause with the fields above and no raw candidate list, one Verification Queue line per finding, and the strongest reason not to merge yet; with no candidates, `No candidates reported.` under Findings.

## 2b. pack

```bash
python3 "$SEATWORKS_KIT/content/skills/lead/ultra-review/scripts/review_pack.py" create --root "$(git rev-parse --show-toplevel)" \
  --ocr-preview "$TMPDIR/ocr-preview.json" --ocr-rules "$TMPDIR/ocr-rules.json" \
  --include AGENTS.md --exclude-tests --task "BRIEF" --out "$TMPDIR/NAME-review.md" --dry-run
```

It packs the reviewable files with the change's diff, turns each rule group into a reviewer question, and writes the reviewer prompt. Add `--focus` for an excluded file that carries behavior and `--include` for each governing document the reviewer needs to judge the architecture. For a large or architecture review, `--format zip` builds a source snapshot without the diff and writes the prompt beside it, so the reviewer reads source truth rather than a patch. Show the Human the dry run's file count and size, then build without `--dry-run`.

## Ends in

- **hunt:** the report, the only file the review creates. Fill its Rulings table: a confirmed finding goes to an Engineer as a brief naming the finding IDs, the owned scope, and its disconfirming check as acceptance; a rejected one keeps its row with your reason.
- **pack:** the artifact and its prompt, given to the Human, who decides where they go.
