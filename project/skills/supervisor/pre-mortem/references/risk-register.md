# Risk register template

The register goes under Risks in the owner directive, with only the rows that survived the
merge, ordered irreversible first, then by damage, then by likelihood. Copy the block below:

```md
Pre-mortem horizon: HORIZON_DATE. Reasons are inferred by imagining the plan failed, not observed.

| # | Failure | Mechanism | First sign | Undo? | Damage | Raised by | Response |
|---|---|---|---|---|---|---|---|
| 1 | FAILURE | MECHANISM | FIRST_SIGN | UNDO | DAMAGE | RAISED_BY | RESPONSE |

Accepted without a response by the Human: ACCEPTED_RISKS
```

Replace the following:

- `HORIZON_DATE`: the date the seats were told the plan had failed by.
- `FAILURE`: what went wrong, as an outcome, for example `consumers can't install the package`.
- `MECHANISM`: why it happens, in one sentence.
- `FIRST_SIGN`: the earliest thing someone could observe, and when.
- `UNDO`: `yes`, `costly`, or `no`.
- `DAMAGE`: who is hurt and how badly, for example `3 CRM projects blocked for a day`.
- `RAISED_BY`: how many seats raised it, as `1/3`, `2/3`, and so on; not a vote.
- `RESPONSE`: exactly one of:
  - `mitigation: CONSTRAINT`, a constraint the Lead takes on;
  - `tripwire: SIGNAL > THRESHOLD, watched by WHO, then ACTION`;
  - `reserved: DECISION`, also added to the directive's reserved list.
- `ACCEPTED_RISKS`: the row numbers the Human accepted as they are, or `none`.
