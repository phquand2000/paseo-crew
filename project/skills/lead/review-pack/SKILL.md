---
name: review-pack
description: "Packages the source units behind a review target into a Markdown pack or source-snapshot ZIP, with a dry run and a secrets check. Use when the Human asks to prepare code for a reviewer outside this machine, such as a web chat model or a colleague."
disable-model-invocation: true
---

# Review pack

Build a focused, reproducible review artifact for a reviewer outside this machine's agents with
the bundled script, not by hand-zipping. Output: one artifact outside the repository (Markdown
file, ZIP, or directory) and the reviewer prompt you wrote to go with it.

## The script

The script is `scripts/review_pack.py`, resolved against this skill's directory (`SKILL_DIR`
below; `REPO` is the repository root). It decides which files go into the artifact and nothing
about what the review looks for, so the prompt is yours to write. List its options with
`python3 SKILL_DIR/scripts/review_pack.py create --help`, and know two defaults before you read
them: without `--out` it writes inside the repository, under `reports/review-packs/`, where the
artifact can get committed; and it includes tests unless you pass `--tests none` (snapshot) or
`--exclude-tests` (Markdown).

Three references sit beside this file. `references/profiles.md` says what each `--profile`
selects; read it when a selection surprises you. `references/review-kinds.md` lists the
priorities for eight kinds of review. `references/reviewer-prompts.md` holds the two prompt
templates and their placeholders.

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
   `GIT_BRANCH.txt`, with the diff only on `--include-diff`. Use the default Markdown pack for a
   small focused review that reads best as one file. Done when the shape fits the question and
   the command carries `--out` and a test flag.

4. **Write the reviewer prompt** to a file outside the repository, such as
   `${TMPDIR:-/tmp}/NAME-prompt.md`: start from the matching template in
   `references/reviewer-prompts.md` and take its review priorities from the kinds in
   `references/review-kinds.md` that fit the target. Done when the file states the target, the
   priorities, and the response format, with every placeholder replaced.

5. **Run a dry run** with the create arguments plus `--dry-run`, and show the Human the
   interpreted scope, file count, size estimate, and notable skipped categories. Done when the
   dry run matches the requested scope.

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
   ```

6. **Create the artifact** with the same command minus `--dry-run`. Add `--prompt-file PATH`,
   naming the file from step 4, only when the Human wants the prompt bundled in; a snapshot
   without it stays neutral and reusable with another question. Done when the `--out` file
   exists.

7. **Check it for secrets**, because the artifact is about to leave the machine:

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

8. **Hand it over.** Give the Human the artifact path and the prompt. Uploading leaves this
   machine, so it is the Human's step: upload only the artifact the Human approved, and paste
   the prompt separately whenever it is not bundled in. Done when the Human has both.

The rule that matters most: the artifact leaves the machine only through the Human, and only
the version the Human approved.
