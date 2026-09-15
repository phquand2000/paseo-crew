---
name: test-first
description: "Puts evidence before behavior: chooses the proof that fits the change, settles the contract a test may use, then adds behavior one failing test at a time at a settled seam. Use when a brief changes behavior, fixes a bug, or refactors and its contract is settled."
---

# Test-first

No behavior changes without evidence you produced before the change. You choose that proof, and when it is a test you settle the contract, watch the test fail at the seam, then write the code. Tests prove the brief's acceptance behaviors and the risky parts (money, state changes, permissions, migrations, concurrency); they pin nothing the acceptance doesn't name. With no owned paths, report the proof and seam you would use and commit nothing.

## 1. Choose the proof

| Change | Evidence before you change code |
|---|---|
| Bug or regression | a failing repro of the reported symptom; see `diagnosing-bugs` |
| New behavior at a seam | a failing test through the seam: the loop below |
| Protocol, wire or schema | a failing round-trip test on real records or bytes |
| Refactor, no behavior change | the existing tests; where weak, characterization tests at the seam, never one per moved helper |
| Wrapper, adapter or bridge | proof at the long-lived owner seam it serves; a direct test only when the layer itself translates, retries, caches, falls back, or outlives the plan |
| Performance | a benchmark baselined over enough runs to show its spread; correctness proven separately |
| Visual, layout or copy | a render or accessibility check where the repository has one; no unit tests for CSS or wording |
| Docs, config, mechanical edit | the smallest check that the artifact is valid |

## 2. Settle the seam and the contract

1. **Seam.** An interface the brief's Acceptance or Context names, or an existing public entry point, and what a caller observes there, in one line such as `parseHeader(bytes) -> Header | ParseError`. If neither exists, or `AGENTS.md` marks the seam decide-first and it is undecided, `ask` your lead with the candidates: a test at a guessed seam makes your guess the contract.
2. **Contract.** Every type, field, function, route and table a test uses must exist in production code at `BASE` (`git merge-base HEAD` with the branch your task branched from) or be named in the brief. This search skips test files:

   ```sh
   git grep -n -w 'NAME' "$BASE" -- . ':(exclude,glob)**/test*/**' ':(exclude,glob)**/spec/**' ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*[._]test.*' ':(exclude,glob)**/*[._]spec.*' ':(exclude,glob)**/test_*'
   ```

   A missing name is a minted API: the test decides the contract, and the next change bends code to fit it. `ask` with the names. For a name the brief defines that doesn't exist yet, declare its signature first, so the test fails on an assertion rather than an import.
3. **Baseline.** Run the fastest single-file test command on the unchanged code, so any later red is yours. A test that is already red, or that the brief asks you to make pass, gets the same contract check first, and its expected values must trace to the brief, `AGENTS.md` or a spec; one that mints an API or pins retired behavior goes to `ask` with its `path:line`.
4. List the behaviors to add, one sentence each in a caller's words, before writing any test.

## 3. The loop

For each behavior:

1. Write one test through the seam's public interface. Take the expected value from a literal, a worked example or the spec, never from the code under test; if hard-coding that value would pass, add a second example with different values.
2. Run it and see it fail on an assertion that the behavior is missing. A pass means it can't fail; an import or fixture error is not the right red.
3. Write the least production code that implements the rule: no option or branch no test asked for, no special case for the test's inputs, no guess from signals that only hold in the fixtures.
4. Tidy without adding behavior, rerun, and commit when the slice stands on its own.

Production code serves production: add no API, flag, state or constructor whose only consumer is a test, and don't make production slower or blur a boundary to ease testing. A test that is hard to write is design feedback: huge setup means the interface is too wide, and an expected value you can't state without reading the implementation means the contract isn't settled. If a slice shows the contract itself is wrong, stop and `ask`, naming the contract and what the slice showed.

When the brief changes or removes a contract (a signature, route, schema, field or file format), follow [references/contract-changes.md](references/contract-changes.md). The rule that never waits: every shipping producer, consumer and generated artifact changes in the same commit.

## 4. Before done

Open [references/test-antipatterns.md](references/test-antipatterns.md) and check every test you wrote against it row by row; from memory, the costly rows get skipped. Then ask of your code: would a wrong constant, a swapped branch, a missing side effect or a hard-coded return fail some test? Add the test when the behavior is in acceptance or risky, or list the gap.

## Ends in

`done` with: in `checks`, the proof you chose and the commands the brief's acceptance needs, with their real results; in `leftUndone`, untested behaviors, mutations no test catches, and any seam that forced test-only access.

The rule that matters most: settle the contract, see the test fail at the seam, then write the code. A test you never saw fail proves nothing, and a test that invents the contract becomes the spec.
