---
name: review-pack
description: "Packages repository code, diffs, docs, or changed files into one deterministic artifact for a reviewer outside this project to read. Use when the Human asks for a pack to hand to an outside agent or person; a review inside the project goes to a Reviewer, which reads the repository itself."
---

# Review Pack

Use this skill to create deterministic source review packs before asking another agent or human to review code. Prefer the bundled CLI instead of hand-zipping files.

For broad hostile review of a current source truth, prefer `--shape source-snapshot --format zip`: it creates a repo-like source/doc ZIP and keeps reviewer prompts, review maps, and diffs out unless explicitly requested. Artifact shape does not expand selection scope; choose files from the review target first. Use the older Markdown pack for compact excerpt reviews where one single text artifact is easier to upload and read.

## CLI

The CLI script is bundled inside this skill:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --help
```

Resolve `<skill-dir>` from this `SKILL.md` file location. Keep outputs outside the repo unless the user wants a repo-local artifact.

## Workflow

1. Identify the review target, then map it to the project's relevant source units before selecting files.
2. Choose either a classic review pack or a source snapshot from that target-driven scope.
3. Run a dry-run first for non-trivial packs.
4. Show the interpreted scope, selected file count, byte/token estimate, and notable skipped categories.
5. Create the pack only after verifying the dry-run matches the user's requested scope.
6. For source-truth, macro-architecture, or large hostile reviews, create a source-snapshot ZIP. For small focused reviews, use the default single-file Markdown.
7. If the relevant source-unit set is uncertain, ask the user before creating the artifact. Do not collapse uncertainty to changed-files-only, and do not expand uncertainty to the whole repository.
8. Give the Human the artifact path and let them upload it; sending it anywhere is theirs to do.
9. Keep prompts separate from source-snapshot artifacts unless the user explicitly asks for a bundled prompt.

## Review Surface Defaults

A review pack is target-driven, not language-driven.

First identify the review target from the user request, current worktree, named task, active plan/spec, or directly named paths. Then map that target to the relevant source units for the project.

A source unit is the project's natural ownership/package boundary, for example:

- Rust: crate or app.
- Go: module, package, or service.
- Vue/TypeScript: app, package, feature module, composable/store/API-client boundary.
- Swift/Kotlin/etc.: module, target, or package.
- Generic repos: the smallest owner directory that contains the behavior being reviewed.

Default inclusion:

- Include complete non-test source for every relevant source unit.
- Include adjacent source units needed to understand contracts, protocol/API boundaries, runtime/client/server flow, generated current truth, or validation/proof behavior.
- Include committed generated source when it is part of current source truth.
- Include only governing or master docs directly needed to interpret the target.

Default exclusion:

- Tests, unless explicitly requested.
- Diffs, unless explicitly requested.
- Prompt files inside ZIPs, unless explicitly requested.
- Whole repository, whole docs tree, unrelated packages/modules/apps, reports, history logs, and local tool/cache/config directories.

Use changed files as a discovery signal for relevant source units, not as the pack boundary. Do not default to changed files only. Do not default to whole repository.

## Source Snapshot ZIPs

Use source snapshots when the reviewer should inspect the current source/doc truth rather than diff hunks. This shape writes repository-relative files under `repo/`, plus factual metadata files such as `MANIFEST.md`, `SOURCE_TREE.txt`, `GIT_STATUS.txt`, `GIT_HEAD.txt`, and `GIT_BRANCH.txt`.

Source snapshots default to:

- no `DIFF.patch`
- no `PROMPT.md`
- tests excluded; pass `--tests none` unless the user explicitly asks for tests
- generated/source files preserved as normal files

Example:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create \
  --root $(git rev-parse --show-toplevel) \
  --shape source-snapshot \
  --format zip \
  --source-root crates/app-protocol/src \
  --source-root crates/app-contracts/src \
  --source-root crates/app-contracts/schema \
  --doc AGENTS.md \
  --doc docs/plans/ACTIVE_EXECUTION_PLAN.md \
  --tests none \
  --out $TMPDIR/task-source.zip
```

