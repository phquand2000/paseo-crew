---
name: decision-records
description: "Records architecture decisions as numbered ADRs in docs/adr, supersedes rather than edits them, and keeps the CONTEXT.md domain glossary. Use when a decision is hard to reverse, surprising, and a real trade-off, or when two terms name one concept."
---

# Decision records

Use this skill to write down the few decisions a future reader would otherwise reverse by
accident, and to keep one name for each domain concept, so Peers and successors don't re-decide
settled questions. It produces ADR files at `docs/adr/NNNN-slug.md` and entries in `CONTEXT.md`
at the target repository's root, each committed on its own.

## Decide whether it needs an ADR

Write an ADR only when all three of these hold:

1. **Hard to reverse**: undoing it would take a migration, a contract change, or rework across
   several owners.
2. **Surprising without context**: a capable newcomer reading the code would be tempted to
   "fix" it.
3. **A real trade-off**: at least one serious alternative existed and lost for a reason you can
   state.

When one of them fails, record the decision where it is used instead: the ExecPlan's Decision
log for work in progress, `AGENTS.md` for a constraint every agent needs, or a code comment for
a local choice. An ADR for every choice buries the ones that matter.

Typical subjects: the shape of the architecture, integration between parts of the system,
technology choices that lock you in, boundary and scope decisions including an explicit "no",
deliberate deviations from the obvious approach, constraints the code doesn't show, and a
rejected proposal that is likely to come back.

A council verdict that settles an architecturally significant question gets an ADR, and the
verdict's reopen conditions become the ADR's.

## Write an ADR

1. **Find the convention.** Look for an existing ADR directory (`docs/adr`, `doc/adr`,
   `docs/decisions`, or the path in a `.adr-dir` file) and follow its format and numbering;
   otherwise use `docs/adr/`. Don't add a second scheme next to an existing one, because it
   splits the record in two. The Lead guard lets you write only under `docs/` or `doc/`, so an
   ADR directory elsewhere gets its ADRs from an Engineer Peer. Done when you know the
   directory.
2. **Take the next number:**

   ```bash
   ls docs/adr | grep -E '^[0-9]{4}-' | sort | tail -n 1
   ```

   Add one to the highest number and pad it to four digits. Never reuse a number, not even a
   rejected or withdrawn ADR's, because briefs and commit messages cite them. Done when no
   existing file carries the number.
3. **Write it** from the template below, filling each placeholder as described under it, in a
   page or two. Done when every section has content, and `Status` and `Decided by` have values.
4. **Set the status and the decider.** A new ADR is `proposed` until its decider accepts it. You
   accept technical decisions within your authority. A decision reserved for the Human by your
   seat prompt stays `proposed` until an owner directive accepts it, and `Decided by` names that
   directive. Done when `Decided by` matches who actually decided.
5. **Commit it on its own:**

   ```bash
   git add docs/adr/NNNN-slug.md && git commit -m "adr: NNNN slug"
   ```

   Done when `git show --stat HEAD` lists only the ADR, plus the superseded ADR when there is
   one.

Copy this block to `docs/adr/NNNN-slug.md`:

```md
# NNNN. TITLE

Status: proposed
Date: DATE
Decided by: DECIDER
Supersedes: SUPERSEDED_ADR

## Context

CONTEXT

## Decision

We will DECISION.

## Consequences

- CONSEQUENCE

## Rejected alternatives

- ALTERNATIVE: REASON_IT_LOST

## Reopen when

- REOPEN_CONDITION

Links: LINKS
```

Replace the following, repeating the list lines as needed:

- `NNNN` and `TITLE`: the number from step 2, and a short noun phrase such as
  `Amounts stored as integer cents`.
- `DATE`: the date in `YYYY-MM-DD` form.
- `DECIDER`: `Lead`, or `Human (owner directive of DATE)`.
- `SUPERSEDED_ADR`: the number of the ADR this one replaces, or `none`.
- `CONTEXT`: the forces at play in neutral terms, giving each option its strongest case, so a
  reader can see why a reasonable person might have chosen otherwise.
- `DECISION`: active voice, completing "We will".
- `CONSEQUENCE`: every result, including what becomes harder, what it costs, and the new risks.
  A list of only benefits reads as advocacy, and the reader stops trusting it.
- `ALTERNATIVE`, `REASON_IT_LOST`: each rejected option with the reason it lost; this line is
  what keeps it from being proposed again.
- `REOPEN_CONDITION`: the evidence that would justify revisiting the decision.
- `LINKS`: the council verdict, the ExecPlan, or the commit the decision came from.

## Change a decision

Supersede instead of editing. Write a new ADR with `Supersedes: NNNN`, and in the same commit
change only the old ADR's status line to `superseded by MMMM`. The old text stays as written,
because a reader judging the new decision needs what was known and decided at the time. Fixing
a typo or a broken link is fine.

Before proposing a change that contradicts an accepted ADR, read the ADR and its reopen
conditions, and reopen it only with evidence that meets one. Settle a contested reopen with the
council skill, and take a reopen of a Human decision to the Human.

## Use ADRs in briefs

In each brief's "Decided / ruled out" field, cite the ADRs that touch the owned scope by number,
one line each, for example `ADR 0007: amounts are integer cents; floats ruled out`. Peers read
the files for the detail. Cite rejected alternatives the same way, so a Peer doesn't spend its
context rediscovering a closed road. Done when every ADR whose scope overlaps the brief's owned
scope is cited.

When a Peer's `REOPEN_REQUEST` targets a decision an ADR covers, answer it against that ADR's
reopen conditions.

When the Human or a council rejects a proposal for a lasting reason, record an ADR whose
decision reads "We will not …", so the proposal isn't raised again.

## Keep the glossary

A term an ADR settles gets an entry in the repository's `CONTEXT.md` glossary, whose rules are
in `references/glossary.md` (relative to this skill's directory): one name per concept, the
rejected names under `Avoid`, and a conflicting term settled before the next brief.

The rule that matters most: record the decisions that are hard to reverse, surprising, and
contested, and supersede them rather than rewrite them.
