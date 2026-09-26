# Council report patterns

Open this when you write the case output contract and the focuses, and again for the decision model, a verification, a cross-examination or a draft audit. The chosen pattern goes into each reviewer's `focus` and comes back in its `done` findings. Adapt what the case needs; never copy every heading into every focus. Every contract separates direct observation, authority, inference and uncertainty, and shows which action each conclusion changes.

## Neutral brief

```text
Case ID: <stable URL-safe ID, reused on every title>
Original request: <the message that asked for the council, verbatim, never your summary>
Decision question: <may clarify the request, never narrow or replace it>
Observable outcome: <what is true in the world once the decision is right>
Authoritative facts: <decisions or verified facts, each with provenance>
Direct observations: <source-backed observations with exact locations>
Unverified claims: <every other premise>
Unknowns: <material gaps no one has resolved>
Hard constraints: <non-negotiable limits, apart from preferences>
Preferences: <priority order among soft goals>
Authorized scope and sources: <what reviewers may inspect>
Snapshot: <the lane branch commit reviewers read>
Requested output: <the work product the requester expects>
Case output contract: <the sections or fields each reviewer returns in done's findings>
```

A Specialist may get extra domain fields that reveal no view and no preferred answer. The Auditor's focus
takes the opening text without its ban on reading other work, the closing text, and the ask under
"Draft-verdict audit" below.

## Focus opening and closing

Every focus opens with:

```text
Work as an autonomous reviewer with independent judgment inside the authorized scope. Challenge false premises, choose what evidence to inspect, and make ordinary analytical decisions without waiting. Do not look for or read other reviewers' work or council files. Begin the work directly, without a preamble.
```

and closes with:

```text
This is analysis only. Do not optimize for agreement. Distinguish direct observations from inference, and state what evidence would prove your position wrong. Put the report in done's findings; use verdict reopen only if the decision question rests on a false premise, otherwise accept.
```

## Claim types and statuses

Types, used when the type changes the evidence bar: `FACT`, `INFERENCE`, `CAUSAL CLAIM`, `FORECAST`, `VALUE / PREFERENCE`, `AUTHORITATIVE CONSTRAINT`.

Statuses: `verified`, `falsified`, `authoritative`, `supported inference`, `contested inference`, `unresolved`, `insufficient coverage`, `snapshot mismatch`.

## Focused decision

```text
Position: <the answer in one sentence>
Recommendation: <the action to take>
Decision-critical claims, each as:
- Claim: <one proposition>
- Type: <fact | inference | causal claim | forecast | value/preference | authoritative constraint>
- Evidence or authority: <location, excerpt, or who decided>
- Verdict impact: <what changes if it is wrong>
Best alternative: <strongest option not recommended>
Strongest counterargument: <best case against>
Primary failure mode: <likeliest way it goes wrong>
Falsifier: <evidence that would change my mind>
Unknowns: <material gaps>
Confidence basis: <HIGH | MEDIUM | LOW, because ...; no percentage>
```

## Supplied findings or audit

One row per supplied finding, no row limit; new findings use the same fields, kept apart.

```markdown
| Finding | Disposition | Direct evidence | Classification | Durable route | Confidence/limits |
|---|---|---|---|---|---|
| <F001> | <confirmed / falsified / narrowed / insufficient coverage> | <location, excerpt> | <bounded / foundation / architecture / mechanism / proof-only> | <where the fix belongs> | <limits> |
```

## Plan or contract review

One row per gate or obligation, keeping the requester's IDs: status, governing authority, evidence, impact, required correction.

## Incident

The smallest truthful timeline, causal claims, containment and recovery decisions, unknowns, and discriminating evidence. No option memo.

## Material propositions

For the decision model's cross-cutting claims.

```markdown
| ID | Type | Proposition | Source/excerpt | Evidence bar | Status | Verdict impact |
|---|---|---|---|---|---|---|
| <P1> | <FACT, INFERENCE, ...> | <one claim> | <excerpt or location> | <what settles it> | <a council status> | <High / Medium / Low> |
```

## Verifier result

```text
Proposition: <verbatim, as the focus gave it>
Mandate: <supporting evidence | disconfirming evidence | coverage audit>
Sources searched: <what was read>
Direct observations: <each with its location>
Result: <verified | falsified | partial | insufficient coverage | snapshot mismatch>
Limitations: <what could not be checked>
```

## Cross-examination response

```text
ID: <the finding, gate, or claim ID>
Response: <CONCEDE | MAINTAIN | NARROW | REVERSE>
Reason: <why>
Direct evidence: <locations or excerpts>
New claims: <if any; new material facts go to verification>
Falsifier: <what would overturn this response>
If true: <impact on the recommendation>
If false: <impact on the recommendation>
```

## Draft-verdict audit

```text
Audit result: <CLEAR | REVISE | STOP>
Findings, each as:
- Severity: <material | non-material>
- Category: <falsified premise | unsupported new claim | unanswered dissent | omitted material claim | preference-as-constraint | scope breach | action mismatch | vague reopen condition>
- Evidence: <draft location and the source showing the defect>
- Required correction: <the change that resolves it>
Unchecked limitations: <what the audit could not check>
```
