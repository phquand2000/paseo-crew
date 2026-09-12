---
name: receiving-review
description: "Turn returned findings into verified fixes, questions, or evidence-backed disagreements: one verdict per finding, questions before any commit, a caller search before expanding code, a finding map in the handoff. Use when findings or requested changes come back."
---

# Receiving review

Use this skill when findings on work you handed off come back, to give each one a verdict and a route.

## Procedure

1. Number the findings as the request does, or `F1`, `F2`, and so on, and restate each as a technical requirement in your own words. One you can't restate is unclear.
2. If any finding is unclear, send your questions before implementing anything, the clear items included, because findings are often related and a partial reading leads to the wrong fix. End that turn with a list such as "Clear: F1, F2, F5. Unclear: F3 (which caller passes null?), F4 (fix here or in the parser?)" and a handoff whose Outcome is `blocked`, with the questions under Unknown / risk. Make no commits in it.
3. Give each finding a verdict against the code at your SHA, with the check behind it: `confirmed`, `partly right`, `wrong`, or `can't verify`. Run the case it describes, read the path, or search for callers.
4. Before building something "properly" (a fuller version, more options, a general mechanism), search for real callers:

   ```sh
   git grep -n -w 'SYMBOL' -- . ':(exclude,glob)**/test*/**' ':(exclude,glob)**/spec/**' ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*[._]test.*' ':(exclude,glob)**/*[._]spec.*' ':(exclude,glob)**/test_*'
   ```

   The excludes skip test directories and test files, so a hit is a production caller. If it prints nothing, propose removing the symbol or leaving it as it is, with the search output; the brief didn't ask for unused surface.
5. For each finding you judge wrong, give the evidence once: the command and its output, the `path:line`, or the brief line it conflicts with. A finding that contradicts the brief's Decided / ruled out field goes back with both readings, because implementing either one silently hides the conflict; the ruling that comes back decides.
6. Fix confirmed findings in a commit per finding that names it, such as `fix(F3): reject empty tenant id`. Run the relevant test after each fix, and the brief's verification commands after the last one. Under a read-only disposition, give each verdict with its evidence instead of a fix.

## What goes in the handoff

Add a finding map just above the six fields:

```text
F1  fixed      a1b2c3d  test: tests/tenant_test.py::test_rejects_empty_id
F2  disputed   -        brief Decided says ids are opaque; see src/ids.py:40
F3  question   -        which caller passes a null tenant?
F4  not fixed  -        needs src/auth/; sent DEPENDENCY_REQUEST
```

Snapshot is the new tip SHA. Verification holds the brief's commands, run after the last fix, with their output.
