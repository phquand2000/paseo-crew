# Execution plans

A plan is the one page a successor reads to resume a high-risk outcome: where it stands now. Git
keeps every earlier version, so the plan holds the present and nothing else.

High-risk work, per `.seatworks/guides/FEATURE_INTAKE.md`, gets `docs/exec-plans/active/SLUG.md`;
tiny and normal work need only the task. Use this template exactly: its headings are the whole
plan, and the size in each heading is that section's limit, which keeps the page under 200 lines
and short enough to read end to end.

```md
# <outcome title>

Current state only: an update replaces its row or line. Guide: .seatworks/guides/PLANS.md
Directive: <directive title> · Lane: high-risk, <reason> · Design: <docs/design/SLUG.md or none>

## Outcome and non-goals (up to 6 lines)

<the outcome and its success check, from the directive>
Not doing: <non-goals>

## Boundaries (one row each)

| Boundary | State | Record |
|---|---|---|
| <interface, data model, stateful system, or decide-first seam> | <decided or open> | <ADR path, AGENTS.md line, or Q-id> |

## Route (up to 15 lines)

<the direction chosen, its invariants, the likely wrong turns; contracts go in ADRs, slice detail in briefs>

## Slices (one row each)

| ID | Outcome | Depends on | Acceptance | Status | SHA | Review |
|---|---|---|---|---|---|---|
| S1 | <what a caller can observe> | none | <command as you would run it>; <manual check or none> | planned | none | none |

## Open questions (one line each, deleted once answered)

- Q1: <question> (blocks <slice>; answered by <Human or Lead>)

## Acceptance and recovery (up to 15 lines)

- Claim: <claim>. Shown false by: <evidence>.
- Carried: <finding>, closed by <slice>.
- Rollback: <how>.

## Decisions (one line per ADR)

- ADR-NNNN <status>: <ruling>

## Deviations (none until the outcome closes, then up to 15 lines)

none
```

Status is `planned`, `briefed`, `fix round N`, `blocked: <reason>`, `accepted` or `cut`. The
Acceptance cell becomes the brief's Verification.

## Keep it the present

Before each save, ask whether the edit replaces a line or adds one. An added line must fit its
section's size, or it belongs in its own file. The same news, written both ways:

```text
S2's second review comes back
  write  | S2 | ... | fix round 2 | 9b2e4a1 | docs/reviews/invoice-csv-S2-r2.md |
  not    a new "## S2 round 2" section with the findings pasted under it

A new ruling replaces one the plan relied on
  write  - ADR-0009 accepted: exports buffer up to 5,000 rows    (replacing the ADR-0006 line)
  not    a Route paragraph explaining why streaming was dropped

A quota stop pauses S3
  write  | S3 | ... | blocked: API quota until 14:00 | none | none |
  not    an incident log under Acceptance and recovery
```

## Where everything else goes

| What you have | Where it goes | What the plan keeps |
|---|---|---|
| A slice event: briefed, handoff, fix round, accepted | the commit message | the Status cell |
| A ruling that settles a boundary or is hard to reverse | an ADR, per `.seatworks/guides/ADR.md` | one line under Decisions |
| A ruling inside one slice | a `DECISION:` line and the review record | nothing |
| A Reviewer's findings and your ruling on each | a review record, per `.seatworks/guides/REVIEW.md` | the Review cell; carried findings under Acceptance and recovery |
| A design with trade-offs | `docs/design/SLUG.md`, frozen once accepted | the Design link |
| An outage, a correction, a log longer than a screen | your reply, a `LESSON:` line, or a file you name | `blocked: <reason>` while it lasts |

Where `AGENTS.md` names its own directory for designs, decisions or reviews, use that one. When the
outcome closes, set every slice to `accepted` or `cut`, write Deviations, `git mv` the plan to
`docs/exec-plans/completed/`, and commit it.

Change the row, not the page.
