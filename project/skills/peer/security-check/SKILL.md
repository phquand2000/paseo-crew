---
name: security-check
description: "Make a code-level security pass over a change: the trust boundaries it touches, inputs crossing them, authorization checks, secrets, injection sinks, unsafe defaults at zero, empty, null, and maximum, and errors that leak data, then turn each abuse case into a test. Use when a brief touches input handling, auth, secrets, file paths, or outbound calls, or asks for a security check."
---

# Security check

Use this skill to check a change, at code level, for ways that untrusted input or a careless caller could make it cause harm, and to turn each abuse case into a test.

The scope is the change and the code paths it touches. Infrastructure, deployment, and dependency audits are outside it unless the brief asks for them. Under the Reviewer disposition you report findings; as an Engineer you also write tests and fixes inside your owned scope.

## Procedure

1. Map the trust boundaries the change touches: every place where data someone else wrote enters the changed code. Typical sources are request parameters, bodies, and headers; files and file names; environment variables and command-line arguments; queue messages and webhooks; third-party API responses; rows another tenant wrote; and model output. Trust follows who wrote a value, not the channel it arrived through. Done when each boundary has an entry `path:line` and a validation `path:line`, or "no validation".
2. Follow each input to where it is used, and check the sink:
   - database queries use parameters rather than string building;
   - processes start with an argument list rather than a shell string;
   - file paths are resolved, symlinks included, and checked to lie under an allowed root; a delete, move, or overwrite also checks that the target is below the root rather than the root itself;
   - HTML and templates rely on the framework's escaping, with no raw HTML built from input;
   - URLs the server fetches pass a scheme and host allowlist, and redirects are controlled;
   - deserialization, `eval`, dynamic imports, and regular expressions built from input are absent or constrained;
   - logs receive no secrets or personal data.

   Done when each input either reaches a safe sink or is a finding.
3. Check authorization for each operation the change adds or modifies: who may perform it, where that is checked (`path:line`), and whether the check covers this user acting on this object rather than only that someone is signed in. Look for object lookups by ID without an ownership check, admin paths without a role check, and checks enforced in the UI but not at the entry point.
4. Check secrets. Search the change, whether your own commit or the SHA under review, for credentials:

   ```sh
   git show "$sha" | grep -nEi 'secret|token|passw|api[_-]?key|private key'
   ```

   Secrets should come from the environment or a secret store, stay out of logs, responses, and error messages, and be compared in constant time. If a real secret was committed, report `BLOCKED`: rotating it is the owner's decision, and deleting the line doesn't take it back.
5. Probe defaults and edge values for every new parameter, config option, or flag: 0, negative, an empty string, an empty list, null or missing, the maximum or an overflow, and very long input. Write down what each value means, because `timeout=0` could mean never or immediately, an empty allowlist could allow everything, and a missing key could skip verification. Then check that:
   - the default is the safe choice;
   - a parse error doesn't fall back to a permissive value;
   - no two settings combine into a bypass;
   - distinct secret values (a key, a nonce, a token) can't be swapped without a type error;
   - a caller can't ignore a failed check, for example by not reading a returned boolean.

   Done when each new setting has its edge values and their meanings listed.
6. Check errors: responses and messages shown to a caller carry no stack traces, internal paths, queries, secrets, or other users' data, and a failed check denies rather than allows.
7. Turn each abuse case in your owned scope into a failing test at its seam, using the test-first loop, for example "a request for another user's record returns 403", "`../../etc/passwd` as a file name is rejected", or "`timeout=0` is rejected". Watch it fail, fix the code, and watch it pass. Under the Reviewer disposition, describe the test instead of writing it.

## Where findings go

- Fixed inside your owned scope: the commits, and the abuse-case tests with their output under Verification.
- Needs the owner's decision, such as a change to the auth model, a new category of stored data, accepting a risk, rotating a leaked secret, or CORS or rate-limit policy: Unknown / risk, stated as the decision needed and the consequence of each option.
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
