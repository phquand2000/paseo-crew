# Owner directive template

A directive carries only decisions the Human has settled: the outcome and the limits, never the
solution, because framing is the Lead's. Copy the block below and send it to the Lead as it is.

```text
OWNER DIRECTIVE: TITLE

Problem story
PROBLEM_STORY

Outcome
OUTCOME

Success check
SUCCESS_CHECK

Appetite
APPETITE

Constraints
- CONSTRAINT
- Known hard parts: HARD_PARTS

No-gos
- NO_GO

Reserved for the Human
- RESERVED_DECISION: REASON_IRREVERSIBLE. Come back before: TRIGGER_POINT

Open questions for you to settle
- OPEN_QUESTION

When the design settles
ON_CONVERGENCE

Risks
RISK_REGISTER

Workspace protocol: PROTOCOL_STATUS
```

Replace the following:

- `TITLE`: a short name for the outcome, for example `Voice SDK on the private registry`.
- `PROBLEM_STORY`: the most recent real occurrence of the problem: when, who, what they did, and
  what it cost. Two to five sentences.
- `OUTCOME`: the observable change the Human wants, without naming an implementation. If the
  Human fixed a solution, put it under Constraints with its reason.
- `SUCCESS_CHECK`: a command and its expected output, a metric with a threshold, or a named
  screen someone looks at.
- `APPETITE`: what the outcome is worth, for example `two days of Lead time; stop and ask if it
  needs more`. It's a budget, not an estimate.
- `CONSTRAINT`: one settled limit per line: platforms, dependencies, deadlines, a solution the
  Human fixed.
- `HARD_PARTS`: traps the Human already suspects, or `none known`.
- `NO_GO`: one out-of-scope item per line, or `none`.
- `RESERVED_DECISION`: an irreversible decision the Lead leaves to the Human.
- `REASON_IRREVERSIBLE`: why it can't be undone cheaply.
- `TRIGGER_POINT`: the moment the Lead stops and asks, for example `before the first publish`.
- `OPEN_QUESTION`: a question the Human explicitly left to the Lead, or `none`. A question the
  Human still has to answer doesn't belong here; settle it first.
- `ON_CONVERGENCE`: what the Lead does once a hard design decision is settled, either
  `report the verdict and wait for the Human` or `proceed, and report at acceptance`. Choose the
  first when the Human wants to check the design against their own concept first.
- `RISK_REGISTER`: the table from the pre-mortem skill, or delete the Risks section when no
  pre-mortem ran.
- `PROTOCOL_STATUS`: `WORKSPACE_PROTOCOL.md present` or `none; run on your defaults`.
