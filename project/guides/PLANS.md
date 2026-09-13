# Execution plans

A plan is the page your successor reads before touching anything: where one high-risk outcome
stands right now. Keep it true of now by replacing text instead of adding to it, because that reader
needs the present, and git already keeps every earlier version.

## Five rules

1. **Change the row, not the page.** A slice that moves changes its Status cell, a ruling that
   changes replaces its line, and a withdrawn direction is rewritten where it stands.
2. **Each section carries its size in its heading.** Stay inside it, and the whole plan stays under
   200 lines, short enough to be read end to end.
3. **What isn't state lives in its own file**: a ruling's reasoning in an ADR, a review in a review
   record, a design in a design doc. The plan gives the path. Those files survive a compaction just
   as the plan does, and your successor restarts from the plan and the files it links.
4. **The template's headings are the whole plan.** A new kind of fact goes under the heading whose
   question it answers.
5. **Before each save, ask whether the edit replaces a line or adds one.** If it adds one, name the
   section whose size it fits, or the file it belongs in instead.

## When a plan is required

Use `.seatworks/guides/FEATURE_INTAKE.md`. Tiny and bounded normal work need only the task or
issue. High-risk work gets a plan at `docs/exec-plans/active/SLUG.md`.

## Template

Copy this block and replace each UPPER_SNAKE word; the sizes in the headings stay.

```md
# OUTCOME_TITLE

Current state only: an update replaces its row or line. Guide: .seatworks/guides/PLANS.md
Directive: DIRECTIVE_TITLE · Lane: high-risk, LANE_REASON · Design: DESIGN_DOC or none

## Outcome and non-goals (up to 6 lines)

OUTCOME and its success check, from the directive.
Not doing: NON_GOALS.

## Boundaries (one row each)

| Boundary | State | Record |
|---|---|---|
| BOUNDARY | decided or open | ADR path, AGENTS.md line, or question ID |

## Route (up to 15 lines)

ROUTE: the direction chosen, its invariants, the likely wrong turns. Contracts belong in ADRs and a
slice's detail in its brief.

## Slices (one row each)

| ID | Outcome | Depends on | Acceptance | Status | SHA | Review |
|---|---|---|---|---|---|---|
| S1 | SLICE_OUTCOME | none | COMMAND; MANUAL_CHECK or none | planned | none | none |

## Open questions (one line each, deleted once answered)

- Q1: QUESTION (blocks SLICE_ID; answered by the Human or the Lead)

## Acceptance and recovery (up to 15 lines)

- Claim: CLAIM. Shown false by: EVIDENCE.
- Carried: FINDING, closed by SLICE_ID.
- Rollback: ROLLBACK.

## Decisions (one line per ADR)

- ADR-NNNN accepted: RULING

## Deviations (none until the outcome closes, then up to 15 lines)

none
```

Status is one of `planned`, `briefed`, `fix round N`, `blocked: REASON`, `accepted`, `cut`. The
Acceptance cell becomes the brief's Verification, so write it the way you would run it.

## Where everything else goes

| What you have | Where it goes | What the plan keeps |
|---|---|---|
| A slice event: briefed, handoff, fix round, accepted, retracted | the commit message | the slice's Status cell |
| Acceptance evidence | your acceptance summary, and the review record when a Reviewer ran | the SHA |
| A ruling that settles a boundary or is hard to reverse | an ADR, per `.seatworks/guides/ADR.md` | its line under Decisions |
| A ruling inside one slice, such as accepting a finding | a `DECISION:` line, and the review record | nothing |
| A Reviewer's findings and your ruling on each | a review record, per `.seatworks/guides/REVIEW.md` | the Review cell; carried findings under Acceptance |
| A design with trade-offs | `docs/design/SLUG.md`, frozen once accepted | the Design link |
| A rule for the whole repository | `AGENTS.md` | nothing; briefs cite it |
| An outage, a quota stop, a process error, a correction | your reply, and a `LESSON:` line | `blocked: REASON` while it lasts |
| A log or measurement longer than a screen | a file your summary or review record names | nothing |

Where `AGENTS.md` names its own directory for designs, decisions or reviews, use that one.

## A plan in the middle of its work

Three sections of a plan two slices in:

```md
## Route (up to 15 lines)

Export reuses listInvoices and formats rows in one pure function, so filtering keeps a single
owner. Invariant: amounts stay integer cents until the CSV cell. Likely wrong turn: streaming the
response before the 5,000-row cap has been measured.

## Slices (one row each)

| ID | Outcome | Depends on | Acceptance | Status | SHA | Review |
|---|---|---|---|---|---|---|
| S1 | Export route answers with a header row | none | npm test -- test/invoices/export; none | accepted | 4c1d9e2 | none |
| S2 | Filtered invoices export as CSV rows | S1 | npm test -- test/invoices/export; open the file in a spreadsheet | fix round 2 | 9b2e4a1 | docs/reviews/invoice-csv-S2-r2.md |
| S3 | Date-range filter applies to the export | S2 | npm test -- test/invoices/query; none | planned | none | none |

## Decisions (one line per ADR)

- ADR-0007 accepted: amounts are integer cents; floats ruled out
- ADR-0008 accepted: an empty result exports the header row only
```

When S2's second review came back, the page grew by nothing: its row moved from `fix round 1` to
`fix round 2` with the new SHA and review path, and the Peer's evidence on empty results became
ADR-0008 and one line under Decisions. Written instead as a new section, `## S2 round 2: findings
and ruling`, with the findings pasted under it, the same news is how a plan becomes an 800-line log.

## When the outcome closes

Set every slice to `accepted` or `cut`, write Deviations, then `git mv` the plan to
`docs/exec-plans/completed/` and commit it.

## What a plan holds to

A plan keeps settled architecture, contract cutover, reset, safety and data rules; divides work by
outcome or owner boundary; states acceptance as claims evidence could falsify; and leaves every
material product, architecture, contract or safety decision already made, in an ADR, before a slice
reaches it.

Change the row, not the page.
