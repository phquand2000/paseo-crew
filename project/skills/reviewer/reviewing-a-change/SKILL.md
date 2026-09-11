---
name: reviewing-a-change
description: "Review one commit or range against its brief, read-only: read the diff from git objects, check spec conformance and repository standards as separate axes, apply structural lenses, and report every finding with severity, confidence, file:line evidence, failure mode, smallest fix, and a disconfirming check. Use for every review of a change, after the ocr-review pass when one runs."
---

# Reviewing a change

Use this skill, read-only, to review one change identified by SHA against the brief that produced it, and to report every finding so the Lead can filter them.

## Set up

1. Pin the object. Take the SHA from the brief and check that it exists. Keep `"$sha"` quoted: if the variable is empty, `git show` silently shows HEAD.

   ```sh
   git cat-file -e "$sha^{commit}" && git show --stat "$sha"
   ```

   For a range, use `git log --oneline "$base..$sha"` and `git diff "$base" "$sha"`. Done when the file list matches the change you were asked to review.
2. Read the change from git objects: `git show "$sha"` for the diff, and `git show "$sha:PATH"` for whole files. The working tree may hold someone else's uncommitted edits or later commits.
3. Collect the spec: the originating brief's Objective, Decided / ruled out, Owned scope, and Verification, as your review brief supplies them. If none is available, skip the spec axis and say so.
4. Collect the standards: the repository's `AGENTS.md`, any files it names as rules, and the baseline below.
5. Read outward from the diff to the callers and consumers of every changed symbol, at the same commit, with `git grep -n 'SYMBOL' "$sha"`. Bugs often sit in an unchanged caller that the change broke. Done when you know every production caller of each changed public symbol.

Run only the commands your review brief's Verification field allows, because builds and tests can write to the working tree.

## Spec axis

Check each requirement in the brief, and sort what you find:

- Missing or partial: asked for and not done, or done for some cases only.
- Scope creep: done but not asked for, including files outside the owned scope. Compare `git show --stat "$sha"` with the owned-scope globs.
- Wrong: looks implemented but behaves incorrectly. Probe boundaries (0, empty, null, maximum), error and cleanup paths, ordering and concurrency, and resource lifetime.

Quote the brief line each finding answers to.

## Standards axis

- Documented rules: each place the diff breaks an `AGENTS.md` rule, quoting the rule. These can be hard violations.
- Baseline smells, which are always judgment calls. A documented repository rule overrides the baseline, and anything a linter or formatter already enforces stays out:
  - a name that hides what the thing does or holds;
  - the same logic shape in more than one hunk;
  - a function that works mostly on another module's data;
  - the same few parameters always travelling together;
  - a string or number standing in for a domain concept;
  - the same switch on the same type in several places;
  - one logical change forcing edits across many files;
  - hooks, parameters, or layers for needs the brief doesn't have;
  - a layer that only forwards calls;
  - a production symbol whose only callers are tests.

Keep the two axes in separate lists, and don't rank findings across them. Code can follow every rule and implement the wrong thing, or implement the right thing against every rule; merging the lists lets one axis hide the other.

## Structure

If the change adds a wrapper, adapter, cache, retry, fallback, flag, or layer, touches a hot path, or cites a proof, read `references/structural-lenses.md` and apply its lenses; the path is relative to this skill's directory. Report what they turn up under a third heading, Structure.

## Findings

Report every finding, including low-severity and low-confidence ones; the Lead does the filtering. Mark a finding material when it could change the result, the route, a boundary, or confidence in the change. "No material findings" is a valid result, and a finding made up to look thorough costs the Lead a verification round.

Use this block for each finding:

```text
F1          P0-P3, confidence high | medium | low, material yes | no
Axis        spec | standards | structure
Where       path:line at SHA
Evidence    what the code does (quote at most five lines)
Contract    the brief line, AGENTS.md rule, or invariant it breaks
Failure     what goes wrong, for whom, under which input or timing
Fix         the smallest durable fix
Disconfirm  a read-only check that would show this finding is wrong
```

Severity:

- P0: data loss, a security hole, a broken build or main path, or harm that is hard to reverse.
- P1: wrong behavior in a realistic case, or a brief requirement missing.
- P2: an edge-case bug, weak proof, or a maintenance cost with a concrete consequence.
- P3: naming, style, or a smell with a minor consequence.

Confidence is high when you traced or ran it, medium when the code strongly suggests it, and low when it is plausible but untraced.

## Final message

Give the findings under Spec, Standards, and Structure. Add one line per axis with its finding count and its worst finding, and one line with the strongest reason not to accept yet, or "No material findings". End with the handoff: omit Snapshot, list the SHA and every file you read under Scope, and put the commands you ran under Verification.
