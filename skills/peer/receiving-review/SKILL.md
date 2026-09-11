---
name: receiving-review
description: "Respond to review findings the Lead returns on your work: verify each finding against the code, raise every unclear item as a question before changing anything, push back with evidence where a finding is wrong, check for real callers before expanding code, and fix in new commits mapped to findings. Use when the Lead sends back findings or requested changes."
---

# Receiving review

Use this skill when the Lead returns findings on work you handed off, to turn each finding into a verified fix, a question, or a disagreement backed by evidence.

## Procedure

1. Read every finding before acting on any of them. Keep the Lead's numbering, or number them F1, F2, and so on. Done when you have a list with one line per finding.
2. Restate each finding as a technical requirement in your own words. A finding you can't restate is unclear.
3. If any finding is unclear, send your questions before implementing anything, the clear items included, because findings are often related and a partial reading leads to the wrong fix. End the turn with a list such as "Clear: F1, F2, F5. Unclear: F3 (which caller passes null?), F4 (fix here or in the parser?)", and a handoff whose Outcome is `blocked` and whose Unknown / risk holds the questions. Make no commits in that turn.
4. Verify each finding against the code at your SHA: run the case it describes, read the path, or search for callers. Record one verdict per finding: confirmed, partly right, wrong, or can't verify. Done when every finding has a verdict and the check behind it.
5. Before building something "properly" (a fuller version, more options, a general mechanism), search for real callers:

   ```sh
   git grep -n 'SYMBOL'
   ```

   If nothing outside the tests calls it, propose removing it or leaving it as it is, and include the search output. Unused surface costs maintenance, and the brief didn't ask for it.
6. For each finding you judge wrong, give the evidence: the command and its output, the `path:line`, or the brief line it conflicts with. If a finding contradicts the brief's Decided field, point to both and let the Lead rule, because implementing either reading silently hides the conflict. Give your evidence once; the Lead's ruling decides.
7. For a finding you can't verify, because it needs an environment, a port, or data the brief doesn't allow, say what you would need.
8. Fix confirmed findings one at a time, most severe first: breakage and security, then simple fixes, then larger changes. Put each fix in a new commit that names the finding, such as `fix(F3): reject empty tenant id`. Leave the commits you already handed off unamended and unrebased, so the Lead can compare the rounds commit by commit. Run the relevant test after each fix, and the brief's verification commands after the last one.
9. If a fix needs paths outside your owned scope, send a `DEPENDENCY_REQUEST` for them instead of editing them.

## How to reply

State the fix or the disagreement, and nothing else. Leave out agreement phrases and thanks ("great catch", "you're right"); the commit shows that you heard the finding. If you pushed back and then find you were wrong, say so in one line with what you checked, and fix it.

## What goes in the handoff

Add a finding map just above the six fields:

```text
F1  fixed      a1b2c3d  test: tests/tenant_test.py::test_rejects_empty_id
F2  disputed   -        brief Decided says ids are opaque; see src/ids.py:40
F3  question   -        which caller passes a null tenant?
F4  not fixed  -        needs src/auth/; sent DEPENDENCY_REQUEST
```

Snapshot is the new tip SHA. Verification holds the brief's commands, run after the last fix, with their output.
