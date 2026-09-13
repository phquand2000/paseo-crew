# Decision records

An ADR records one decision later work builds on: what was chosen, what was rejected, and what it
costs, so a successor or a Peer learns it without the chat. Write one when a ruling settles a
boundary the plan lists, is hard to reverse (a migration, a schema, a public API, a deletion),
chooses between options that would each work, or is an owner decision or council verdict the plan
depends on. A smaller ruling stays a `DECISION:` line and a row in the review record.

The file is `docs/adr/NNNN-short-title.md`, or the directory `AGENTS.md` names, numbered one past
the highest there and never reused. Use this template, and keep it under a page. Add the Options
section only when the decision is hard to reverse or its options need more than a clause each.

```md
# ADR-NNNN: <the decision, phrased as what was chosen>

Status: <proposed | accepted | rejected | superseded by ADR-MMMM> · Date: <YYYY-MM-DD> · Decider: <Human | Lead | council> · Supersedes: <ADR-NNNN or none>

In the context of <the situation>, facing <the force behind the decision>, we decided for <the
option> and neglected <the real alternatives>, to achieve <the benefit>, accepting that <the
downside>.

## Options

- <option>: <what it gets>; <what it costs>

Confirmation: <the test or check that shows the code still follows it>
Revisit when: <what would reopen it>
Evidence: <design doc, review record, SHAs, measurements>
```

- A ruling you marked `(ambiguous)` stays `proposed` until a Reviewer has checked it.
- Once an ADR is accepted or rejected, change only its Status line. A rejected ADR keeps its reason,
  so the question isn't argued again.
- To change a decision, write a new ADR that supersedes it and mark the old one `superseded by` the
  new one; the plan's Decisions line for the new ADR replaces the old line.
- A brief cites ADRs by number under Decided / ruled out, and the Peer reads the file.
