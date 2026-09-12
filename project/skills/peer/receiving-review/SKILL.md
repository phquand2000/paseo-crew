---
name: receiving-review
description: "Respond to review findings: verify each in the code, ask about unclear ones first, push back with evidence, check for real callers before expanding code, fix in new commits per finding. Use when the Lead sends back findings or requested changes."
---

# Receiving review

Use this skill when the Lead returns findings on work you handed off, to turn each finding into a verified fix, a question, or a disagreement backed by evidence.

## Procedure

1. Read every finding before acting on any. Keep the Lead's numbering, or number them F1, F2, and so on. Done when you have one line per finding.
2. Restate each finding as a technical requirement in your own words. One you can't restate is unclear.
3. If any finding is unclear, send your questions before implementing anything, the clear items included, because findings are often related and a partial reading leads to the wrong fix. End the turn with a list such as "Clear: F1, F2, F5. Unclear: F3 (which caller passes null?), F4 (fix here or in the parser?)", and a handoff with Outcome `blocked` and the questions under Unknown / risk. Make no commits in that turn.
4. Verify each finding against the code at your SHA: run the case it describes, read the path, or search for callers. Done when each finding has a verdict (confirmed, partly right, wrong, or can't verify) and the check behind it.
5. Before building something "properly" (a fuller version, more options, a general mechanism), search for real callers:

   ```sh
   git grep -n -w 'SYMBOL' -- . ':(exclude,glob)**/test*/**' ':(exclude,glob)**/spec/**' ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*[._]test.*' ':(exclude,glob)**/*[._]spec.*' ':(exclude,glob)**/test_*'
   ```

   The excludes skip test directories and test files, so a hit is a production caller. If it prints nothing, propose removing it or leaving it as it is, with the search output; the brief didn't ask for unused surface.
6. For each finding you judge wrong, give the evidence: the command and its output, the `path:line`, or the brief line it conflicts with. If a finding contradicts the brief's Decided field, point to both and let the Lead rule, because implementing either reading silently hides the conflict. Give your evidence once; the Lead's ruling decides.
7. For a finding you can't verify because it needs an environment, a port, or data the brief doesn't allow, say what you would need.
8. Fix confirmed findings one at a time, most severe first: breakage and security, then simple fixes, then larger changes. Put each fix in a new commit that names the finding, such as `fix(F3): reject empty tenant id`, and leave the commits you already handed off unamended and unrebased. Run the relevant test after each fix, and the brief's verification commands after the last one. If the brief makes you read-only (an Architect or Scout disposition), give each verdict with its evidence instead of a fix, and commit nothing.
9. If a fix needs paths outside your owned scope, send a `DEPENDENCY_REQUEST` for them instead of editing them.

## How to reply

State the fix or the disagreement, and nothing else: no agreement phrases or thanks ("great catch", "you're right"), because the commit shows that you heard the finding. If you pushed back and then find you were wrong, say so in one line with what you checked, and fix it.

## What goes in the handoff

Add a finding map just above the six fields:

```text
F1  fixed      a1b2c3d  test: tests/tenant_test.py::test_rejects_empty_id
F2  disputed   -        brief Decided says ids are opaque; see src/ids.py:40
F3  question   -        which caller passes a null tenant?
F4  not fixed  -        needs src/auth/; sent DEPENDENCY_REQUEST
```

Snapshot is the new tip SHA. Verification holds the brief's commands, run after the last fix, with their output.
