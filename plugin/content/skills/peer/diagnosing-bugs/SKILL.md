---
name: diagnosing-bugs
description: "Takes a reported failure to a confirmed cause and a fix: a red command first, ranked hypotheses with predictions, a trace back to where the value first went wrong, and a regression test at a real seam. Use when a brief reports a failure, crash, flake, or regression whose cause is unknown."
---

# Diagnosing bugs

You go from a symptom to its cause, and prove the fix with a command that fails before it and passes after. When the brief asks only for the cause, or gives you no owned paths, stop after tracing it.

## 1. Get a red command

Build one command that fails with the reported symptom before you theorize: a failing test at a seam that reaches the bug, a CLI run on a fixture diffed against expected output, a replay of a captured request, a small harness, or `git bisect run` when the bug appeared between two known commits. Make it fast, deterministic (fixed clock, seeded randomness, isolated files) and assert the symptom, not "didn't crash".

For an intermittent failure, rerun it alone until you know its rate. If it fails only while another process holds the same port or test database, report the collision in `done` and change nothing; otherwise it is a race, order dependence or shared state, and you raise its rate until you can test against it.

If you can't build one, call `done` with outcome blocked, what you tried in the summary and what would unblock you in `leftUndone`. A hypothesis without a red command is a guess.

## 2. Shrink it

Check it shows the reported failure, not a neighbor, then cut inputs, config, callers and steps one at a time. Done when removing anything else turns it green.

## 3. Rank hypotheses

Write three to five before testing any, so the first idea doesn't anchor you. Each carries a prediction: "if X is the cause, changing Y makes it disappear". Run the cheapest check that separates the top two, and keep the list with its results.

## 4. Trace backward

The line that throws is where the damage surfaced. Walk from the bad value to its caller, and its caller's caller, to where the value first went wrong; the fix belongs there, because a guard at the symptom hides the bug from every other caller. Prefer a debugger or REPL; tag any temporary debug line with one unique marker and `git grep` for it before `done`. For a performance regression, bisect against a measured baseline instead of reading logs.

## 5. Fix with a regression test

Put the shrunk repro in a test at a seam that has the real callers, watch it fail, fix at the source, watch it pass; then revert the fix to see it fail again, and restore it. If the only seam is too shallow to reproduce the bug honestly, say so in `leftUndone` rather than writing a test that gives false confidence. Rerun the original red command, and commit with the cause in the message.

After the third failed fix on one symptom, stop patching and look for the mechanism behind the chain; outside your owned paths, `ask` your lead, naming the mechanism and what each fix revealed. A cause you judge environmental or timing-dependent is stated with what you checked; a retry or timeout added without that statement hides the bug.

## Ends in

`done` with: in the summary, the confirmed cause with its evidence and the hypotheses you ruled out; in `checks`, the red command before and after the fix and the regression test's result.
