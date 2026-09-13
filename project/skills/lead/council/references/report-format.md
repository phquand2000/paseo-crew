# Council output-contract patterns

Composable patterns, not a universal schema: adapt only what the case needs, and never copy every
heading into every seat prompt.

## Shared evidence discipline

Every contract should separate direct observation, authority, inference, and uncertainty, and
show which action each material conclusion changes. Ask for falsifiers or reopen conditions when
they matter. No filler sections.

## Focused decision pattern

For choosing one architecture, product, policy, or strategy route.

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

## Supplied-findings or audit pattern

One row per supplied finding, no row limit.

```markdown
| Finding | Disposition | Direct evidence | Classification | Durable route | Confidence/limits |
|---|---|---|---|---|---|
| <F001> | <confirmed / falsified / narrowed / insufficient coverage> | <location, excerpt> | <bounded / foundation / architecture / mechanism / proof-only> | <where the fix belongs> | <limits> |
```

Add a cross-cutting synthesis only for causal or ownership conclusions spanning findings. New
findings use the same fields, kept apart from supplied ones.

## Plan or contract review pattern

One row per gate or obligation, keeping the user's requirement IDs: status, governing authority,
evidence, impact, required correction.

## Incident pattern

The smallest truthful timeline, causal claims, containment and recovery decisions, unknowns, and
discriminating evidence. No option memo.

## Material proposition pattern

For a focused decision, or cross-cutting claims above a finding or gate ledger. Material means
its truth or authority could change the verdict or required action.

```markdown
| ID | Type | Proposition | Source/excerpt | Evidence bar | Status | Verdict impact |
|---|---|---|---|---|---|---|
| <P1> | <FACT, INFERENCE, ...> | <one claim> | <seat excerpt or location> | <what settles it> | <a SKILL.md status> | <High / Medium / Low> |
```

## Cross-examination response

```text
ID: <the case's natural finding, gate, or claim ID>
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

The Auditor finds defects; it never issues or replaces the verdict.
