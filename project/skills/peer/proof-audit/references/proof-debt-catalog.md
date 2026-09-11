# Proof debt catalog

Use this catalog to widen a proof audit once you know the live claim and which directories to scan. A search hit is a lead to check with the procedure in `SKILL.md`, not a finding.

## Smells, and where to search

- A permanent test whose only claim is that a retired name or dependency is absent. Search for retired, legacy, removed, deprecated, forbidden, blacklist, tombstone, must not exist, zero hits.
- A negative test pinned to a retired representation: an old width, tag, version, field, offset, or byte sequence.
- Source or document text cited as evidence that runtime behavior executes. Search for file reads of source, substring or regex checks, heading or label matches, and registration names.
- Report prose, or the fact that a test is registered, cited as proof that a scenario ran; a validator or workflow whose name claims proof while its assertions inspect only metadata or prose.
- Expected outputs copied from the artifact under test or recomputed by the same algorithm; a validator that accepts its own generated output with no independent truth.
- A fixture that writes state, then asserts only that the fixture state exists.
- A benchmark over a mock or replica that carries a claim about the production path, or whose measured path differs from the claimed one.
- A pass-through wrapper tested more deeply than the owner it forwards to.
- A full error message locked in where a typed or semantic rejection exists.
- A test that still passes after the production module is deleted.

A starting search; adjust the pathspecs to the repository's test layout:

```sh
git grep -nEi 'legacy|retired|removed|deprecated|forbidden|blacklist|tombstone' -- '*test*' '*spec*' '*fixture*'
git grep -nE 'readFile|read_to_string|open\(' -- '*test*' '*spec*'
```

## Better routes

- Replace absence checks with positive coverage of the current contract.
- Derive malformed inputs from the current authority, such as the current width plus or minus one, not retired values.
- Replace source or prose checks with executed behavior or parsed machine-readable output.
- Replace copied goldens with invariant checks, or an independently owned source of truth.
- Replace a production claim resting on a mock with a measurement of the production path, or narrow the claim to what the mock shows.
- Name each proof for what it is: test, benchmark, validation, lint, review aid, or closeout audit.

## What each kind of proof can back

| Kind | Can back |
|---|---|
| Executed test | runtime behavior at the seam it calls |
| Parsed contract check | the shape of a machine-readable interface |
| Benchmark | performance of the path it measures |
| Lint or source scan | style, or the presence of text; not behavior |
| Closeout audit | a one-time change, recorded once |
