---
name: reviewing-a-change
description: "Reviews one commit or range against its brief without changing anything: the review tool for scope and standing rules, spec and standards as separate axes, structural lenses when the change adds machinery, and every finding with severity, confidence, evidence and a disconfirming check. Use for every change review."
---

# Reviewing a change

You review one change, pinned by SHA, against the brief that produced it, and report every finding so the Lead can rule on them.

## Set up

1. **Pin the object.** Keep `"$sha"` quoted: empty, `git show` silently shows HEAD.

   ```sh
   git cat-file -e "$sha^{commit}" && git show --stat "$sha"
   ```

   For a range use `git log --oneline "$base..$sha"` and `git diff "$base" "$sha"`.
2. **Ask the review tool for scope and rules.** It runs no model and writes nothing:

   ```sh
   ocr delegate preview --commit "$sha" --format json
   ocr delegate rule --commit "$sha" --format json PATH_FROM_PREVIEW...
   ```

   `preview` returns `reviewable_files` and `excluded_files` with an `exclude_reason` each; `rule` takes those reviewable paths (skip it when there are none) and returns rule `groups`, each a file pattern, its files and the rule text. For a range pass `--from BASE --to "$sha"`; add `--rule FILE` when the repository ships its own rule set. An excluded file is the tool's extension filter, not a verdict: review it from `git show --stat` anyway. Without `ocr`, say so in one line and take the files from `git show --stat`.
3. **Read** the diff with `git show "$sha"` and whole files with `git show "$sha:PATH"`, then outward to every production caller of each changed symbol with `git grep -n 'SYMBOL' "$sha"`: bugs often sit in an unchanged caller the change broke.
4. **Collect** the spec (the originating brief's Objective, Decided / ruled out, Owned scope and Verification; without one, skip the spec axis and say so) and the standards (`AGENTS.md` and the files it names as rules).

## Spec axis

Check each requirement, quoting the brief line each finding answers to:

- **Missing or partial:** asked for and not done, or done for some cases.
- **Scope creep:** done but not asked for, including files outside the owned scope.
- **Wrong:** looks implemented but misbehaves. Probe boundaries (0, empty, null, maximum), error and cleanup paths, ordering, concurrency and resource lifetime. A changed contract must change every shipping producer, consumer and generated artifact with it.

## Standards axis

- **Documented rules:** each break of an `AGENTS.md` rule, quoting the rule.
- **Tool rules:** answer each group's rule text against its files, "no finding" included, naming the code each answer rests on. A group is a standing question, not a finding.
- **Smells,** judgment calls a documented rule overrides: a name that hides what it holds, duplicated logic, a primitive standing in for a domain concept, a layer that only forwards calls, hooks for needs the brief doesn't have, a production symbol only tests call, and a small contract change that turns many tests red, which suggests tests that mint the API.

Keep the two axes as separate lists and don't rank across them: code can follow every rule and implement the wrong thing.

## Structure

When the change adds a wrapper, adapter, cache, retry, fallback, flag or layer, touches a hot path, cites a proof, or names an outcome such as reconcile or idempotent, apply [references/structural-lenses.md](references/structural-lenses.md) and report under a third heading, Structure.

## Findings

A finding is material when it could change the result, the route, a boundary, or confidence in the change.

```text
F1          P0-P3, confidence high | medium | low, material yes | no
Axis        spec | standards | structure, and the rule group when a tool rule raised it
Where       path:line at SHA
Evidence    what the code does (quote at most five lines)
Contract    the brief line, AGENTS.md rule, or invariant it breaks
Failure     what goes wrong, for whom, under which input or timing
Fix         the smallest durable fix
Disconfirm  a read-only check that would show this finding is wrong
```

P0 is data loss, a security hole, a broken build or main path, or hard-to-reverse harm; P1 wrong behavior in a realistic case or a missing requirement; P2 an edge-case bug, weak proof, or a maintenance cost with a concrete consequence; P3 naming, style, or a minor smell. Confidence is high only for what you traced or ran.

## Ends in

The handoff your prompt describes, with the excluded files and their reasons under Verification as the coverage ledger.
