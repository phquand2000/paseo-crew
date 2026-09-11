# Test anti-pattern catalog

Check every test you add or change against this list before handoff. Each entry gives the tell
you can see in the diff, why it hurts, and the better route. A test can be long, pass, and still
be one of these; the first three are the most expensive to clean up later.

| Anti-pattern | Tell | Why it hurts | Better route |
|---|---|---|---|
| Minted API | The test calls a type, field, function, route, or table that production code doesn't have and the brief's Interfaces don't name. | The test invents the contract. Later code is bent to satisfy it, and the next agent treats the test as the specification. | Build or settle the contract first; if it isn't yours, report `BLOCKED` with the missing names. |
| Test-only production surface | Production code gains an API, flag, state, lifecycle branch, or constructor that only tests call. | Production carries surface nobody needs, and it must stay correct forever. | Put helpers in test utilities; if the seam forces a back door, say so under Unknown / risk. |
| Parallel model | A fixture builds its own model of the system (a fake game loop, a fake ledger) and the test asserts against it. | It proves the fixture, not the product, yet it gates the product. | Test through the real owner at its public seam. |
| Coupled to the implementation | Mocks of your own collaborators, calls to private functions, assertions on call order, checks through a side channel such as reading the database directly. | It breaks on every refactor that keeps behavior. | Assert what a caller observes at the seam. |
| Tautological | The expected value is computed the way the code computes it, is a snapshot the code generated, or is a mock asserting that it was called. | It passes by construction. | Use a literal worked out by hand, or an independent source of truth. |
| All tests first | The whole behavior list written as test code before any implementation. | The tests describe the shape you imagined, not the behavior you learned. | One test, make it pass, then the next. |
| Never seen red | No failing run of the test appears in your notes. | A test you never saw fail may not be able to fail. | Show the red run, for the right reason, in the handoff. |
| Weakened to green | A loosened assertion, a widened tolerance, a raised timeout, or a skip, `xfail`, or disabled marker added so the suite passes. | The suite goes green while the behavior stays broken, and the change reads like a fix. | Fix the cause, or report the trade-off as a `REOPEN_REQUEST`. |
| Swallowing mock | A mock returns success or a partial structure, so the failure path or a field read later never runs. | The test passes on a path production never takes. | Mock only what you don't control, and return the complete real structure. |
| Retired-value negative | A negative case pinned to an old width, tag, version, field, or offset. | It keeps a dead contract alive in the suite. | Derive invalid inputs from current constants, such as `WIDTH - 1` and `WIDTH + 1`. |
| Absence test | The test's only claim is that a removed name or dependency is absent. | It proves history, not behavior. | Cover the current contract positively, then delete the absence test. |
| Source or prose check | The test reads source text, help text, headings, registration names, or a report's shape. | Text present is not behavior executed. | Execute the behavior, or parse machine-readable output. |
| Over-specified | Exact log lines, a full error message, or an internal data layout asserted where a typed or semantic check exists. | Harmless wording changes break it. | Assert the type of rejection or the observable result. |
| Sleep-timed | `sleep` or a fixed delay stands in for waiting on a condition. | It is slow when it passes and flaky when the machine is busy. | Wait on the condition, with a timeout that only guards against hangs. |
| Order-dependent | Tests share mutable fixtures or pass only in a given order. | One change elsewhere makes unrelated tests fail. | Give each test its own state, created and cleaned up inside the test. |
| Outside the test lane | The test run uses the full suite, a port, or the test database when the brief's test lane rules them out. | Two agents in one lane create failures that belong to neither. | Run only what the brief's Verification and test lane allow, and list what you skipped. |
