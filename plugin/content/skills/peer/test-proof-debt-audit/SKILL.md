---
name: test-proof-debt-audit
description: "Audits one named behavioral claim and the test, validator, benchmark, or gate cited as its proof, and says whether that proof would notice the behavior disappearing. Use when a brief or review focus asks whether a specific proof really proves its claim. Not for reviewing a change for correctness, ordinary implementation, a failing test, weak coverage, or tests that merely use mocks."
---

# Test proof debt audit

You audit only the claim and the proof the brief or focus names; don't widen it into a repository-wide audit. Report a proof only when you can name the scenario where it passes with the behavior broken, since an audit read as noise gets skipped whole and one entry you can't show costs every entry you can.

1. Name the claim and the production behavior that makes it true.
2. Name the cited proof.
3. Say what the proof actually observes: behavior, a machine-readable contract, performance, or proxy text and metadata.
4. Deletion sensitivity: would it still pass if the claimed behavior disappeared?
5. Do its expected values come from independent truth, or from the code or artifact under test?
6. Choose one: `keep`, `replace`, `demote`, `closeout-only`, `delete`, or `escalate`. Cut the claim down to what step 3 observed rather than removing the proof that carries it; `delete` needs step 4 to show it passes with the behavior gone, because how much a suite catches tracks how much of it there is.

Expected values that exist only because of history are debt: a test pinning a retired width, tag, field or version just to prove its rejection couldn't be written from the current contract. Replace it with current-boundary cases, demote or delete it, unless that value is still a public or security contract. Proxy evidence never proves runtime behavior, a mock proves only its own boundary, and weak proof doesn't authorize a redesign.

## Ends in

One entry per proof in `done`: location, claimed behavior, actual observation, a scenario where it passes with the behavior broken, your disposition, and the smallest replacement; for assessment only, report and stop. One entry, as an illustration of the depth rather than a template for its content:

```text
Location      test/export.test.ts:41 "exports every row"
Claim         the CSV export writes one line per order
Observes      that the file writer was called, never the lines it wrote
Passes broken yes: an export that writes the header and no rows still calls the writer
Disposition   replace
Replacement   export three fixture orders to a temporary file and assert its three data lines
```

For a broad audit or concrete replacement routes, read [references/proof-debt-catalog.md](references/proof-debt-catalog.md).
