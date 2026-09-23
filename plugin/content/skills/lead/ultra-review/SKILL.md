---
name: ultra-review
description: "Hunts bugs across one named scope through one Hunter that runs ten independent read-only scouts, or packs the scope for an outside reviewer, with Open Code Review selecting the files and grouping them by review rule. Use when risky work is about to land, a missed bug would cost more than ten scouts, or someone outside the project is to review code they won't clone, who gets it as one packed file. Not for reviewing one change, which is one reviewer."
---

# Ultra review

**hunt**, the default, is for recall: a false positive costs a verification step and a missed bug costs far more, so no candidate leaves the report for being speculative, unique, low-confidence or duplicated, and verification is your ruling after the report exists. **pack** gives a reviewer outside the project one file it can read without the repository. The scripts own file selection, scout assignment and the report's layout; your judgment goes into concerns, focuses and rulings. Everything this skill writes goes under `$PASEO_CREW_STATE/ultra-review/`, never into the repository.

## 1. Scope

```sh
ocr delegate preview --format json --commit "$sha" > "$TMPDIR/ocr-preview.json"   # or --from BASE --to "$sha"
ocr scan --preview --path PATH,PATH --format json > "$TMPDIR/ocr-preview.json"     # an area, no diff
ocr delegate rule --format json $(jq -r '(.reviewable_files // [.files[] | select(.will_review)])[].path' "$TMPDIR/ocr-preview.json") > "$TMPDIR/ocr-rules.json"
```

Skip the rule call when nothing is reviewable. The tool filters by file type, so an excluded file is not a cleared one; the hunt script keeps excluded files in scope. Without `ocr`, say so and run the scripts without the two JSON files.

Write the brief the scouts will be given — the scope, the change intent, the contracts that govern it and its directives `D01`, `D02`, ... — to `$PASEO_CREW_STATE/ultra-review/NAME-brief.md`. The report stamps that file's sha256, so a later round can tell whether the brief it reviewed was this one. Without directives, write concerns `G01`, `G02`, ... from repository contracts, change intent, call paths, lifecycle, data flow and blast radius. Pass their number as `--concern-count` in place of `--directive-count`, so the scouts are given them.

## 2a. hunt

```bash
python3 "$PASEO_CREW_KIT/content/skills/lead/ultra-review/scripts/create_ultra_review_report.py" \
  --workspace "$(git rev-parse --show-toplevel)" --report-dir "$PASEO_CREW_STATE/ultra-review" \
  --review-name NAME --scope "SCOPE" --review-brief "$PASEO_CREW_STATE/ultra-review/NAME-brief.md" --directive-count N \
  --ocr-preview "$TMPDIR/ocr-preview.json" --ocr-rules "$TMPDIR/ocr-rules.json"
```

It writes this round's report, never over an earlier one, with a coverage ledger, and prints the units (each rule group with its files and rule text, plus the excluded files) and each scout's units and directives: two scouts per unit, three per directive. Give a risky unit a third scout yourself.

One Hunter runs the ten scouts as its own subagents; you start it once. It reads the lane branch, or a task's branch when started with that `task`; you do not merge yourself. Call `start_review` once with `role: "hunter"`, a title naming the review, the task when the scope is one not yet accepted, and a focus carrying inline, never as a path into the state directory:

- the brief: scope, change intent, relevant repository contracts, directives or concerns;
- the units with their files and rule text, the excluded files, and each scout's units and directives as the script assigned them;
- warnings from earlier rounds: confirmed fixes, rejected false positives, open routes, where a rejection is a warning, not a filter;
- the ask: `F001`, `F002`, ... grouped by root cause with severity `P0`–`P3`, confidence, `file:line`, evidence, contract violated, plausible failure, durable fix hypothesis and a read-only disconfirming check, speculative candidates included; each assigned file marked reviewed, or skipped with a reason.

End your turn; one handback arrives as mail, and its full hand-back file holds what the mail clips. Restart the Hunter only if it went silent without handing back, with the same focus. A reopen saying it has no subagents means the Hunter's agent cannot hunt: tell the owner in `ask` rather than scouting yourself. Once the findings are in the report, `cut` the Hunter. Then fill the report's TODOs: each file's coverage status, the findings with the fields above and no raw candidate list, one Verification Queue line per finding, and the strongest reason not to merge yet; with no candidates, `No candidates reported.` under Findings.

## 2b. pack

```bash
python3 "$PASEO_CREW_KIT/content/skills/lead/ultra-review/scripts/review_pack.py" create --root "$(git rev-parse --show-toplevel)" \
  --ocr-preview "$TMPDIR/ocr-preview.json" --ocr-rules "$TMPDIR/ocr-rules.json" \
  --include AGENTS.md --exclude-tests --task "BRIEF" --out "$PASEO_CREW_STATE/ultra-review/NAME-review.md" --dry-run
```

It packs the reviewable files with the change's diff, turns each rule group into a reviewer question, and writes the reviewer prompt. Add `--focus` for an excluded file that carries behavior and `--include` for each governing document the reviewer needs to judge the architecture. For a large or architecture review, `--format zip` builds a source snapshot without the diff and writes the prompt beside it, so the reviewer reads source truth rather than a patch. `ask` the owner with the dry run's file count and size, defaulting to build, then build without `--dry-run`.

## Ends in

- **hunt:** the report. Fill its Rulings table: a confirmed finding becomes a `start_task` whose context names the finding IDs, whose owned paths are its scope, and whose acceptance includes its disconfirming check; a rejected one keeps its row with your reason.
- **pack:** the file and its prompt, named to the owner in `report`, who decides where they go.
