# Proof debt catalog

Open this to widen an audit once the claim and the paths to scan are known. Search hits are leads, not findings.

## Search for

- retired, legacy, removed, forbidden, blacklist, absence or zero-hit wording in tests;
- source reads, substring or regex checks, headings, labels, markers and registration names used as proof;
- validators or workflows whose names claim proof while they inspect only metadata or prose;
- expected outputs copied from the same artifact or recomputed by the same algorithm;
- negative tests hard-coding a retired width, tag, version, field, offset or byte sequence;
- fixtures that write state and then assert only that the state exists;
- mock or replica benchmarks carrying production-path claims;
- pass-through wrappers tested more deeply than the owner they forward to;
- tests that still pass with the production module deleted.

## Better routes

- Absence memory becomes positive coverage of the current contract.
- Malformed inputs come from current authority, such as current width ± 1.
- Source or prose checks become executed behavior or parsed machine-readable output.
- Copied goldens become invariant checks or an independently owned source of truth.
- Mock production claims become production-path measurement, or an honestly narrower claim.
- A proof is named for what it is: test, benchmark, validation, lint, review aid, or closeout audit.

Don't grow a proxy with more strings or patterns: delete, demote or replace it.
