---
name: test-proof-debt-audit
description: "Audits one named behavioral claim and the test, validator, benchmark, or gate cited as its proof, and says whether that proof would notice the behavior disappearing. Use when a brief or review focus asks whether a specific proof really proves its claim. Not for ordinary implementation, a failing test, weak coverage, or the mere presence of mocks."
---

# Test proof debt audit

You audit only the claim and the proof the brief or focus names; don't widen it into a repository-wide audit.

1. Name the claim and the production behavior that makes it true.
2. Name the cited proof.
3. Say what the proof actually observes: behavior, a machine-readable contract, performance, or proxy text and metadata.
4. Deletion sensitivity: would it still pass if the claimed behavior disappeared?
5. Do its expected values come from independent truth, or from the code or artifact under test?
6. Choose one: `keep`, `replace`, `demote`, `closeout-only`, `delete`, or `escalate`.

Expected values that exist only because of history are debt: a test pinning a retired width, tag, field or version just to prove its rejection couldn't be written from the current contract. Replace it with current-boundary cases, demote or delete it, unless that value is still a public or security contract. Proxy evidence never proves runtime behavior, a mock proves only its own boundary, and weak proof doesn't authorize a redesign.

## Ends in

One entry per proof in `done`: location, claimed behavior, actual observation, a scenario where it passes with the behavior broken, your disposition, and the smallest replacement; for assessment only, report and stop. For a broad audit or concrete replacement routes, read [references/proof-debt-catalog.md](references/proof-debt-catalog.md).
