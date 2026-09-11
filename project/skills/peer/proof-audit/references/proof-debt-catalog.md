# Proof debt catalog

Use this catalog to widen a proof audit once you know the live claim and which directories to scan. A search hit is a lead to check with the procedure in `SKILL.md`, not a finding by itself.

## Where to search

- Words for retirement or absence: retired, legacy, removed, deprecated, forbidden, blacklist, tombstone, must not exist, zero hits.
- Tests that read source: file reads of source code, substring or regex checks, heading or label matches, and registration names.
- Validators or workflows whose name claims proof while their assertions only inspect metadata or prose.
- Expected outputs copied from the artifact under test, or recomputed by the same algorithm.
- Negative tests pinned to a retired representation: an old width, tag, version, field, offset, or byte sequence.
- Fixtures that write state and then assert only that the fixture state exists.
- Benchmarks over a mock or replica that carry a claim about the production path.

A starting search; adjust the pathspecs to the repository's test layout:

```sh
git grep -nEi 'legacy|retired|removed|deprecated|forbidden|blacklist|tombstone' -- '*test*' '*spec*' '*fixture*'
git grep -nE 'readFile|read_to_string|open\(' -- '*test*' '*spec*'
```

## Common smells

- A permanent test whose only claim is that a retired name or dependency is absent.
- Source or document text cited as evidence that runtime behavior executes.
- Report prose, or the fact that a test is registered, cited as proof that a scenario ran.
- A validator that accepts its own generated output with no independent truth.
- A pass-through wrapper tested more deeply than the owner it forwards to.
- A full error message locked in where a typed or semantic rejection exists.
- A benchmark whose measured path differs from the claimed path.
- A test that still passes after the production module is deleted.

## Better routes

- Replace absence checks with positive coverage of the current contract.
- Derive malformed inputs from the current authority, such as the current width plus or minus one, instead of keeping retired values.
- Replace source or prose checks with executed behavior or parsed machine-readable output.
- Replace copied goldens with invariant checks, or with an independently owned source of truth.
- Replace a production claim that rests on a mock with a measurement of the production path, or narrow the claim to what the mock actually shows.
- Name each proof for what it is: test, benchmark, validation, lint, review aid, or closeout audit.

## What each kind of proof can back

| Kind | Can back |
|---|---|
| Executed test | runtime behavior at the seam it calls |
| Parsed contract check | the shape of a machine-readable interface |
| Benchmark | performance of the path it measures |
| Lint or source scan | style, or the presence of text; not behavior |
| Closeout audit | a one-time change, recorded once |
