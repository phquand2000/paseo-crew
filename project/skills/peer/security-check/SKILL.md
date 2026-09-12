---
name: security-check
description: "Code-level security pass on a change: trust boundaries and their sinks, authorization per object, committed secrets, the meaning of every new edge value, fail-closed errors, and one failing test per abuse case. Use when a brief touches input, auth, secrets, file paths, or outbound calls."
---

# Security check

Use this skill to check a change, at code level, for ways untrusted input or a careless caller could make it cause harm, and to turn each abuse case into a test.

The scope is the change and the code paths it touches; infrastructure, deployment, and dependency audits only if the brief asks. Under a read-only disposition, report findings and describe each test instead of writing it.

## Procedure

1. Map the trust boundaries the change touches: every place where data someone else wrote enters the changed code, model output, queue messages, third-party responses, and rows another tenant wrote included. Trust follows who wrote a value, not the channel it came through. Done when each boundary has an entry `path:line` and a validation `path:line`, or "no validation".
2. Follow each input to its sink and check the sink against the framework's safe form, paying attention to the two that are easy to get half right:
   - a file path is resolved, symlinks included, and checked to lie under an allowed root; a delete, move, or overwrite also checks that the target is *below* the root, not the root itself;
   - a URL the server fetches passes a scheme and host allowlist, and its redirects are controlled.

   Done when each input reaches a safe sink or is a finding.
3. For each operation the change adds or modifies, check authorization: who may perform it, where that is checked (`path:line`), and whether the check covers this user acting on this object, not only that someone is signed in. Look for object lookups by ID without an ownership check, admin paths without a role check, and checks enforced in the UI but not at the entry point.
4. Search the change, your own commit or the SHA under review, for credentials:

   ```sh
   git show "$sha" | grep -nEi 'secret|token|passw|api[_-]?key|private key'
   ```

   Secrets come from the environment or a secret store, stay out of logs, responses, and error messages, and are compared in constant time. If a real secret was committed, report `BLOCKED`: rotating it is the owner's decision, and deleting the line doesn't take it back.
5. For every new parameter, config option, or flag, write down what each edge value means: 0, negative, an empty string, an empty list, null or missing, the maximum or an overflow, and very long input. `timeout=0` could mean never or immediately, an empty allowlist could allow everything, and a missing key could skip verification. Then check that:
   - the default is the safe choice, and a parse error denies rather than falling back to a permissive value;
   - no two settings combine into a bypass;
   - distinct secret values (a key, a nonce, a token) can't be swapped without a type error;
   - a caller can't ignore a failed check, for example by not reading a returned boolean.

   Done when each new setting has its edge values and their meanings listed.
6. Check that a failed check denies rather than allows, and that messages shown to a caller carry no stack traces, internal paths, queries, secrets, or other users' data.
7. Turn each abuse case in your owned scope into a failing test at its seam, with the test-first loop: "a request for another user's record returns 403", "`../../etc/passwd` as a file name is rejected", "`timeout=0` is rejected". Watch it fail, fix the code, and watch it pass.

## Where findings go

- Fixed inside your owned scope: the commits, and the abuse-case tests with their output under Verification.
- Needs the owner's decision (a change to the auth model, a new category of stored data, accepting a risk, rotating a leaked secret, CORS or rate-limit policy): Unknown / risk, as the decision needed and the consequence of each option.
- Outside your owned scope: a `DEPENDENCY_REQUEST` with the evidence.

Write each finding as:

```text
S1          P0-P3, confidence high | medium | low
Where       path:line
Path        input source -> sink
Abuse case  the input or call sequence, and what it achieves
Fix         the smallest change that closes it
Test        the test that fails today and passes after the fix
```
