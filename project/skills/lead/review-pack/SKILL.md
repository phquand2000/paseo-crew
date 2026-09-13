---
name: review-pack
description: "Packages repository code, diffs, docs, or changed files into one deterministic artifact for a reviewer outside this project to read. Use when the Human asks for a pack to hand to an outside agent or person; a review inside the project goes to a Reviewer, which reads the repository itself."
---

# Review pack

Build the artifact with the bundled CLI rather than hand-zipping files, and write it outside the repository unless the Human wants it inside:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --help
```

## Workflow

1. Identify the review target from the Human's request, the worktree, a named task, an active plan or spec, or named paths, and map it to source units.
2. If the source-unit set is uncertain, ask the Human before building. Don't collapse uncertainty to changed files only, and don't expand it to the whole repository.
3. Choose the shape: a source-snapshot ZIP for source-truth, macro-architecture, or large hostile reviews; the default single-file Markdown pack for small focused reviews, where one text artifact is easier to upload and read. Shape never widens the selection.
4. For any non-trivial pack, run `--dry-run` first and show the interpreted scope, selected file count, byte/token estimate, and notable skipped categories. Build only when that matches the requested scope.
5. Give the Human the artifact path; sending it anywhere is theirs to do.

## Review surface

A pack is target-driven, not language-driven. A source unit is the project's natural ownership boundary: a Rust crate or app; a Go module, package, or service; a Vue/TypeScript app, package, feature module, or composable/store/API-client boundary; a Swift or Kotlin module, target, or package; otherwise the smallest owner directory containing the behavior under review.

Include:

- complete non-test source for every relevant source unit;
- adjacent units needed to understand contracts, protocol/API boundaries, runtime/client/server flow, generated current truth, or validation/proof behavior;
- committed generated source that is part of current source truth;
- only the governing docs directly needed to interpret the target.

Tests, diffs, and prompt files inside a ZIP stay out unless explicitly requested. The whole repository, the whole docs tree, unrelated units, reports, history logs, and local tool/cache/config directories always stay out. Changed files are a signal for finding source units, never the pack boundary.

## Commands

A classic pack around a source unit:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root "$(git rev-parse --show-toplevel)" \
  --profile <profile> --focus <unit-path> --exclude-tests --out "$TMPDIR/<name>-review.md"
```

Profiles: `rust`, `go`, `vue`, `swift-ios`, `generic`, and `changed-files` (reads `git status`, so it needs no `--focus`); repeat `--profile` for mixed projects. Read [references/profiles.md](references/profiles.md) only when a profile's file selection needs clarifying.

A source snapshot writes files under `repo/` plus `MANIFEST.md`, `SOURCE_TREE.txt`, `GIT_STATUS.txt`, `GIT_HEAD.txt`, and `GIT_BRANCH.txt`, with generated files kept as normal files and no `DIFF.patch` or `PROMPT.md`:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root "$(git rev-parse --show-toplevel)" \
  --shape source-snapshot --format zip --source-root <unit-src> --source-root <adjacent-src> \
  --doc AGENTS.md --doc <governing-plan> --tests none --out "$TMPDIR/<name>-source.zip"
```

Exact spans from large files, instead of copying lines into a prompt. Excerpts keep their original line numbers in the `Source Excerpts` section, and `zip` or `dir` output also writes them to `EXCERPTS.md`:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root "$(git rev-parse --show-toplevel)" \
  --only-ranges --range "<path>:<start>-<end>" --range "<path>:<start>-<end>" \
  --task "<brief>" --question "<question>" --out "$TMPDIR/<name>-ranges.md"
```

## Options

