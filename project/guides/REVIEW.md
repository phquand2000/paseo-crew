# Review records

A review record keeps one review round: what a Reviewer found at one SHA, and your binding ruling on
each finding. It outlives the Reviewer's timeline, which goes when its agent is archived, and it
lets the plan link one file instead of holding the findings.

Write one for every independent review, one file per Reviewer lane per round, before you rule on
the slice. When you read the diff yourself and no Reviewer ran, your acceptance summary is the
record. A council verdict becomes an ADR instead; an ultra-review keeps its own report, and the plan
links that.

The file is `docs/reviews/PLAN_SLUG-SLICE_ID-rN.md`, or the directory `AGENTS.md` names for reviews.
Copy this block:

```md
# Review: PLAN_SLUG SLICE_ID round N at SHA

Brief: TASK_ID · Axes: AXES · Reviewer: AGENT_LABEL · Machine pass: MACHINE_PASS

| ID | Severity | Axis | Where | Finding | Ruling | Why |
|---|---|---|---|---|---|---|
| FINDING_ID | SEVERITY | AXIS | PATH_LINE | FINDING | RULING | REASON |

Ambiguous rulings checked: AMBIGUOUS
Carried: CARRIED
```

A filled row:

```md
| F1 | P1 high | spec | src/invoices/export/csv.ts:41 | A filter that matches nothing throws, so the export answers 500 | accept | fixed in round 2 at 9b2e4a1; ADR-0008 sets the expected file |
```

Replace the following:

- `PLAN_SLUG`, `SLICE_ID`, `N`, `SHA`: the plan's file name without `.md`, the slice, the round
  counted from 1, and the exact commit reviewed.
- `TASK_ID`, `AXES`, `AGENT_LABEL`: the brief's Task ID, the axes it named (`spec`, `standards`,
  `structure`), and the Reviewer's agent label.
- `MACHINE_PASS`: the review tool's result in one line, or `none`.
- `FINDING_ID`, `SEVERITY`, `AXIS`, `PATH_LINE`: the Reviewer's numbering, its `P0` to `P3` with
  the confidence, its axis, and `path:line` at the reviewed SHA.
- `FINDING`: the failure in one sentence: what goes wrong, for whom, under which input.
- `RULING`: `accept` (fixed in this slice), `reject`, or `carry to SLICE_ID`.
- `REASON`: one line. For a rejection, the check that disconfirmed the finding.
- `AMBIGUOUS`: each `(ambiguous)` ruling the Reviewer checked and the reading you chose, or `none`.
- `CARRIED`: each carried finding and the slice that closes it, or `none`. Copy these into the
  plan's Acceptance and recovery.

A record is not edited after you rule. The next round is a new review at a new SHA, and gets a new
file.
