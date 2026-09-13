# Decision records

An ADR records one decision that later work builds on, so a successor, a Reviewer or a Peer
reading `docs/adr/` learns what was decided, what was rejected and what it costs, without the chat.
Write one when a ruling does any of these:

- settles a boundary the plan lists: an interface other slices consume, a data model, a stateful
  system, or a decide-first seam in `AGENTS.md`;
- is hard to reverse: a migration, a schema, a public API, a deletion;
- chooses between two or more options that would each work;
- is an owner decision or a council verdict the plan depends on.

A smaller ruling, such as accepting a finding, opening a fix round, or settling a Peer's objection
inside one slice, stays a `DECISION:` line in your reply and a row in the review record.

The file is `docs/adr/NNNN-short-title.md`, or the directory `AGENTS.md` names for decisions.
Number it one past the highest number there, and never reuse a number.

## Short form

The default. Copy this block:

```md
# ADR-NNNN: TITLE

Status: STATUS · Date: DATE · Decider: DECIDER · Supersedes: SUPERSEDES

In the context of CONTEXT, facing CONCERN, we decided for OPTION and neglected ALTERNATIVES,
to achieve BENEFIT, accepting that DOWNSIDE.

Confirmation: CONFIRMATION
Revisit when: TRIGGER
Evidence: EVIDENCE
```

Filled in:

```md
# ADR-0008: An empty result exports the header row only

Status: accepted · Date: 2026-09-13 · Decider: Lead · Supersedes: none

In the context of the invoice CSV export, facing a filter that matches nothing while spreadsheet
imports still need a file, we decided for a file holding only the header row and neglected an empty
response and an error, to achieve one import path for every result, accepting that an empty
download looks like success to a user who expected rows.

Confirmation: test/invoices/export/empty.test.ts
Revisit when: users report an empty download as a fault
Evidence: docs/reviews/invoice-csv-S2-r2.md, 9b2e4a1
```

## Full form

For a decision that fixes a contract, is hard to reverse, or whose options need more than a clause
each to compare. Keep it under a page. Copy this block:

```md
# ADR-NNNN: TITLE

Status: STATUS · Date: DATE · Decider: DECIDER · Supersedes: SUPERSEDES

## Context and problem

CONTEXT and CONCERN

## Options considered

- OPTION: what it gets; what it costs

## Decision

The option chosen, and why it beats the others.

## Consequences

BENEFIT, and DOWNSIDE

## Confirmation

CONFIRMATION

## More information

EVIDENCE
```

Replace the following:

- `TITLE`: the decision phrased as what was chosen, as in the example.
- `STATUS`: `proposed`, `accepted`, `rejected`, or `superseded by ADR-MMMM`. A ruling you marked
  `(ambiguous)` stays `proposed` until a Reviewer has checked it.
- `DECIDER`: `Human` for an owner decision, `Lead` for your ruling, `council` for a council verdict.
- `SUPERSEDES`: the ADR this one replaces, or `none`.
- `CONTEXT`, `CONCERN`, `OPTION`, `ALTERNATIVES`: the situation and the force behind the decision,
  stated neutrally, then the option chosen and the real ones rejected.
- `BENEFIT`, `DOWNSIDE`: what the decision gets and what it costs; every decision costs something.
- `CONFIRMATION`, `TRIGGER`: how anyone can check the code still follows it, and what would reopen it.
- `EVIDENCE`: links to the design doc, the review record, SHAs and measurements.

## Lifecycle

- Once an ADR is `accepted` or `rejected`, change only its Status line. A rejected ADR keeps its
  reason, so the question isn't argued again.
- To change a decision, write a new ADR with `Supersedes: ADR-NNNN`, and set the old one's Status to
  `superseded by ADR-MMMM`.
- The plan's Decisions list carries each ADR on one line; a successor's line replaces the one it
  supersedes.
- A brief cites ADRs by number in its `Decided / ruled out` field, and the Peer reads the file.
