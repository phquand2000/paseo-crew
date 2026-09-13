# Test anti-pattern catalog

Check every test you added or changed against each row before handoff. A test can pass and still be one of these; the first three cost the most to undo.

| Anti-pattern | Tell | Better route |
|---|---|---|
| Minted API | The test uses a name production code lacks and Interfaces doesn't list; a small contract change turns many tests red. | Settle the contract first (test-first step 2.2), or report `BLOCKED` with the names. |
| Test-only production surface | Production gains an API, flag, state or constructor only tests call. | Helpers go in test utilities; if the seam forces a back door, say so under Unknown / risk. |
| Parallel model | A fixture builds its own model of the system and the test asserts against it, so it proves the fixture. | Test through the real owner at its public seam. |
| Coupled to the implementation | Mocks of your own collaborators, private calls, call-order assertions, reading the database behind the seam. | Assert what a caller observes at the seam. |
| Tautological | The expected value is computed the way the code computes it, snapshotted from its output, or a mock asserting it was called. | A literal worked out by hand, or an independent source of truth. |
| Fitted to the examples | The code special-cases test inputs or guesses state from signals that only hold in fixtures (text, counts, timing). | Implement the stated rule, add a second example, read state from its owner. |
| All tests first | The whole behavior list written as tests before any code. | One test, make it pass, then the next. |
| Never seen red | No failing run in your notes. | Show the red run, failing for the right reason. |
| Weakened to green | A loosened assertion, wider tolerance, raised timeout, or added skip. | Fix the cause, or report the trade-off as a `REOPEN_REQUEST`. |
| Swallowing mock | A mock returns success or a partial structure, so a failure path or later field read never runs. | Mock only what you don't control (external services, clock, randomness), below the side effects the test needs, returning the full real structure. |
| Wrapper or bridge test | Tests for a layer that only forwards data, or for bridge code a later slice removes. | Prove the behavior at the long-lived owner seam. |
| Retired-value negative | A negative case pinned to an old width, tag, version, field or offset. | Derive invalid inputs from current constants, such as `WIDTH - 1`. |
| Absence test | Its only claim is that a removed name or dependency is gone. | Cover the current contract positively, then delete it. |
| Source or prose check | It reads source text, help text, headings or registration names. | Execute the behavior, or parse machine-readable output. |
| Over-specified | Exact log lines, full error messages or internal layout where a typed check exists. | Assert the kind of rejection or the observable result. |
| Sleep-timed | A fixed delay instead of waiting on a condition. | Wait on the condition, with a timeout only against hangs. |
| Order-dependent | Shared mutable fixtures; passes alone, fails in the suite. | Each test creates and cleans its own state. |
| Outside the test lane | The full suite, a port or the test database when the brief's test lane rules them out. | Run only what Verification and the test lane allow, and list what you skipped. |
