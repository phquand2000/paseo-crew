---
name: diagnosing-bugs
description: "Find and fix a bug's root cause: a fast failing command, a shrunk repro, ranked hypotheses, a trace to where the bad value starts, a regression test at a real seam. Use when a brief reports a failure, wrong output, crash, flaky test, or regression."
---

# Diagnosing bugs

Use this skill to go from a reported symptom to a confirmed cause and a fix, with a command that shows the bug before the fix and its absence after. Work the sections in order; each feeds the next. If the brief makes you read-only (an Architect or Scout disposition), or asks only for the cause, stop after Trace backward. Probe with a debugger or REPL instead of debug lines, report the cause with its evidence, change no code, and commit nothing.

## Get a red command

Build one command that fails on this bug before you form theories from the code:

1. Pick the cheapest route to the bug, roughly in this order:
   - a failing test at a seam that reaches it (if the test was already red when you started, check it first with test-first's Before the first test, step 3);
   - a CLI run on a fixture input, diffed against the expected output;
   - a script against a dev server, if the brief allows a port;
   - a replay of a captured request, payload, or log through the code path;
   - a small harness that calls the failing path directly;
   - a loop or random-input run, for output that is only sometimes wrong;
   - a `git bisect run` script, when the bug appeared between two known commits;
   - the same input through the old and new version, with the outputs diffed.
2. Make it take seconds, make it deterministic (fix the clock, seed randomness, isolate the filesystem), and make it assert the reported symptom, not "didn't crash".
3. For an intermittent failure, rerun the failing test alone about 20 times, for example `for i in $(seq 20); do TEST_CMD || echo "failed run $i"; done`. Call it a lane collision only when it fails solely while another agent uses the same port or test database, for example when `lsof -i :PORT` shows a process you didn't start. Report a collision and change no code. Otherwise diagnose it as a bug: usually a race, an order dependence, or shared state. Raise the failure rate (100 repeats, a shuffled test order, added load or delays) until you can test against it.

Done when you have run it, it fails with the symptom from the brief, and you can paste the invocation and output, with any secret replaced by `<REDACTED>`.

If you can't build one, report `BLOCKED` with what you tried and what would unblock you: an environment that reproduces the bug, a captured artifact, or permission for temporary instrumentation. Hypotheses without a red command are guesses.

## Reproduce and shrink

1. Confirm the command shows the reported failure, not a nearby one; a fix for the neighbor leaves the bug in place.
2. Check recent changes with `git log --oneline -20 -- PATHS`, and use `git bisect` if you know a good commit.
3. Cut inputs, config, callers, data, and steps one at a time, rerunning after each cut. Done when removing any remaining element turns the command green.

## Rank hypotheses

Write three to five hypotheses before testing any, so the first plausible idea doesn't anchor you. Give each a prediction: "if X is the cause, changing Y makes the failure disappear." Sharpen or drop any without one. Rank them by likelihood, run the cheapest check that separates the top candidates, and keep the list with each result for the handoff.

## Trace backward

When the error appears deep in a call chain, the line that throws usually shows where the damage surfaced, not where it started. Trace it back:

1. Find the code that directly produced the bad value or state.
2. Find its caller, and the value that caller passed.
3. Repeat until you reach the point where the value first became wrong. That is the original trigger, and the fix belongs there; a guard at the symptom hides the bug from every other caller.

Use a debugger or REPL first. Otherwise, log at the boundaries that separate your hypotheses, and capture a stack before the failing operation, such as `console.error(new Error().stack)` or `traceback.print_stack()`. Compare with a similar working path in the same codebase, and list every difference.

## Instrument with one marker

Tag every temporary debug line with one marker unique to this task, such as `DEBUG-7f3a`, and change one variable per probe. Done before handoff when this prints nothing:

```sh
git grep -n 'DEBUG-7f3a'
```

For a performance regression, logs mislead. Measure a baseline as the performance-change skill describes. Then `git bisect run` a script that fails when the measurement exceeds the baseline by more than its spread.

## Fix with a regression test

1. Decide whether a correct seam exists: one where a test reproduces the bug pattern as it happens at the call site, with the real callers or chain. If the only seam is too shallow, such as a single-caller unit test for a bug that needs two callers, a test there gives false confidence: report "no correct seam for a regression test" under Unknown / risk as a finding, with the reason, and go to step 4.
2. Turn the shrunk repro into a test at that seam, and watch it fail.
3. Apply one fix at the source you traced to, and watch the test pass. Revert the fix and watch it fail; restore it and watch it pass. This shows the test catches this bug.
4. Rerun the original, unshrunk red command. Done when it and the brief's verification commands pass.
5. Remove throwaway harnesses and debug lines, and commit. Put the confirmed cause in the commit message, so the next person debugging this path finds it.

## When fixes keep failing

After a failed fix, return to your hypotheses with what it taught you instead of stacking another fix on top.

After the third failed fix on the same symptom, stop patching and find the mechanism that produces the whole chain; fixes that expose new coupling elsewhere, or need a large refactor, point to a structural cause. If that mechanism is inside your owned scope, fix it there with a regression test. If it is outside, send a `REOPEN_REQUEST` naming the layer you are reopening, the mechanism you suspect, and the three fixes with what each revealed.

If the evidence shows the cause is environmental, timing-dependent, or external, say so and list what you checked; a retry or timeout added without that statement hides the bug.

## What goes in the handoff

- Verification: the red command before and after the fix, and the regression test's fail, pass, revert-fail, pass sequence.
- Unknown / risk: the confirmed cause with its evidence, the hypotheses you ruled out and how, and a missing regression seam if there was one.
