---
name: ocr-review
description: "Run a commit or range through Open Code Review: preview files, run the full review with a model or delegation mode without, confirm every comment at the SHA, report coverage. Use for every change review unless the brief's Machine pass says skip."
---

# Open Code Review

Use this skill to put a change through Open Code Review (`ocr`) and turn its output into findings you have confirmed. OCR is built for precision: it selects the files, bundles related ones, matches review rules to each file, and places each comment on a line. It finds fewer issues than a free-form review, so it is a first pass, not the whole review. It produces OCR output under `$TMPDIR`, confirmed findings in the block from `reviewing-a-change`, and coverage lines for your handoff.

## Set up

1. Check the tool with `ocr --version`. If it is missing, report `BLOCKED` with that output; installing a global package isn't part of a review. **Done** when it prints a version.
2. Turn the target into OCR's arguments, called `TARGET` below:
   - one commit: `--commit "$sha"`;
   - a range: `--from "$base" --to "$sha"`, which reviews the changes since their merge base.

   Never run OCR without one of these: without them it reviews the working tree, which may hold someone else's edits. **Done** when `TARGET` is written down.
3. Write the brief's Objective, Decided / ruled out, and global constraints to `$TMPDIR/ocr-TASK-background.md`, where `TASK` is the brief's Task ID, with the shell (`cat > "$TMPDIR/ocr-TASK-background.md" <<'EOF'`), since the file tools aren't available in a review. OCR reads it as business context. **Done** when the file exists.
4. Preview what OCR will review, without calling a model:

   ```sh
   ocr review TARGET --preview --format json --audience agent
   ```

   Compare its file list with `git show --stat "$sha"`, or `git diff --stat "$base" "$sha"`. Files OCR excludes (generated code, lockfiles, unsupported types) are yours to judge: read the ones that matter to the brief yourself. **Done** when every changed file is on OCR's list or noted as excluded, with the reason.

## Run the machine pass

Check whether OCR has a model: `ocr llm test`. Exit 0 means it has one.

**With a model**, OCR's own review agent runs the review. `--no-filter` keeps the comments OCR's model would otherwise drop, because the Lead filters, not you:

```sh
ocr review TARGET --no-filter --format json --audience agent \
  --background-file "$TMPDIR/ocr-TASK-background.md" --output "$TMPDIR/ocr-TASK.json"
```

Read the whole output file with your read tool, never through `head` or `tail`, which drop comments. `status` `success` or `completed_with_warnings` is usable; each entry under `warnings` names a file OCR failed on, and those files are yours to review. A non-zero exit means the run failed: put its output under Verification and continue in delegation mode. **Done** when you have every comment and the list of failed files.

**Without a model**, OCR selects the files and rules, and you review:

1. `ocr delegate preview --format json TARGET` gives the mode, the `merge_base`, and the reviewable files.
2. `ocr delegate rule --format json PATHS` gives the review rules, grouped by content.
3. For each reviewable file, read its diff (`git show "$sha" -- PATH` for a commit, `git diff MERGE_BASE "$sha" -- PATH` for a range) and review it against its rule group, reading callers and related files as you need.
4. Keep a checklist: every reviewable file ends `reviewed`, or `skipped` with a concrete reason.

**Done** when every reviewable file is reviewed or skipped with a reason.

## Confirm every comment

OCR's comments are candidates. For each one:

1. Open the code at the SHA with `git show "$sha:PATH"` around `start_line` to `end_line`. When both are `0`, OCR couldn't place the comment; find the code it describes yourself.
2. Restate the claim: what fails, for which input or timing, and which contract it breaks.
3. Run its disconfirming check: trace the input to the failure through every validation on the way. Keep the comment if it holds; otherwise drop it and note the evidence, because the Lead may ask.
4. Write each kept comment as a finding with `Source: ocr`. Map `critical` to P0, `high` to P1, `medium` to P2, and `low` to P3, then adjust the severity if your trace shows a different consequence. Keep low-severity findings: the Lead filters, not you.

**Done** when every comment is a finding or dropped with evidence.

## Look for what it missed

OCR reviews the diff against general rules and doesn't know the brief. Continue with `reviewing-a-change` for the spec, standards, and structure axes the brief asks about, and mark those findings `Source: own`.

## Report coverage

Put these lines under Verification in your handoff:

```text
OCR mode      full (MODEL) | delegation | unavailable (REASON)
OCR coverage  N files reviewed, M excluded by OCR (K read by you), F failed (G reviewed by you)
OCR comments  C proposed, K kept, D dropped with evidence
```

The rule that matters most: an OCR comment becomes a finding only after you have seen it hold in the code at the SHA.
