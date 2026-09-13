# Review records

A review record keeps one review round: what a Reviewer found at one SHA, and your binding ruling on
each finding. It outlives the Reviewer, whose timeline goes when it is archived, and lets the plan
link one file instead of holding the findings.

Write one per Reviewer lane per round, before you rule on the slice, at
`docs/reviews/<plan slug>-<slice>-r<N>.md` or the directory `AGENTS.md` names. When no Reviewer ran,
your acceptance summary is the record; a council verdict becomes an ADR, and an ultra-review keeps
its own report. Use this template exactly:

```md
# Review: <plan slug> <slice> round <N> at <SHA>

Brief: <Task ID> · Axes: <spec, standards, structure> · Reviewer: <agent label> · Machine pass: <the result in one line, or none>

| ID | Severity | Axis | Where | Finding | Blocks acceptance | Ruling | Why |
|---|---|---|---|---|---|---|---|
| F1 | <P0–P3, with confidence> | <axis> | <path:line at the SHA> | <what fails, for whom, under which input> | <yes or no> | <accept, reject, or carry to slice> | <one line; for a rejection, the check that disproved it> |

Ambiguous rulings checked: <each (ambiguous) ruling and the reading you chose, or none>
Carried: <each carried finding and the slice that closes it, or none>
```

Copy every carried finding into the plan's Acceptance and recovery. A record is not edited after
you rule: the next round reviews a new SHA and gets a new file.
