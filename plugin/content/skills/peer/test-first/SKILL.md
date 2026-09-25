---
name: test-first
description: "Puts evidence before behavior: chooses the proof that fits the change, settles the contract a test may use, then adds behavior one failing test at a time at a settled seam. Use when a brief changes behavior, fixes a bug whose cause is known, or refactors or splits code that must keep behaving the same, and its contract is settled. Not for a failure whose cause is unknown, which is diagnosing-bugs."
---

# Test-first

The rule that matters most: settle the contract, see the test fail at the seam, then write the code. A test you never saw fail proves nothing, and a test that invents the contract becomes the spec.

No behavior changes without evidence you produced first, and no test pins what acceptance doesn't name. When the brief asks only for the proof, report it and the seam you would use and commit nothing.

## 1. Choose the proof

| Change | Evidence before you change code |
|---|---|
| Bug or regression | a failing repro of the reported symptom; see `diagnosing-bugs` |
| New behavior at a seam | a failing test through the seam: the loop below |
| Protocol, wire or schema | a failing round-trip test on real records or bytes |
| Refactor, no behavior change | the existing tests; where weak, characterization tests at the seam, never one per moved helper |
| Wrapper, adapter or bridge | proof at the owner seam it serves; a direct test only when the layer itself translates, retries, caches or falls back |
| Performance | a benchmark baselined over enough runs to show its spread; correctness proven separately |
| Visual, layout or copy | a render or accessibility check where the repository has one, never a unit test for CSS or wording |
| Docs, config, mechanical edit | the smallest check that the artifact is valid |

## 2. Settle the seam and the contract

1. **Seam.** An interface the brief names, or an existing public entry point, and what a caller observes there, in one line such as `parseHeader(bytes) -> Header | ParseError`. With neither, `ask` your lead with the candidates: a test at a guessed seam makes your guess the contract.
2. **Contract.** Every type, field, function, route and table a test uses must exist in production code at `BASE` (the commit your brief says your task started from; in a working copy of your own, `git merge-base HEAD` with the branch your task branched from) or be named in the brief. This search skips test files:

   ```sh
   git grep -n -w 'NAME' "$BASE" -- . ':(exclude,glob)**/test*/**' ':(exclude,glob)**/spec/**' ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*[._]test.*' ':(exclude,glob)**/*[._]spec.*' ':(exclude,glob)**/test_*'
   ```

   A missing name is a minted API: the test decides the contract, and the next change bends code to fit it. `ask` with the names. For a name the brief defines that doesn't exist yet, declare its signature first, so the test fails on an assertion rather than an import.
3. **Baseline.** Run the fastest single-file test command on the unchanged code, so any later red is yours. A test already red, or that the brief asks you to make pass, gets the same contract check; one that mints an API or pins retired behavior goes to `ask` with its `path:line`.
4. List the behaviors to add, one sentence each in a caller's words, before writing any test.

## 3. The loop

For each behavior:

1. Write one test through the seam's public interface. Take the expected value from a literal, a worked example or the spec, never from the code under test; if hard-coding that value would pass, add a second example with different values.
2. Run it and see it fail on an assertion that the behavior is missing. A pass means it can't fail; an import or fixture error is not the right red.
3. Write the least production code that implements the rule: no branch no test asked for, no special case for the test's inputs.
4. Tidy without adding behavior and rerun. Commit as you go; the work only has to pass when the whole task is done.

Add no API, flag, state or constructor whose only consumer is a test, and blur no boundary to ease testing. A test that is hard to write is design feedback: huge setup means the interface is too wide. The check may be wrong and the code right: name the disagreement in `done` rather than reshaping the code until the check agrees; the brief settles the contract, a check never does. A slice showing the contract itself is wrong: stop and `ask`.

When the brief changes or removes a contract (a signature, route, schema, field or file format), follow [references/contract-changes.md](references/contract-changes.md). The rule that never waits: every shipping producer, consumer and generated artifact changes in the same commit.

## 4. Before done

Check every test you wrote against [references/test-antipatterns.md](references/test-antipatterns.md) row by row; from memory, the costly rows get skipped. Then ask: would a wrong constant, a swapped branch, a missing side effect or a hard-coded return fail some test? Add the test when the behavior is in acceptance or risky, else put the gap in `done`'s `leftUndone`, with the proof you chose in its `checks`.
