---
name: review-pack
description: "Packages the source units behind a review target into a Markdown pack or source-snapshot ZIP, with a dry run and a secrets check. Use when the Human asks to prepare code for a reviewer outside this machine, such as a web chat model or a colleague."
disable-model-invocation: true
---

# Review pack

Build a focused, reproducible review artifact for a reviewer outside this machine's agents with
the bundled script, not by hand-zipping. Output: one artifact outside the repository (Markdown
file, ZIP, or directory) and a reviewer prompt, in your reply or a separate file.

## The script

The script is `scripts/review_pack.py`, resolved against this skill's directory (`SKILL_DIR`
below; `REPO` is the repository root). List its options with
`python3 SKILL_DIR/scripts/review_pack.py create --help`. Always pass `--out` with a path
outside the repository, such as `${TMPDIR:-/tmp}/NAME`: the default, `reports/review-packs/`,
is inside it, where the artifact can get committed. `references/profiles.md` (relative to this
skill's directory) says what each `--profile` selects; read it when a selection surprises you.

## Procedure

1. **Identify the review target** from the request given with this skill: a task, an ExecPlan,
   named paths, or the current branch. Done when you can state it in one sentence.

2. **Map the target to source units**, the project's ownership boundaries: a Rust crate, a Go
   module or package, a Vue or TypeScript app or feature module, a Swift target, or else the
   smallest directory that owns the behavior.

   - Include the complete non-test source of each relevant unit; adjacent units needed for
     contracts, API or protocol boundaries, and runtime flow; committed generated source that
     is current truth; and only the governing docs needed to read it (`AGENTS.md`, the
     ExecPlan, relevant ADRs).
   - Leave out the whole repository or docs tree, unrelated units, reports, logs, and tool
     caches; and, unless the request asks, tests (they double the size and pull the reviewer
     toward the test's view), diffs, and prompt files.

   Use changed files to find units, not as the boundary: a diff-only pack hides the code the
   change depends on, and a whole-repository pack buries it. If the units stay uncertain, ask
   the Human. Done when you have the list of source and doc paths.

3. **Choose the shape.** Use `--shape source-snapshot --format zip` for source-truth,
   architecture, or large adversarial reviews: it writes repository-relative files under
   `repo/` plus `MANIFEST.md`, `SOURCE_TREE.txt`, `GIT_STATUS.txt`, `GIT_HEAD.txt`, and
   `GIT_BRANCH.txt`, with the diff and prompt only on `--include-diff` or `--include-prompt`.
   Use the default Markdown pack for a small focused review that reads best as one file. The
   script includes tests by default, so add `--tests none` (snapshot) or `--exclude-tests`
   (Markdown) unless the request asks for tests. Done when the shape fits the question and the
   command carries a test flag.

4. **Run a dry run** with the same arguments plus `--dry-run`, and show the Human the
   interpreted scope, file count, size estimate, and notable skipped categories. Done when the
   dry run matches the requested scope.

5. **Create the artifact** with the same command minus `--dry-run`. Done when the `--out` file
   exists.

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
   doesn't exclude environment files, so pass `--exclude '*.env' --exclude '*.env.*'` whenever
   the source units contain any. Done when every hit is explained or excluded.

7. **Hand it over.** Write the reviewer prompt (below), then give the Human the artifact path
   and the prompt. Uploading leaves this machine, so it is the Human's step: upload only the
   artifact the Human approved, and paste the prompt separately instead of bundling it into a
   source snapshot. Done when the Human has both.

## Common commands

```bash
# A Rust crate without tests, as one Markdown file
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --profile rust \
  --focus crates/my-crate --exclude-tests --out "${TMPDIR:-/tmp}/my-crate-review.md"

# A source snapshot of two source roots and their governing docs
python3 SKILL_DIR/scripts/review_pack.py create --root REPO \
  --shape source-snapshot --format zip \
  --source-root crates/app-protocol/src --source-root crates/app-contracts/src \
  --doc AGENTS.md --doc docs/exec-plans/active/SLUG.md \
  --tests none --out "${TMPDIR:-/tmp}/SLUG-source.zip"

# Changed files only, for a narrow follow-up review
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --profile changed-files \
  --exclude-tests --out "${TMPDIR:-/tmp}/changes-review.md"

# Exact spans from large files, keeping their original line numbers
python3 SKILL_DIR/scripts/review_pack.py create --root REPO --only-ranges \
  --range "src/lib.rs:500-1200" --range "src/api.rs:300-700" \
  --task "Review the changed control flow" --question "Find correctness regressions" \
  --out "${TMPDIR:-/tmp}/range-review.md"
```

## Options worth knowing

- `--profile rust|go|vue|swift-ios|changed-files|generic`, repeatable for mixed projects.
- `--focus PATH` centers a pack on a unit; `--include PATH` adds docs, schemas, or plans outside
  it. Snapshots use `--source-root PATH` and `--doc PATH` instead.
- `--tests none|all|targeted`, with `--include-test GLOB` for `targeted`; `--exclude-tests` also
  strips Rust `#[cfg(test)]` blocks.
- `--review-kind general|bughunt|safety|parity|rust-impact|release|architecture|debug`,
  repeatable, picks the built-in reviewer prompt profile; `--task` and repeated `--question` put
  the brief into the manifest and prompt.
- `--rust-impact` adds a symbol-impact summary from the git diff and `cargo metadata`;
  `--rust-analyzer` adds diagnostics when the binary is available.
- `--max-bytes` and `--max-file-bytes` fit the pack to the reviewer's upload and context limits.

## Reviewer prompts

Keep the prompt out of a source snapshot unless the Human asks, so the artifact stays neutral
and reusable with another question. The script's built-in prompt, shaped by `--review-kind`,
asks for no broad rewrites, so use it only for a small Markdown pack. For an adversarial
source-truth review, write a prompt that covers these points:

```text
You are an independent adversarial reviewer for PROJECT_OR_TASK.
The attached ZIP holds source and docs only; treat repo/ as the current source truth.
GIT_STATUS.txt is orientation, not the boundary of the review.
Review GOVERNING_PLAN_OR_TASK as a whole, not only a local patch or a list of earlier findings.
Try to falsify both local correctness and fit with the long-lived architecture.
Read MANIFEST.md, AGENTS.md, the governing plan and ADRs, then the source.
Don't dump whole large files: map from MANIFEST.md, SOURCE_TREE.txt, and doc headings, search,
then read focused line ranges (narrower when output is cut off), and cite only lines you read.
If tests are excluded, name the missing test context rather than guess.
Cover these surfaces: SURFACES.
Flag issues that pass locally but weaken the architecture.
Report findings first, each with severity, file:line, failure path, the rule or boundary it
breaks, and a durable fix direction rather than the least painful patch.
```

Replace `PROJECT_OR_TASK`, `GOVERNING_PLAN_OR_TASK`, and `SURFACES` (the owner, protocol,
runtime, and proof surfaces in scope). Keep earlier findings out of the mission, adding them
afterwards as optional hints if they help, because a list of known blockers tends to become the
scope. Mention only operating limits that matter for this reviewer.

The rule that matters most: the artifact leaves the machine only through the Human, and only
the version the Human approved.
