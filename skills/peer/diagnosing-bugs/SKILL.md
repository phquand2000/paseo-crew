---
name: diagnosing-bugs
description: "Find and fix the root cause of a bug: build a fast command that fails on this exact bug, shrink the repro, rank falsifiable hypotheses, trace the bad value back to where it starts, and fix it with a regression test at a seam that reaches the real pattern. Use when a brief reports a failure, wrong output, crash, flaky test, or regression."
---

# Diagnosing bugs

Use this skill to go from a reported symptom to a confirmed cause and a fix, with a command that shows the bug before the fix and its absence after.

Work through the sections in order, because each one feeds the next.

## Get a red command

Build one command that fails on this bug before you form theories from reading code:

1. Pick the cheapest way to reach the bug. In rough order of preference:
   - a failing test at a seam that reaches the bug;
   - a CLI run with a fixture input, diffed against the expected output;
   - a script against a running dev server, if the brief allows a port;
   - a replay of a captured request, payload, or log through the code path;
   - a small harness that calls the failing path directly;
   - a loop or random-input run, for output that is only sometimes wrong;
   - a `git bisect run` script, when the bug appeared between two known commits;
   - the same input through the old and new version, with the outputs diffed.
2. Tighten it: make it take seconds, make it deterministic (fix the clock, seed randomness, isolate the filesystem), and make it assert the reported symptom rather than "didn't crash". For an intermittent bug, raise the reproduction rate (repeat it 100 times, add load or delays) until it fails often enough to test against.

Done when you have run the command at least once, it fails with the symptom from the brief, and you can paste the invocation and its output. Replace any secret in pasted output with `<REDACTED>`.

If you can't build one, report `BLOCKED`: list what you tried and what would unblock you, such as access to an environment that reproduces the bug, a captured artifact, or permission for temporary instrumentation. Hypotheses without a red command are guesses.

## Reproduce and shrink

1. Confirm the command shows the reported failure and not a different one nearby, because a fix for the neighbor leaves the bug in place.
2. Check what changed recently with `git log --oneline -20 -- PATHS`, and use `git bisect` if you know a good commit.
3. Cut inputs, config, callers, data, and steps one at a time, rerunning after each cut. Done when removing any remaining element turns the command green.

## Rank hypotheses

Write three to five hypotheses before you test any, so the first plausible idea doesn't anchor you. Give each one a prediction: "if X is the cause, then changing Y makes the failure disappear." Sharpen or drop any hypothesis that has no prediction.

Rank them by likelihood, then run the cheapest check that separates the top candidates. Keep the list with each result; it goes into the handoff.

## Trace backward

When the error appears deep in a call chain, the line that throws usually shows where the damage surfaced, not where it started. Trace it back:

1. Find the code that directly produced the bad value or state.
2. Find its caller, and the value that caller passed.
3. Repeat until you reach the point where the value first became wrong. That is the original trigger, and the fix belongs there; a guard at the symptom hides the bug from every other caller.

Use a debugger or REPL first. Otherwise, log at the boundaries that separate your hypotheses, and capture a stack before the failing operation, for example with `console.error(new Error().stack)` or `traceback.print_stack()`. Compare with a similar path in the same codebase that works, and list every difference.

## Instrument with one marker

Tag every temporary debug line with one marker unique to this task, such as `DEBUG-7f3a`, and change one variable per probe. Done before handoff when this prints nothing:

```sh
git grep -n 'DEBUG-7f3a'
```

For a performance regression, logs mislead. Measure a baseline and bisect instead, as the performance-change skill describes.

## Fix with a regression test

1. Decide whether a correct seam exists: one where a test reproduces the bug pattern as it happens at the call site, with the real callers or chain. If the only seam available is too shallow, such as a single-caller unit test for a bug that needs two callers, a test there gives false confidence. Report "no correct seam for a regression test" under Unknown / risk as a finding, with the reason, and go to step 4.
2. Turn the shrunken repro into a test at that seam, and watch it fail.
3. Apply one fix, at the source you traced to, and watch the test pass. Then revert the fix and watch the test fail; restore the fix and watch it pass. This shows the test catches this bug.
4. Rerun the original, unshrunk red command. Done when it passes and the brief's verification commands pass.
5. Remove throwaway harnesses and debug lines, and commit. Put the confirmed cause in the commit message, so the next person debugging this path finds it.

## When fixes keep failing

After a failed fix, go back to your hypotheses with what it taught you, rather than stacking another fix on top.

After the third failed fix on the same symptom, stop patching and look for the mechanism that produces the whole chain. Each fix exposing new coupling somewhere else, or needing a large refactor, points to a structural cause. If that mechanism lies inside your owned scope, fix it there with a regression test. If it lies outside, send a `REOPEN_REQUEST` that names the layer you are reopening, the mechanism you suspect, and the three fixes with what each one revealed.

If the evidence shows the cause is environmental, timing-dependent, or external, say so and list what you checked. A retry or timeout added without that statement hides the bug.

## What goes in the handoff

- Verification: the red command before and after the fix, and the regression test's fail, pass, revert-fail, pass sequence.
- Unknown / risk: the confirmed cause with its evidence, the hypotheses you ruled out and how, and a missing regression seam if there was one.
