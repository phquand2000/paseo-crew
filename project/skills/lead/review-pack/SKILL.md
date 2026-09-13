---
name: review-pack
description: "Packages the source units, docs, and optionally diffs or line ranges behind a review target into one deterministic artifact for a reviewer outside this project, with a reviewer prompt kept alongside it. Use when the Human asks for a pack to hand to an outside agent or person. Not for a review inside the project, which goes to a Reviewer."
---

# Review pack

You build one artifact an outside reviewer can read without the repository, using the bundled CLI rather than copying files by hand, and write it outside the repository unless the Human wants it inside. `create --help` lists every option.

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --help
```

## Choose what goes in

A pack follows the review target, not the language. Map the target (the Human's request, a plan, named paths) to source units: the project's natural ownership boundaries, such as a crate, a Go module or service, a frontend feature module, or the smallest owner directory holding the behavior.

- **In:** complete non-test source of each relevant unit; adjacent units needed to understand its contracts, protocol boundaries, runtime flow or proof behavior; committed generated source that is current truth; only the governing docs needed to interpret it.
- **Out, unless the Human asks:** tests, diffs and prompt files inside a snapshot.
- **Always out:** the whole repository or docs tree, unrelated units, reports, history logs, and tool, cache or config directories.

Changed files are a signal for finding units, never the pack's boundary. When the unit set is uncertain, ask the Human rather than shrinking to changed files or growing to the whole repository.

## Build it

1. Pick the shape: a `source-snapshot` ZIP for source-truth, architecture or large hostile reviews; the default single-file Markdown pack for small focused ones. The shape never widens the selection.
2. Run with `--dry-run` first and show the Human the scope, file count, size estimate and notable skips; build only when that matches the request.

```bash
python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root "$(git rev-parse --show-toplevel)" \
  --profile PROFILE --focus UNIT_PATH --exclude-tests --out "$TMPDIR/NAME-review.md"

python3 .seatworks/skills/lead/review-pack/scripts/review_pack.py create --root "$(git rev-parse --show-toplevel)" \
  --shape source-snapshot --format zip --source-root UNIT_SRC --doc AGENTS.md --tests none --out "$TMPDIR/NAME-source.zip"
```

Use `--range PATH:START-END` with `--only-ranges` for exact spans of large files, `--task` and `--question` to carry the brief, and `--review-kind` for a standard reviewer prompt. [references/profiles.md](references/profiles.md) says what each `--profile` selects.

## The reviewer prompt

Keep the prompt in chat or a separate file, not inside a snapshot. It tells the reviewer to route through `MANIFEST.md`, `SOURCE_TREE.txt` and headings before reading, to read large files in focused ranges, and to cite only lines it read; with tests excluded, it states the missing test context instead of guessing. Prior findings are routing hints, never the scope. A hostile source-truth prompt asks the reviewer to falsify both local correctness and the macro architecture against the governing plan and owner boundaries, to report issues that pass locally but weaken the long-lived design, and to give each finding a severity, `file:line`, failure path, the rule it breaks, and an owner-clean fix direction rather than the least painful patch.

## Ends in

The artifact's path and the reviewer prompt, given to the Human; sending them anywhere is the Human's to do.