- `--shape review-pack|source-snapshot` with `--format md|zip|dir`: `md` is the single-file default, `dir` is for local inspection, and a snapshot needs `zip` or `dir`.
- `--focus <path-or-glob>` centers a pack on a unit; `--include` and `--exclude <path-or-glob>` add governance docs, plans, schemas, or design docs, or drop paths. A snapshot takes repeated `--source-root <path>` and `--doc <path>` instead.
- `--exclude-tests` drops common test paths and strips Rust `#[cfg(test)]` blocks. A snapshot takes `--tests none` by default; use `--tests all`, or `--tests targeted --include-test <path-or-glob>` (inline Rust test blocks stripped unless the file matches), only when the Human asks for tests.
- `--range <path>:<start>-<end>` (repeatable) adds numbered excerpts; `--only-ranges` keeps only those plus prompt, diff, and enrichment.
- `--include-diff` / `--no-include-diff` and `--include-prompt` / `--no-include-prompt`: on by default for a classic pack, off for a snapshot; turn them on in a ZIP only when the reviewer needs those files.
- `--task "<brief>"` and repeated `--question "<question>"` put the brief in the manifest and the reviewer prompt.
- `--review-kind <kind>` (repeatable, default `general`) selects the standardized reviewer prompt, with its fixed reading order, finding schema, and missing-context instructions, instead of a hand-written one:
  - `general`: correctness, ownership drift, performance risk, missing tests, unclear failure modes.
  - `bughunt`: edge cases, state, concurrency, cancellation, retry, and error handling bugs.
  - `safety`: leaks, permission boundaries, private API use, destructive/public actions, and redaction defaults.
  - `parity`: cross-language/API, protocol, fixtures, docs, examples, and default/error shape drift.
  - `rust-impact`: public Rust API, traits, features, changed symbols, call sites, tests, unsafe, async, lifetimes, ownership.
  - `release`: packaging, versioning, generated artifacts, docs drift, changelog, compatibility, release gates.
  - `architecture`: module boundaries, ownership, coupling, data flow, abstractions, and maintainability risks.
  - `debug`: root-cause evidence, repro gaps, diagnostics, flaky tests, and environment assumptions.
- `--rust-impact` adds a deterministic summary from git diff hunks, Rust symbol extraction, likely impacted test filenames, and `cargo metadata` when available; pair it with `--profile rust --include-diff`. `--rust-analyzer` appends local rust-analyzer diagnostics when they are worth the runtime, and the pack still builds without it.
- `--max-bytes` and `--max-file-bytes` keep the pack inside upload and model budgets.
- `--dry-run` prints the selection summary without writing.

## Reviewer prompts

A prompt for an outside reviewer goes in chat or a separate file, never inside a snapshot ZIP unless the Human asks for it bundled. For a snapshot, include reading guidance so the reviewer doesn't waste context on whole files: build a routing map from `MANIFEST.md`, `SOURCE_TREE.txt`, doc headings, and targeted search; read large files with `rg` and focused line windows; rerun narrower ranges when output truncates; cite only lines actually inspected. If tests are excluded, the reviewer states the missing test context instead of guessing.

Prior findings and known blockers are optional routing hints outside the mission, never its scope. Leave out generic static-analysis boilerplate and helper-script bans for isolated review environments; name only the operational limits that matter to this review. A hostile source-truth prompt follows this structure:

```text
You are an independent hostile reviewer for <repo/task>.
The attached ZIP is source/docs only. Treat repo/ as current source truth; GIT_STATUS.txt is orientation, not the review boundary.
Review <master plan/task>, not merely a local patch or prior-findings checklist.
Falsify both local correctness and macro architecture against the governing plan, doctrine, owner boundaries, and long-lived end state.
Read: MANIFEST, AGENTS, governing plan/design gate, doctrine, then source.
Operational reading guidance: do not dump entire large files; use MANIFEST/SOURCE_TREE/headings/rg first, then focused line ranges; if output truncates, rerun narrower ranges before reasoning.
Review the whole design surface: <owner/protocol/runtime/proof surfaces>.
Report new findings beyond prior blockers, marker names, and the current implementation shape. Flag issues that pass locally but weaken the long-lived architecture.
Output findings first with severity, file:line, failure path, the task or architecture rule violated, and an owner-clean long-lived fix direction rather than the least painful patch.
```
