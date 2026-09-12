---
name: proof-audit
description: "Audit whether a test, validator, benchmark, or gate proves its cited behavior: what it observes, where expected values come from, whether it fails on revert, and a disposition. Use when a brief asks if a proof is real, or before citing one you doubt."
---

# Proof audit

Use this skill to decide whether a proof demonstrates the behavior it is cited for, and whether to keep, replace, demote, closeout-only, delete, or escalate it.

Audit the claims and proofs the brief names; list other suspects under Unknown / risk instead of widening the audit. For a broad audit the brief asks for, or for replacement examples, read `references/proof-debt-catalog.md` (relative to this skill's directory).

## Procedure

For each proof:

1. State the claim in one sentence as production behavior. Done when you can cite the production code that makes it true as `path:line`.
2. Identify the proof: its name, its `path:line`, and the command that runs it.
3. Classify what it observes: executed behavior, a machine-readable contract (parsed output, a schema, an exit code), performance on a measured path, or a proxy (source text, names, prose, registration, report shape, log lines). A proxy can support lint or closeout, never runtime behavior.
4. Check where the expected values come from: a literal, a worked example, the spec, or an independently owned source. Values computed by the code under test, copied from its own output, or kept in a golden file the same code regenerates pass whatever the code does.
5. Check for history: a current test that names a retired width, tag, field, version, byte sequence, or identifier only to prove it is rejected is proof debt, unless that value is still a current public or security contract. Ask whether someone could write the test from the current contract alone, without git history.
6. Check boundaries: a mock, replica, or fixture proves only its own boundary unless the claim is about that boundary. A benchmark proves only the path it measures, so compare that path with the claimed one.
7. Run the deletion test as a red-green-revert sequence:
   1. Run the proof on the change. Expect green.
   2. Revert the fix, or disable the behavior by stubbing the branch or skipping the call, and run again. Expect red.
   3. Restore the fix and run again. Expect green.

   Done when you have all three outputs. If the second run stays green, the proof proves nothing about this claim.
8. Choose a disposition from the table below, and name the smallest change that carries it out.

If the brief makes you read-only, run step 7 in a scratch copy outside the repository, and commit nothing. When you are read-only, `git apply` and the file tools are blocked, so revert with `patch`. `$base` is the commit before the change (`"$sha^"` for a single commit). `PATHS` are the fix's production files, so the proof itself stays in place:

```sh
tmp=$(mktemp -d)
git archive "$sha" | tar -x -C "$tmp"
git diff "$base" "$sha" -- PATHS | patch -R -p1 -d "$tmp"
git diff "$base" "$sha" -- PATHS | patch -p1 -d "$tmp"
```

Run the proof in `$tmp` after the second line (expect green), after the third (expect red), and after the fourth (expect green). If the scratch copy can't run (missing dependencies, services, or build steps), reason through step 7 instead, and mark it "not executed" with the reason.

## Dispositions

| Disposition | When it applies |
|---|---|
| keep | It observes the claimed behavior, fails when the behavior is gone, and its expected values are independent. |
| replace | The claim deserves proof this one doesn't give. Name the replacement, such as current-boundary cases (`WIDTH - 1`, `WIDTH + 1`), or an executed run instead of a source scan. |
| demote | Useful as lint, a diagnostic, or a review aid, not as proof of this claim. Rename it for what it is, and take it out of any gate that treats it as proof. |
| closeout-only | Evidence for a one-time change such as a migration or hard cut. Record the result in the handoff instead of keeping a permanent test. |
| delete | It proves nothing current: an absence check for a retired name, a mirror of its own output, a report-shape check. |
| escalate | The decision needs something outside your scope: an unsettled contract, no observable production seam, or a fix that would redesign production code. Report `BLOCKED`, or send a `REOPEN_REQUEST` naming the `verification` layer. |

Replace, demote, or delete a weak proxy; adding strings or patterns to it makes it harder to remove without making it prove more. Weak proof is not a license to redesign production code. Change a proof only when the brief puts it in your owned scope; otherwise report and stop.

## Report

Write one block per proof, in your final message ahead of the handoff:

```text
Proof          path:line, command
Claim          the behavior, and path:line of the code that makes it true
Observes       behavior | contract | performance | proxy
Expected from  literal | spec | independent source | code under test | own output
Deletion test  red after revert: yes | no | not executed (reason)
Disposition    keep | replace | demote | closeout-only | delete | escalate
Smallest fix   the replacement, or none
Would change   the observation that would reverse this verdict
```

Put the red-green-revert commands and their output under Verification, and escalations under Unknown / risk. If the report runs past the handoff's length budget, write it to a file outside the repository and give its path.
