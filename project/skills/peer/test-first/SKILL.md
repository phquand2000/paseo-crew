---
name: test-first
description: "Build a behavior change one failing test at a time at the seam the brief names: see each test fail for the right reason, make it pass with the least code, then tidy, while avoiding API-minting, coupled, tautological, and all-tests-first tests. Use when a brief asks you to add or change behavior whose contract and owner are already settled."
---

# Test-first

Use this skill to add or change behavior by writing one failing test, making it pass, and repeating, at a seam whose contract is already settled.

## Before the first test

Settle three things before writing test code:

1. Name the seam: the public interface that the brief, or the settled seams in the repository's `AGENTS.md`, says to test through, and the result a caller can observe there. If the brief names no seam, or the seam is marked decide-first and is still undecided, report `BLOCKED` with the candidate seams you found instead of picking one; a test at a guessed seam turns your guess into the contract. Done when you can write the seam in one line, for example `parseHeader(bytes) -> Header | ParseError`.
2. Find the fastest command that runs a single test file, and run it on the unchanged code. Done when it passes, so any red you see later is yours.
3. List the behaviors you will add, one sentence each, in the words a caller would use ("rejects a header shorter than WIDTH"). Done when the list is in your notes and no test code exists yet.

## The loop

Repeat for each behavior on the list:

1. Write one test for one behavior, calling only the seam's public interface. Before writing the body, name the production change that would make it fail. Take the expected value from a literal, a worked example, or the spec, not from the code under test.
2. Run it and read the failure. Done when it fails on an assertion whose message says the behavior is missing. If it passes, it tests behavior that already exists or it cannot fail, so rewrite it. If it errors (an import, a typo, a missing fixture), fix that and rerun until it fails for the right reason.
3. Write the least production code that makes it pass. Leave out options, parameters, and branches that no test has asked for yet. Done when this test and the baseline suite pass.
4. Tidy: remove duplication and improve names while everything stays green, and add no behavior. Done when the rerun is green.
5. Commit the slice once it stands on its own. Small commits let the Lead read the red-to-green history.

If you changed production code before writing the test, set your change aside with `git stash push -- PATHS`, confirm the new test fails on the original code, then run `git stash pop`. Name only your own paths, so uncommitted work that isn't yours stays where it is.

## Anti-patterns

The full catalog, with the tell and the better route for each, is in [references/test-antipatterns.md](references/test-antipatterns.md). Check every new test against it before handoff. These four do the most damage:

- Minted API: the test calls a type, field, function, route, or table that production code doesn't have and the brief's Interfaces don't name, so the test invents the contract. Later code gets bent to satisfy it, and a later design change turns a pile of such tests red for no real reason. For each name a new test uses that the test doesn't define itself, check that it exists at the base commit:

  ```sh
  git grep -n 'NAME' BASE -- . ':(exclude)*test*' ':(exclude)*spec*'
  ```

  A name with no hit that isn't in the brief's Interfaces means the contract isn't settled: report `BLOCKED` with the missing names.
- Coupled to the implementation: the test mocks your own internal collaborators, calls private functions, asserts call order, or checks results through a side channel such as reading the database directly. It breaks when you refactor without changing behavior. Assert through the seam instead.
- Tautological: the expected value is computed the way the code computes it, is a snapshot the code generated, or is a mock asserting that the mock was called. It passes by construction. Replace it with a literal you worked out by hand.
- All tests first: the whole list written as test code before any implementation. Those tests describe the shape you imagined, not the behavior you learned while building. Write one test, make it pass, then write the next.

Mock only what you don't control or can't make fast and deterministic: external services, the clock, randomness, and sometimes the network or filesystem. Keep your own modules real. Make a mock return the complete real structure, so a field the code reads later isn't silently missing.

## Production code serves production

Add no production API, state, flag, lifecycle branch, or constructor whose only consumer is a test, because it becomes surface that production has to carry and keep correct. For each public symbol you add, check that something outside the tests calls it:

```sh
git grep -n 'SYMBOL' -- . ':(exclude)*test*' ':(exclude)*spec*'
```

If a test can reach the behavior only through a back door, the seam is probably in the wrong place. Put test-only helpers in test utilities. If the seam itself forces the back door, say so under Unknown / risk.

## Negative cases after a hard cut

When the brief removes or replaces a schema field, protocol tag, width, or version:

1. List the retired identifiers and values from the diff with `git diff BASE -- PATHS`.
2. Search current tests and fixtures for each one with `git grep -n`. Done when no current test or fixture names a retired value, unless that exact representation is still a public or security contract.
3. Derive invalid inputs from current constants and boundaries, such as `WIDTH - 1` and `WIDTH + 1`, or a tag one past the current maximum. A test pinned to a retired value proves only history, and it keeps the dead contract alive in the suite.
4. Delete tests whose only claim is that a retired name is rejected or absent.

## Before handoff

Run a mutation check in your head against the code you wrote. For each realistic mutation (a wrong constant, a swapped branch, a missing side effect, an empty or default return, missing validation for zero, empty, null, or maximum), at least one test should fail. A mutation that no test catches marks an unprotected behavior: add the test, or list it under Unknown / risk.

Treat a test that is hard to write as design feedback:

- If the setup is huge or you'd have to mock everything, the interface is too wide. Inside your owned scope, narrow it; outside it, send a `DEPENDENCY_REQUEST`, or a `REOPEN_REQUEST` naming the `API` layer.
- If you can't state an expected value without reading the implementation, the contract isn't settled. Report `BLOCKED`.

## What goes in the handoff

- Verification: for each slice, the failing run (the assertion message is enough) and the passing run; then the brief's verification commands with their output.
- Unknown / risk: behaviors left untested and why, mutations no test catches, and any seam that forced test-only access.

A test you never saw fail proves nothing, so the red run is part of the evidence.
