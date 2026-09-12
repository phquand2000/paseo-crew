---
name: reviewing-a-change
description: "Review one commit or range against its brief, read-only: spec and standards as separate axes, structural lenses, every finding with severity, confidence, evidence, and a disconfirming check. Use for every change review, after ocr-review if it runs."
---

# Reviewing a change

Use this skill, read-only, to review one change, identified by SHA, against the brief that produced it, and to report every finding so the Lead can filter them.

## Set up

1. Pin the object: take the SHA from the brief and check that it exists. Keep `"$sha"` quoted: if the variable is empty, `git show` silently shows HEAD.

   ```sh
   git cat-file -e "$sha^{commit}" && git show --stat "$sha"
   ```

   For a range, use `git log --oneline "$base..$sha"` and `git diff "$base" "$sha"`. Done when the file list matches the change you were asked to review.
2. Read the change from git objects: `git show "$sha"` for the diff, and `git show "$sha:PATH"` for whole files.
3. Collect the spec: the originating brief's Objective, Decided / ruled out, Owned scope, and Verification, as your review brief supplies them. If none is available, skip the spec axis and say so.
4. Collect the standards: the repository's `AGENTS.md`, any files it names as rules, and the baseline below.
5. Read outward from the diff to the callers and consumers of every changed symbol, at the same commit, with `git grep -n 'SYMBOL' "$sha"`; bugs often sit in an unchanged caller the change broke. Done when you know every production caller of each changed public symbol.

## Spec axis

Check each requirement in the brief, quote the brief line each finding answers to, and sort what you find:

- Missing or partial: asked for and not done, or done for some cases only.
- Scope creep: done but not asked for, including files outside the owned scope. Compare `git show --stat "$sha"` with the owned-scope globs.
- Wrong: looks implemented but behaves incorrectly. Probe boundaries (0, empty, null, maximum), error and cleanup paths, ordering and concurrency, and resource lifetime. When the change alters a contract (a signature, route, schema, field, or file format), check that every shipping producer, consumer, and generated artifact changed with it; one left on the old shape breaks at runtime.

## Standards axis

- Documented rules: each place the diff breaks an `AGENTS.md` rule, quoting the rule. These can be hard violations.
- Baseline smells, always judgment calls. A documented repository rule overrides them, and anything a linter or formatter already enforces stays out:
  - a name that hides what the thing does or holds;
  - the same logic shape in more than one hunk;
  - a function that works mostly on another module's data;
  - the same few parameters always travelling together;
  - a string or number standing in for a domain concept;
  - the same switch on the same type in several places;
  - one logical change forcing edits across many files;
  - hooks, parameters, or layers for needs the brief doesn't have;
  - a layer that only forwards calls;
  - a production symbol whose only callers are tests;
  - a small contract change that edits or turns red many tests, which suggests those tests mint the API (they use names production code lacks).

Keep the two axes in separate lists, and don't rank findings across them: code can follow every rule and implement the wrong thing, and a merged list lets one axis hide the other.

## Structure

If the change adds a wrapper, adapter, cache, retry, fallback, flag, or layer, touches a hot path, cites a proof, or names an outcome such as reconcile or idempotent, apply the lenses in `references/structural-lenses.md` (relative to this skill's directory). Report what they turn up under a third heading, Structure.

## Findings

Mark a finding material when it could change the result, the route, a boundary, or confidence in the change. Use this block for each finding:

```text
F1          P0-P3, confidence high | medium | low, material yes | no
Axis        spec | standards | structure
Where       path:line at SHA
Evidence    what the code does (quote at most five lines)
Contract    the brief line, AGENTS.md rule, or invariant it breaks
Failure     what goes wrong, for whom, under which input or timing
Fix         the smallest durable fix
Disconfirm  a read-only check that would show this finding is wrong
Source      ocr | own
```

Severity:

- P0: data loss, a security hole, a broken build or main path, or harm that is hard to reverse.
- P1: wrong behavior in a realistic case, or a brief requirement missing.
- P2: an edge-case bug, weak proof, or a maintenance cost with a concrete consequence.
- P3: naming, style, or a smell with a minor consequence.

Confidence is high when you traced or ran it, medium when the code strongly suggests it, and low when it is plausible but untraced.