Test inclusion modes:

- `--tests all`: include test files and inline Rust `#[cfg(test)]` blocks.
- `--tests none` or `--exclude-tests`: exclude test paths and strip Rust `#[cfg(test)]` blocks.
- `--tests targeted --include-test <path-or-glob>`: include non-test source plus only matching test files; inline Rust test blocks are stripped unless the file matches an include-test pattern.

Add `--include-diff` or `--include-prompt` only when the reviewer explicitly needs those files inside the ZIP.

## Common Commands

Rust crate without tests:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile rust --focus crates/my-crate --exclude-tests --out $TMPDIR/my-crate-review.md
```

Go module without tests:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile go --focus services/api --exclude-tests --out $TMPDIR/api-review.md
```

Vue frontend without tests:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile vue --focus apps/web --exclude-tests --out $TMPDIR/web-review.md
```

Swift iOS app without tests:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile swift-ios --focus Apps/iOS --exclude-tests --out $TMPDIR/ios-review.md
```

Changed files only:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile changed-files --exclude-tests --out $TMPDIR/changes-review.md
```

## Options

- Use `--profile rust|go|vue|swift-ios|changed-files|generic`; repeat `--profile` for mixed projects.
- Use `--shape review-pack|source-snapshot`; source snapshots support `zip` and `dir` outputs and are best for source-truth review.
- Use `--focus <path-or-glob>` to keep the pack centered on a crate, module, app, or package.
- Use `--include <path-or-glob>` for governance docs, plans, API schemas, or design docs outside focus.
- For source snapshots, use repeated `--source-root <path>` for source groups and `--doc <path>` for doctrine, plans, or governance docs.
- Use `--range <path>:<start>-<end>` to include explicit numbered source excerpts; repeat for multiple spans. Add `--only-ranges` when the pack should contain only those excerpts plus prompt/diff/enrichment.
- Use `--exclude-tests` to omit common test paths/files and strip Rust `#[cfg(test)]` blocks from included `.rs` files.
- For source snapshots, pass `--tests none` by default. Use `--tests all` or `--tests targeted --include-test <path-or-glob>` only when the user explicitly asks for tests.
- Use `--review-kind general|bughunt|safety|parity|rust-impact|release|architecture|debug` to select standardized reviewer prompt profiles; repeat for combined reviews. The default is `general`.
- Use `--task` and repeated `--question` to place the review brief directly in the manifest and reviewer prompt.
- For Rust review packs, use `--rust-impact` to add a git-diff symbol impact summary and Cargo metadata. Add `--rust-analyzer` only when diagnostics from the local `rust-analyzer` binary are worth the extra runtime; artifact creation falls back cleanly if unavailable.
- Use `--format md` for the default single-file artifact, `--format zip` for multi-file attachment packs, or `--format dir` for local inspection. `source-snapshot` requires `zip` or `dir`.
- Use `--max-bytes` and `--max-file-bytes` to stay inside upload/model budgets.
- Use `--dry-run` before creating large artifacts.
- Read `references/profiles.md` only when profile behavior or file selection needs clarification.

## Targeted Excerpts

When a reviewer needs exact source spans from one or more large files, prefer explicit ranges instead of copying lines into the prompt:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --only-ranges --range "src/lib.rs:500-1200" --range "src/api.rs:300-700" --task "Review the changed control flow" --question "Find correctness regressions in these spans" --out $TMPDIR/range-review.md
```

Range excerpts preserve original line numbers in the generated `Source Excerpts` section. In `--format dir` or `--format zip`, excerpts are also written to `EXCERPTS.md`.

## Prompt Profiles

Review packs include a standardized Pro-friendly reviewer prompt with a fixed reading order, finding schema, constraints, and missing-context instructions. Use `--review-kind` instead of hand-writing the whole prompt:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile changed-files --review-kind safety --review-kind parity --task "Review visible-session safety and API parity" --question "Find boundary regressions or Node/Python drift" --out $TMPDIR/safety-parity-review.md
```

