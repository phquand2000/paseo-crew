# Strategy template

Copy the block below to `.seatworks/records/strategy/CONCERN.md`.

```md
# Strategy: CONCERN

Status: STATUS
Scope: PROJECTS
Review by: REVIEW_DATE

## Inputs

| # | Document | Project | Date |
|---|---|---|---|
| 1 | INPUT_PATH | PROJECT | INPUT_DATE |

## Decisions found

| # | Decision | Reason given | Inputs | Kind |
|---|---|---|---|---|
| D1 | DECISION | REASON | INPUT_REFS | KIND |

## Diagnosis

DIAGNOSIS

## Guiding policies

### Where effort goes

- POLICY (from DECISION_REFS). Reasoning: REASONING

### Rules without exceptions

- RULE (from DECISION_REFS). Reason: REASON. Exceptions granted by: WHO

### How undecided cases get decided

- DECISION_PROCESS. Goes to the Human when: HUMAN_CASES

### Open for the Human

- OPEN_QUESTION

## Enforcing actions

| Policy | Action | Owner | Surface | Done when |
|---|---|---|---|---|
| POLICY_REF | ACTION | OWNER | SURFACE | DONE_CHECK |

## Tests

| Policy | Replayed decision | Settled it? | Enforced by |
|---|---|---|---|
| POLICY_REF | REPLAYED | SETTLED | ENFORCED_BY |

## Reviews

- REVIEW_DATE: REVIEW_FINDINGS
```

Replace the following:

- `CONCERN`: the concern in a few words, for example `data migrations`.
- `STATUS`: `draft`, `approved YYYY-MM-DD`, or `retired YYYY-MM-DD`.
- `PROJECTS`: the projects the strategy covers.
- `REVIEW_DATE`: about two months after approval for the first review, and within a year after
  that.
- `INPUT_PATH`, `PROJECT`, `INPUT_DATE`: the document's path, its project, and its date.
- `DECISION`, `REASON`: a decision found in the inputs, and the reason the document gave for it.
- `INPUT_REFS`: the input numbers that made or argued the decision, for example `1, 3`.
- `KIND`: `recurring`, `contested`, or `single`.
- `DIAGNOSIS`: a few sentences explaining why these decisions keep coming back, each citing
  decision rows.
- `POLICY`, `RULE`: a policy statement, and the decision rows it generalizes (`DECISION_REFS`).
- `REASONING`: why the policy takes this position, and what it gives up.
- `WHO`: who may grant an exception to the rule.
- `DECISION_PROCESS`: who decides new cases, and by which criteria.
- `HUMAN_CASES`: the kinds of cases that go to the Human, usually the irreversible ones.
- `OPEN_QUESTION`: a contested decision no policy resolves, or `none`.
- `POLICY_REF`: the policy an action or test belongs to.
- `ACTION`, `OWNER`, `SURFACE`, `DONE_CHECK`: the enforcing action, who carries it out, the file
  or check it changes, and how you know it's done.
- `REPLAYED`: the past decision or open question used to test the policy.
- `SETTLED`: `yes`, or `no` with what was still unclear.
- `ENFORCED_BY`: the check, rule, or review lens that makes people follow the policy.
- `REVIEW_FINDINGS`: at a review, whether the policies were applied, whether the actions were
  done, and what changed.
