---
name: test-first
description: "Evidence before behavior: choose the proof (a failing test at the brief's seam, a repro, characterization, a benchmark, a render check), then add behavior one failing test at a time. Use when a brief changes behavior, fixes a bug, or refactors."
---

# Test-first

Use this skill to put evidence before every behavior change: choose the proof that shows the change best, and when that proof is a test, add behavior one failing test at a time at a seam whose contract is already settled.

## Choose the proof

No behavior changes without evidence you produced before the change. Pick it by the kind of change:

| Change | Evidence before you change code |
|---|---|
| Bug or regression | a failing test or minimal repro of the reported symptom; load `diagnosing-bugs` |
| New behavior at a seam | a failing test through the seam: the loop below |
| Protocol, wire, or schema change | a failing round-trip or encode/decode test on real records or bytes |
| Refactor with no behavior change | the existing tests; where they are weak, characterization tests of current behavior at the seam, never one test per moved helper |
| Wrapper, adapter, or temporary bridge | proof at the long-lived owner seam it serves; a direct test only when the layer itself translates, filters, retries, caches, falls back, or will outlive the plan |
| Performance | a benchmark before the change (load `performance-change`); correctness proven separately |
| Visual, layout, or copy | a render check, screenshot, or accessibility assertion (load `frontend-change`); no unit tests for CSS or wording |
| Docs, config, or mechanical edit | the smallest check that proves the artifact is valid |

Done when you can name the proof in one line, and why no other surface proves the claim better.

## Before the first test

1. Name the seam: the public interface the brief, or a settled seam in the repository's `AGENTS.md`, says to test through, and what a caller observes there. If the brief names no seam, or the seam is marked decide-first and still undecided, report `BLOCKED` with the candidate seams you found; a test at a guessed seam makes your guess the contract. Done when the seam fits on one line, such as `parseHeader(bytes) -> Header | ParseError`.
2. Find the fastest command that runs one test file, and run it on the unchanged code. Done when it passes, so any later red is yours.
3. List the behaviors to add, one sentence each in a caller's words ("rejects a header shorter than WIDTH"). Done when the list is in your notes and no test code exists yet.

## The loop

For each behavior on the list:

1. Write one test for it, calling only the seam's public interface. First name the production change that would make it fail. Take the expected value from a literal, a worked example, or the spec, never from the code under test. When returning that value or special-casing that input would pass the test, add a second example with different values, so only the real rule passes both.
2. Run it. Done when it fails on an assertion saying the behavior is missing. If it passes, it tests existing behavior or can't fail: rewrite it. If it errors (an import, a typo, a missing fixture), fix that and rerun until it fails for the right reason.
3. Write the least production code that passes it by implementing the rule the behavior states: no option, parameter, or branch a test hasn't asked for, no special case for the test's inputs, and no guess from signals that only happen to hold in the fixtures. Done when this test and the baseline pass.
4. Tidy duplication and names without adding behavior. Done when the rerun is green.
5. Commit each slice that stands on its own, so the Lead can read the red-to-green history.

If a slice shows the contract itself is wrong, stop writing code and send a `REOPEN_REQUEST` naming the `API` layer.

If you changed production code before writing the test, don't delete it blindly: run `git stash push -- PATHS`, confirm the test fails on the original code, then run `git stash pop`. Name only your own paths, so uncommitted work that isn't yours stays where it is.

## Keep only tests that lock a contract

Before you write or keep a test, answer these five questions:

1. Which seam contract or invariant does it lock?
2. Would a harmless rename, container swap, or internal refactor break it while behavior stays correct?
3. Does a stronger adjacent seam already prove this more directly?
4. Does its name claim more than its assertion proves?
5. If it disappeared, which real regression would escape?

When the answers point at helper names, private fields, container shape, source text, wording, or coverage another seam already has, drop the test and prove the behavior at the seam. One strong seam test beats five tests of a wrapper that only passes data through; a test file longer than the tiny wrapper it covers means you chose the wrong proof.

## Anti-patterns

Check every new test against the anti-pattern catalog in [references/test-antipatterns.md](references/test-antipatterns.md) before handoff. These four do the most damage:

- Minted API: the test uses a type, field, function, route, or table that production code lacks and the brief's Interfaces don't name, so the test invents the contract. For each name a test uses but doesn't define, check it exists at the base commit:

  ```sh
  git grep -n 'NAME' BASE -- . ':(exclude)*test*' ':(exclude)*spec*'
  ```

  A name with no hit that isn't in the brief's Interfaces means the contract isn't settled: report `BLOCKED` with the missing names.
- Coupled to the implementation: mocks of your own collaborators, calls to private functions, call-order assertions, or checks through a side channel such as reading the database. It breaks on refactors that keep behavior; assert through the seam.
- Tautological: the expected value is computed the way the code computes it, is a snapshot the code generated, or is a mock asserting it was called. It passes by construction; use a literal worked out by hand.
- All tests first: the whole list written as tests before any code, so they describe the imagined shape, not the learned behavior. Write one test, make it pass, then the next.

Mock only what you don't control or can't make fast and deterministic: external services, the clock, randomness, and sometimes the network or filesystem. Before mocking a method, name its side effects and whether the test depends on them; if you can't, run the test against the real implementation first, then mock only the slow or external part below it. Keep your own modules real, and make each mock return the complete real structure, so a field read later isn't silently missing.

## Production code serves production

Add no production API, state, flag, lifecycle branch, log line, or constructor whose only consumer is a test or a demo; production has to carry it and keep it correct. For each public symbol you add, check that something outside the tests calls it:

```sh
git grep -n 'SYMBOL' -- . ':(exclude)*test*' ':(exclude)*spec*'
```

Put test-only helpers in test utilities. If only a back door reaches the behavior, the seam is probably misplaced; if the seam forces it, say so under Unknown / risk.

## Negative cases after a hard cut

When the brief removes or replaces a schema field, protocol tag, width, or version:

1. List the retired identifiers and values with `git diff BASE -- PATHS`.
2. Search current tests and fixtures for each with `git grep -n`. Done when none names a retired value, unless that exact representation is still a public or security contract.
3. Derive invalid inputs from current constants and boundaries (`WIDTH - 1`, `WIDTH + 1`, a tag one past the current maximum). A test pinned to a retired value proves only history and keeps the dead contract alive.
4. Delete tests whose only claim is that a retired name is rejected or absent.

## Before handoff

Run a mutation check in your head on the code you wrote: a wrong constant, a swapped branch, a missing side effect, an empty, default, or hard-coded return, missing validation for zero, empty, null, or maximum. Each should fail at least one test; for one that doesn't, add the test or list it under Unknown / risk. Then run the code on one input no test uses: if it works only on the test values, it is fitted to the examples, not the rule.

A test that is hard to write is design feedback:

- Huge setup, or mocking everything, means the interface is too wide. Narrow it inside your owned scope; outside it, send a `DEPENDENCY_REQUEST`, or a `REOPEN_REQUEST` naming the `API` layer.
- No expected value without reading the implementation means the contract isn't settled: report `BLOCKED`.

## What goes in the handoff

- Verification: the proof you chose and why; per slice, the failing run (the assertion message is enough) and the passing run; then the brief's verification commands with their output.
- Unknown / risk: behaviors left untested and why, mutations no test catches, and any seam that forced test-only access.

The rule that matters most: evidence comes before the change, and a test you never saw fail proves nothing, so the red run is part of the evidence.
