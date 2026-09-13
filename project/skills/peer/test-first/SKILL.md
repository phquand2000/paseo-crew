---
name: test-first
description: "Evidence before behavior: choose the proof (a failing test at a settled seam, a repro, characterization, a benchmark, a render check), then add behavior one failing test at a time. Use when a brief changes behavior, fixes a bug, or refactors."
---

# Test-first

Use this skill to put evidence before every behavior change: choose the proof that shows the change best, and when that proof is a test, work in this order: settle the contract, write a failing test at the seam, then write the code. If the brief makes you read-only (an Architect or Scout disposition), report the proof and seam you would use, and commit nothing.

## Choose the proof

No behavior changes without evidence you produced before the change. Pick it by the kind of change:

| Change | Evidence before you change code |
|---|---|
| Bug or regression | a failing test or minimal repro of the reported symptom; see `diagnosing-bugs` |
| New behavior at a seam | a failing test through the seam: the loop below |
| Protocol, wire, or schema change | a failing round-trip or encode/decode test on real records or bytes |
| Refactor with no behavior change | the existing tests; where they are weak, characterization tests of current behavior at the seam, never one test per moved helper |
| Wrapper, adapter, or temporary bridge | proof at the long-lived owner seam it serves; a direct test only when the layer itself translates, filters, retries, caches, falls back, or will outlive the plan |
| Performance | a benchmark before the change, baselined over enough runs to show its spread; correctness proven separately |
| Visual, layout, or copy | a render check, screenshot, or accessibility assertion (see `frontend-design`); no unit tests for CSS or wording |
| Docs, config, or mechanical edit | the smallest check that proves the artifact is valid |

Done when you can name the proof in one line, and why no other surface proves the claim better.

## Before the first test

1. Name the seam: an interface the brief's Interfaces field lists under Consumes or Produces, or an existing public entry point the change goes through (`path:line`), and what a caller observes there. Report `BLOCKED` with the candidate seams only when neither exists, or when the seam is marked decide-first in `AGENTS.md` and still undecided; a test at a guessed seam makes your guess the contract. Done when the seam fits on one line, such as `parseHeader(bytes) -> Header | ParseError`.
2. Settle the contract: every type, field, function, route, and table your tests use but don't define must exist in production code at `BASE`, or be named in the brief's Interfaces. `BASE` is the base commit the brief names; otherwise run `BASE=$(git merge-base HEAD BASE_BRANCH)` with the branch yours started from, such as `main`. This search skips test directories and test files but keeps production names such as `latest` or `inspect`:

   ```sh
   git grep -n -w 'NAME' "$BASE" -- . ':(exclude,glob)**/test*/**' ':(exclude,glob)**/spec/**' ':(exclude,glob)**/__tests__/**' ':(exclude,glob)**/*[._]test.*' ':(exclude,glob)**/*[._]spec.*' ':(exclude,glob)**/test_*'
   ```

   A missing name would mint an API: a test that needs a `points` field `User` lacks decides the contract, and later code bends to fit it. Report `BLOCKED` with the missing names. For a name Produces lists that doesn't exist yet, declare its signature first, so the test fails on an assertion, not an import. Done when every name has a hit or an Interfaces line.
3. Find the fastest command that runs one test file, and run it on the unchanged code. Done when it passes, so any later red is yours. If a test is already red, or the brief asks you to make an existing test pass, check that test before touching production code: its names pass step 2, and its expected values trace to the brief, `AGENTS.md`, or a spec. If it mints an API or pins retired behavior, report `BLOCKED` with its `path:line` instead of bending the code to fit it.
4. List the behaviors to add, one sentence each in a caller's words ("rejects a header shorter than WIDTH"). Done when the list is in your notes and no test code exists yet.

## The loop

For each behavior on the list:

