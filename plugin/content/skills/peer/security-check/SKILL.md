---
name: security-check
description: "Checks a change at code level for harm untrusted input or a careless caller could cause: trust boundaries and sinks, per-object authorization, committed secrets, the meaning of new edge values, fail-closed errors, and a failing test per abuse case. Use when a brief touches input, auth, secrets, file paths, data exposure, or outbound calls. Not for infrastructure or dependency audits the brief doesn't ask for."
---

# Security check

You look for ways the change lets untrusted input or a careless caller cause harm, and turn each abuse case into a test. The scope is the change and the paths it touches; infrastructure and dependency audits only when the brief asks. With no owned paths, report findings and describe each test instead of writing it.

## What to check

1. **Trust boundaries.** Every place data someone else wrote enters the changed code: requests, model output, queue messages, third-party responses, rows another tenant wrote. Trust follows who wrote a value, not the channel it came through. Give each an entry `path:line` and a validation `path:line`, or "no validation".
2. **Sinks.** Follow each input to where it is used, and check that sink against the framework's safe form. Two are easy to get half right: a file path must resolve, symlinks included, under an allowed root, and a delete or overwrite must target something *below* the root; a URL the server fetches needs a scheme and host allowlist that its redirects can't escape.
3. **Authorization.** For each operation added or changed: who may do it, where that is checked, and whether the check covers this user on this object rather than only a signed-in user. Look for lookups by ID without an ownership check and checks that live only in the UI.
4. **Secrets.** Search the diff for credentials. Secrets come from the environment or a secret store, stay out of logs and errors, and are compared in constant time. A real secret already committed goes to `ask` at once: rotating it is not your decision, and deleting the line doesn't take it back.
5. **Edge values.** For every new parameter, option or flag, write down what 0, negative, empty, null or missing, maximum and very long input mean: `timeout=0` could mean never or immediately, and an empty allowlist could allow everything. The default is the safe choice, a parse error denies, no two settings combine into a bypass, and a caller can't ignore a failed check.
6. **Failure.** A failed check denies, and messages to a caller carry no stack traces, internal paths, queries, secrets or other users' data.
7. **Tests.** Turn each abuse case in your owned paths into a failing test at its seam with the test-first loop ("another user's record returns 403", "`../../etc/passwd` is rejected"), then fix it.

## Ends in

`done`. Fixed issues are commits, with their abuse-case tests in `checks`. A decision that isn't yours (the auth model, accepting a risk, rotating a secret, CORS or rate-limit policy) goes in `leftUndone` with the consequence of each option, or to `ask` when it blocks the task; a problem outside your owned paths goes in `discovered`. Write each finding as:

```text
S1          P0-P3, confidence high | medium | low
Where       path:line
Path        input source -> sink
Abuse case  the input or call sequence, and what it achieves
Fix         the smallest change that closes it
Test        the test that fails today and passes after the fix
```
