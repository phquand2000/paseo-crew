# Review kinds

Each heading below is one kind of review and the priorities it asks a reviewer to look for.
Choose the kinds that match the target and paste their lists under the `PRIORITIES` placeholder
of the prompt you write for `--prompt-file`. Kinds combine: a public Rust API change shipping in
a release takes both lists.

## General

- Correctness bugs and behavioral regressions.
- Architecture or ownership drift.
- Performance risks in hot paths.
- Missing contract tests and unclear failure modes.

## Bug hunt

- Edge cases, state-machine mistakes, off-by-one errors, null or empty inputs, and rollback paths.
- Concurrency, ordering, timeout, cancellation, retry, and resource lifetime bugs.
- Error handling that hides failures or makes recovery ambiguous.

## Safety

- Secret, token, cookie, credential, local-path, prompt, response, or account-identifier leakage.
- Permission boundary regressions, especially public, destructive, paid, account-level, or externally visible actions.
- Use of private APIs, hidden endpoints, background scraping, or bypasses of explicit user control.
- Reports or artifacts that should redact sensitive content by default.

## Parity

- Cross-language API drift, especially defaults, parameter names, return shapes, exceptions, and error codes.
- Protocol, contract fixture, schema, documentation, and example mismatches.
- Behavior that changed in one surface but not the others.

## Rust impact

- Public Rust API changes, trait invariants, feature flags, cargo metadata, and workspace impact.
- Changed symbols, likely callers, tests, unsafe boundaries, async behavior, lifetimes, and ownership assumptions.
- Whether the Rust Impact Summary evidence contradicts or misses anything in the diff.

## Release

- Packaging contents, versioning, generated artifacts, docs drift, changelog readiness, and install surfaces.
- Backward compatibility, migration notes, release gates, and missing verification evidence.

## Architecture

- Module boundaries, ownership, coupling, data flow, abstractions, and long-term maintainability.
- Places where a simpler local pattern would reduce risk without a broad rewrite.

## Debug

- Whether the included evidence establishes root cause instead of only symptoms.
- Missing repro steps, diagnostics, instrumentation, flaky-test risks, and environment assumptions.