1. Write one test for it, calling only the seam's public interface. First name the production change that would make it fail. Take the expected value from a literal, a worked example, or the spec, never from the code under test. When returning that value or special-casing that input would pass the test, add a second example with different values, so only the real rule passes both.
2. Run it. Done when it fails on an assertion saying the behavior is missing. If it passes, it tests existing behavior or can't fail: rewrite it. If it errors (an import, a typo, a missing fixture), fix that and rerun until it fails for the right reason.
3. Write the least production code that passes it by implementing the rule the behavior states: no option, parameter, or branch a test hasn't asked for, no special case for the test's inputs, and no guess from signals that only happen to hold in the fixtures. Done when this test and the baseline pass.
4. Tidy duplication and names without adding behavior. Done when the rerun is green.
5. Commit each slice that stands on its own, so the Lead can read the red-to-green history.

If a slice shows the contract itself is wrong, stop writing code and send a `REOPEN_REQUEST` naming the `API` layer.

If you changed production code before writing the test, don't delete it blindly: run `git stash push -- <paths>`, confirm the test fails on the original code, then run `git stash pop`. Name only your own paths, so uncommitted work that isn't yours stays where it is.

## Keep only tests that lock a contract

Before you write or keep a test, answer these five questions:

1. Which seam contract or invariant does it lock?
2. Would a harmless rename, container swap, or internal refactor break it while behavior stays correct?
3. Does a stronger adjacent seam already prove this more directly?
4. Does its name claim more than its assertion proves?
5. If it disappeared, which real regression would escape?

When the answers point at helper names, private fields, container shape, source text, wording, or coverage another seam already has, drop the test and prove the behavior at the seam. One strong seam test beats five tests of a wrapper that only passes data through; a test file longer than the tiny wrapper it covers means you chose the wrong proof.

## Anti-patterns

Every new test goes against the anti-pattern catalog in [references/test-antipatterns.md](references/test-antipatterns.md), which you open in Before handoff. The first rows cost the most to clean up later; for Minted API, the check is step 2 of Before the first test.

## Production code serves production

Add no production API, state, flag, lifecycle branch, log line, or constructor whose only consumer is a test or a demo; production has to carry it and keep it correct. Don't make production slower, synchronous, or less scalable, or blur a boundary, to make it easier to test. For each public symbol you add, run the step 2 search without `"$BASE"`, so it covers your current files, and check that it finds a caller.

Put test-only helpers in test utilities. If only a back door reaches the behavior, the seam is probably misplaced; if the seam forces it, say so under Unknown / risk.

## When a contract changes

When the brief changes a contract (a signature, route, schema, field, or file format), or removes
one in a hard cut, follow [references/contract-changes.md](references/contract-changes.md): it
holds the consumer sweep, the rule for auditing the tests a contract change turns red, and the
negative cases a retired value needs. The one rule that never waits: update every shipping
producer, consumer, and generated artifact of the contract in the same change.

## Before handoff

Open [references/test-antipatterns.md](references/test-antipatterns.md) and read it against the tests you wrote, row by row, including its rules for mocks. Name in the handoff which rows you checked and which ones a test came close to; reading the catalog from memory is how the rows that cost the most get skipped.

Run a mutation check in your head on the code you wrote: a wrong constant, a swapped branch, a missing side effect, an empty, default, or hard-coded return, missing validation for zero, empty, null, or maximum. Each should fail at least one test; for one that doesn't, add the test or list it under Unknown / risk. Then run the code on one input no test uses: if it works only on the test values, it is fitted to the examples, not the rule.

A test that is hard to write is design feedback:

- Huge setup, or mocking everything, means the interface is too wide. Narrow it inside your owned scope; outside it, send a `DEPENDENCY_REQUEST`, or a `REOPEN_REQUEST` naming the `API` layer.
- No expected value without reading the implementation means the contract isn't settled: report `BLOCKED`.

## What goes in the handoff

- Verification: the proof you chose and why; per slice, the failing run (the assertion message is enough) and the passing run; then the brief's verification commands with their output.
- Unknown / risk: behaviors left untested and why, mutations no test catches, and any seam that forced test-only access.

The rule that matters most: settle the contract, see the test fail at the seam, then write the code. A test you never saw fail proves nothing, and a test that invents the contract becomes the spec.
