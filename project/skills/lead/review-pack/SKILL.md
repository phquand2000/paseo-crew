---
name: review-pack
description: "Packages the source units behind a review target into a deterministic Markdown pack or source-snapshot ZIP for an external human or model reviewer, with a dry run first, tests excluded by default, byte budgets, a secrets check, and the reviewer prompt kept separate. Use when the Human asks to prepare code for a reviewer outside this machine, such as a web chat model or a colleague."
disable-model-invocation: true
---

# Review pack

Use this skill to build a focused, reproducible review artifact for a reviewer outside this
machine's agents, with the bundled script instead of hand-zipping files.

It produces one artifact outside the repository (a Markdown file, a ZIP, or a directory) and a
reviewer prompt, in your reply or in a separate file.

## The script

The script is `scripts/review_pack.py`; resolve that path against this skill's directory. In
the commands below, `SKILL_DIR` stands for that directory and `REPO` for the repository root.

```bash
python3 SKILL_DIR/scripts/review_pack.py create --help
```

Pass `--out` every time, with a path outside the repository such as `${TMPDIR:-/tmp}/NAME`.
Without it the script writes under `reports/review-packs/` inside the repository, where the
artifact can end up committed.

`references/profiles.md` (relative to this skill's directory) describes what each `--profile`
selects; read it when the selection surprises you.

## Procedure

1. **Identify the review target** from the request given with this skill: a task, an
   ExecPlan, named paths, or the current branch. Done when you can state it in one sentence.

2. **Map the target to source units**, the project's natural ownership boundaries: a Rust
   crate, a Go module or package, a Vue or TypeScript app or feature module, a Swift target,
   or otherwise the smallest directory that owns the behavior. Include:

   - the complete non-test source of every relevant unit;
   - adjacent units needed to understand contracts, API or protocol boundaries, and runtime
     flow;
   - committed generated source that is part of current truth;
   - only the governing docs needed to read the target, such as `AGENTS.md`, the ExecPlan, and
     the relevant ADRs.

   Leave out tests, diffs, and prompt files unless the request asks for them, and leave out
   the whole repository, the whole docs tree, unrelated units, reports, logs, and tool caches.
   Use changed files to discover units rather than as the boundary: a diff-only pack hides the
   code the change depends on, and a whole-repository pack buries it. If the set of units stays
   uncertain, ask the Human. Done when you have the list of source paths and doc paths.

3. **Choose the shape.** Use `--shape source-snapshot --format zip` for source-truth,
   architecture, or large adversarial reviews: it writes repository-relative files under
   `repo/` plus `MANIFEST.md`, `SOURCE_TREE.txt`, `GIT_STATUS.txt`, `GIT_HEAD.txt`, and
   `GIT_BRANCH.txt`, and leaves the diff and prompt out unless you pass `--include-diff` or
   `--include-prompt`. Use the default Markdown pack for a small focused review that reads best
   as one file. Done when the shape fits the size of the question.

4. **Run a dry run** with the same arguments plus `--dry-run`, and show the Human the
   interpreted scope, the file count, the size estimate, and the notable skipped categories.
   Done when the dry run matches the requested scope.

5. **Create the artifact** by running the same command without `--dry-run`. Done when the
   file at the `--out` path exists.

6. **Check it for secrets**, because the artifact is about to leave the machine:

   ```bash
   out=OUT_PATH
   pattern='(api[_-]?key|secret|passw(or)?d|private key|BEGIN [A-Z ]*PRIVATE)'
   case "$out" in
     *.zip) unzip -p "$out" | grep -nEi "$pattern" ;;
     *)     grep -rnEi "$pattern" "$out" ;;
   esac
   ```

   Look at each hit, and rebuild with `--exclude` for any file that shouldn't go. The script
   doesn't exclude environment files by default, so pass `--exclude '*.env' --exclude
   '*.env.*'` whenever the source units contain any. Done when every hit is explained or
   excluded.

7. **Hand it over.** Write the reviewer prompt (next section), then give the Human the
   artifact path and the prompt. Uploading leaves this machine, so it is the Human's step:
   upload only the artifact the Human approved, and paste the reviewer prompt separately
   instead of bundling it into a source snapshot. Done when the Human has both.

## Common commands

A Rust crate without tests, as one Markdown file:

```bash
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --profile rust \
  --focus crates/my-crate --exclude-tests --out "${TMPDIR:-/tmp}/my-crate-review.md"
```

A source snapshot of two source roots and their governing docs:

```bash
python3 SKILL_DIR/scripts/review_pack.py create --root REPO \
  --shape source-snapshot --format zip \
  --source-root crates/app-protocol/src --source-root crates/app-contracts/src \
  --doc AGENTS.md --doc docs/exec-plans/active/SLUG.md \
  --tests none --out "${TMPDIR:-/tmp}/SLUG-source.zip"
```

Changed files only, for a narrow follow-up review:

```bash
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --profile changed-files \
  --exclude-tests --out "${TMPDIR:-/tmp}/changes-review.md"
```

Exact spans from large files, keeping their original line numbers:

```bash
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --only-ranges \
  --range "src/lib.rs:500-1200" --range "src/api.rs:300-700" \
  --task "Review the changed control flow" --question "Find correctness regressions" \
  --out "${TMPDIR:-/tmp}/range-review.md"
```

## Options worth knowing

- `--profile rust|go|vue|swift-ios|changed-files|generic`, repeatable for mixed projects.
- `--focus PATH` centers a pack on a unit; `--include PATH` adds docs, schemas, or plans
  outside it. For snapshots, use `--source-root PATH` and `--doc PATH` instead.
- `--tests none|all|targeted`, with `--include-test GLOB` for `targeted`. `--exclude-tests`
  also strips Rust `#[cfg(test)]` blocks. Tests stay out by default because they double the
  size and pull the reviewer toward the test's view of the behavior.
- `--review-kind general|bughunt|safety|parity|rust-impact|release|architecture|debug`,
  repeatable, selects the reviewer prompt profile built into the pack; `--task` and repeated
  `--question` put the brief into the manifest and prompt.
- `--rust-impact` adds a symbol-impact summary from the git diff and `cargo metadata`;
  `--rust-analyzer` adds diagnostics when the binary is available.
- `--max-bytes` and `--max-file-bytes` keep the pack inside the reviewer's upload and context
  limits.

## Reviewer prompts

Write the prompt in your reply or in a separate file next to the artifact, never inside a
source snapshot unless the Human asks, so that the artifact stays neutral and can be reused
with a different question.

For a source snapshot, tell the reviewer how to read it without flooding its context: build a
map from `MANIFEST.md`, `SOURCE_TREE.txt`, and doc headings first; search, then read focused
line ranges; rerun a narrower range when output is cut off; and cite only lines actually read.
If tests are excluded, tell the reviewer to name missing test context rather than guess.

For an adversarial source-truth review, cover these points in the prompt:

```text
You are an independent adversarial reviewer for PROJECT_OR_TASK.
The attached ZIP holds source and docs only; treat repo/ as the current source truth.
GIT_STATUS.txt is orientation, not the boundary of the review.
Review GOVERNING_PLAN_OR_TASK as a whole, not only a local patch or a list of earlier findings.
Try to falsify both local correctness and fit with the long-lived architecture.
Read MANIFEST.md, AGENTS.md, the governing plan and ADRs, then the source.
Cover these surfaces: SURFACES.
Flag issues that pass locally but weaken the architecture.
Report findings first, each with severity, file:line, failure path, the rule or boundary it
breaks, and a durable fix direction rather than the least painful patch.
```

Replace `PROJECT_OR_TASK`, `GOVERNING_PLAN_OR_TASK`, and `SURFACES` (the owner, protocol,
runtime, and proof surfaces in scope). Keep earlier findings out of the mission; if they help,
add them afterwards as optional hints, because a list of known blockers tends to become the
scope. Mention only operating limits that matter for this reviewer.

The rule that matters most: the artifact leaves the machine only through the Human, and only
the version the Human approved.