Available review kinds:

- `general`: correctness, ownership drift, performance risk, missing tests, unclear failure modes.
- `bughunt`: edge cases, state, concurrency, cancellation, retry, and error handling bugs.
- `safety`: leaks, permission boundaries, private API use, destructive/public actions, and redaction defaults.
- `parity`: cross-language/API, protocol, fixtures, docs, examples, and default/error shape drift.
- `rust-impact`: public Rust API, traits, features, changed symbols, call sites, tests, unsafe, async, lifetimes, ownership.
- `release`: packaging, versioning, generated artifacts, docs drift, changelog, compatibility, release gates.
- `architecture`: module boundaries, ownership, coupling, data flow, abstractions, and maintainability risks.
- `debug`: root-cause evidence, repro gaps, diagnostics, flaky tests, and environment assumptions.

## Rust Impact

For Rust changes, enrich the pack with local semantic hints before handing it to an outside reviewer:

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root $(git rev-parse --show-toplevel) --profile rust --include-diff --rust-impact --task "Review this Rust change for API and test impact" --question "Which public symbols or callers are likely affected?" --out $TMPDIR/rust-impact-review.md
```

`--rust-impact` is deterministic and uses git diff hunks, Rust symbol extraction, likely impacted test filenames, and `cargo metadata` when available. `--rust-analyzer` is optional and attempts to append local rust-analyzer diagnostics without making the pack depend on LSP availability.


## Separate Reviewer Prompts

When the user needs a prompt for an external reviewer, write it in chat or to a separate file, never inside a source-snapshot ZIP unless explicitly requested.

For source-snapshot ZIP prompts, include operational reading guidance that prevents context-wasting full-file dumps. Tell the reviewer to build a routing map from `MANIFEST.md`, `SOURCE_TREE.txt`, docs headings, and targeted search first; to inspect large source/docs with `rg` plus focused line windows; to rerun narrower ranges when output is truncated or ellipsized; and to cite only lines actually inspected. Explicitly discourage commands that print whole large files or multiple full docs at once. If tests are excluded, tell the reviewer to state missing test context instead of guessing.

For hostile source-truth reviews, the prompt must:

- name the governing task and artifact shape
- tell the reviewer to treat `repo/` as current source truth
- say `GIT_STATUS.txt` is orientation, not the review boundary
- require broad falsification of local correctness and macro architecture
- compare against the governing plan, doctrine, owner boundaries, and long-lived end state
- allow new findings beyond prior blockers, marker names, and current implementation shape
- ask for owner-clean, long-lived fix directions instead of least-painful patches
- require findings first with file:line, failure path, and why the issue violates the task or architecture

Do not make prior findings or known blockers the scope. If they are useful, phrase them as optional routing hints outside the main mission.

Avoid generic static-analysis boilerplate that distracts from the review target. Do not ban helper scripts in isolated review environments. Only mention operational limits that matter to the user's actual review context.

Use this high-level structure:

```text
You are an independent hostile reviewer for <repo/task>.
The attached ZIP is source/docs only. Treat repo/ as current source truth.
Review <master plan/task>, not merely a local patch or prior-findings checklist.
Falsify both local correctness and macro architecture/end-state fit.
Read: MANIFEST, AGENTS, governing plan/design gate, doctrine, then source.
Operational reading guidance: do not dump entire large files; use MANIFEST/SOURCE_TREE/headings/rg first, then focused line ranges; if output truncates, rerun narrower ranges before reasoning.
Review the whole design surface: <owner/protocol/runtime/proof surfaces>.
Flag issues that pass locally but weaken the long-lived architecture.
Output findings first with severity, file:line, failure path, architectural violation, and owner-clean long-lived fix direction.
```
