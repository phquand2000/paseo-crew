# Council output patterns

These are patterns to combine, not one schema to copy. Pick and adapt only what the case needs,
and put the result into the brief's CASE OUTPUT CONTRACT. Copying every heading into every seat
prompt produces filler and can cap what a seat reports.

## Evidence discipline for every case

Whatever the shape, the output lets you tell apart direct observation, authority, inference,
and uncertainty, and shows which action each material conclusion changes. Ask for falsifiers or
reopen conditions when they bear on the decision. Leave out sections that would only be filled
for form's sake.

## Focused decision

For choosing one architecture, product, policy, or strategy route. Drop headings that don't
help this decision.

```text
POSITION
RECOMMENDATION

DECISION-SHAPING CLAIMS
- CLAIM
- TYPE: fact | inference | causal claim | forecast | value/preference | authoritative constraint
- EVIDENCE OR AUTHORITY
- VERDICT IMPACT

BEST ALTERNATIVE
STRONGEST COUNTERARGUMENT
PRIMARY FAILURE MODE
FALSIFIER: what would change my mind
UNKNOWNS
CONFIDENCE BASIS: high | medium | low, because ...
```

Ask for a confidence basis in words rather than a percentage; a number invites false precision.

## Supplied findings or audit

One row per supplied finding, with no cap on the number of rows.

```markdown
| Finding | Disposition | Direct evidence | Classification | Durable route | Confidence and limits |
|---|---|---|---|---|---|
| F001 | confirmed / falsified / narrowed / insufficient coverage | ... | bounded / foundation / architecture / mechanism / proof-only | ... | ... |
```

Add a short cross-cutting synthesis only for causal or ownership conclusions that span several
findings. New findings use the same fields and stay visibly separate from the supplied ones.

## Plan or contract review

One row per gate or obligation, keeping its identity from the plan: status, the authority that
governs it, evidence, impact, and the correction needed.

## Incident

The smallest truthful timeline, then the causal claims, the containment and recovery decisions,
the unknowns, and the evidence that would tell the competing explanations apart. An incident
doesn't need an option memo.

## Material propositions

For a focused decision, or for cross-cutting claims above a larger ledger of findings or gates.

```markdown
| ID | Type | Proposition | Source or excerpt | Evidence bar | Status | Verdict impact |
|---|---|---|---|---|---|---|
| P1 | FACT | ... | seat role, excerpt | direct source evidence | unresolved | high |
```

Quote the report excerpt or cite the source location where you can. A proposition is material
only when changing its truth or authority could change the verdict or the required action.

## Verifier output

```text
PROPOSITION CHECKED
MANDATE: support | disconfirm | coverage
SOURCES OR LOCATIONS SEARCHED
DIRECT OBSERVATIONS
RESULT: verified | falsified | partial | insufficient coverage | snapshot mismatch
LIMITATIONS
```

## Cross-examination response

Rename `PROPOSITION_ID` to the case's own identifier, such as `FINDING_ID`, `GATE_ID`, or
`CLAIM_ID`.

```text
PROPOSITION_ID
RESPONSE: concede | maintain | narrow | reverse
REASON
DIRECT EVIDENCE
NEW CLAIMS, if any
FALSIFIER
IF THE PROPOSITION IS TRUE, IMPACT ON THE RECOMMENDATION
IF THE PROPOSITION IS FALSE, IMPACT ON THE RECOMMENDATION
```

A new material factual claim goes to verification; it doesn't open a free debate.

## Draft-verdict audit

```text
AUDIT RESULT: clear | revise | stop

FINDINGS
- SEVERITY: material | non-material
- CATEGORY: falsified premise | unsupported new claim | unanswered dissent |
  omitted material claim | preference treated as constraint | scope breach |
  action mismatch | vague reopen condition
- EVIDENCE
- REQUIRED CORRECTION

UNCHECKED LIMITATIONS
```

The Auditor points out defects. It doesn't issue or replace the verdict.

## Binding verdict

Shape the verdict to the case and its vocabulary. Without needing these as literal headings, it
covers:

- the decision and why;
- the material claims accepted, rejected, and left unproven;
- the required action and the owner boundaries;
- what must not be touched;
- the validation that will show the action worked;
- material dissent, and your answer to it;
- limitations: soft isolation, a degraded run, incomplete coverage, a skipped audit, a
  substituted model;
- reopen conditions: the evidence that would justify revisiting the decision.

For a supplied set of findings, give every finding an explicit disposition.
