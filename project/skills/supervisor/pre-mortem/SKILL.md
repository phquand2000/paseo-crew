---
name: pre-mortem
description: "Finds the ways a directive will have failed before it is sent, using sealed read-only seats writing in the past tense, and returns the risk register, no-gos and reserved decisions the directive template asks for. Use before a directive whose outcome is expensive, externally visible, or hard to reverse; skip it for reversible work."
---

# Pre-mortem

Use this skill to find how a directive fails while changing it is still free, and to fill the
`Risks`, `No-gos` and `Reserved for the Human` fields of `.seatworks/guides/DIRECTIVE.md` with
something earned rather than guessed.

## When it is worth the seats

Run it when the outcome is expensive to reach, leaves this machine, touches money, credentials,
user-visible delivery or data you cannot restore, or rests on one untested assumption. Skip it for reversible work: two seats and a round of waiting buy nothing against a
change a `git revert` undoes. Say in one line which of those applies before you start.

## The one mechanism that matters

Ask what **did** go wrong, never what could. The seat is told the directive has already been
carried out and the outcome already failed, and it writes in the past tense. That grammatical
shift is the whole technique: a question in the conditional invites a polite list of generic
risks, and a question in the past tense invites the specific story of a real failure, including
the one nobody wanted to raise. Do not soften it back into "potential risks" anywhere in the
seat prompt.

## Procedure

1. **Fix the plan being tested.** Write the outcome, the success check, the appetite, and the
   assumptions it rests on, exactly as the directive will state them. A pre-mortem on an unsettled
   plan returns risks about the wording.
2. **Choose the horizon and the failure.** Name a date and a failure the Human would recognise:
   "eight weeks from now the migration shipped and a week of orders cannot be reconstructed",
   not "the project failed". A vague death gives vague causes.
3. **Seal two seats, three at most.** Each comes from the read-only Reviewer profile.
   Give each the same plan, the same named failure, and one distinct lens:

   - **Mechanism:** the failure happened inside the system. What state was wrong, which owner
     did not hold it, what ordering or lifecycle broke, what the rollback could not restore.
   - **Assumption:** the failure happened because a premise was false. Which stated fact turned
     out wrong, and what would have shown it early and cheaply.
   - **Process** (the third seat, when the work spans several slices or people): the failure
     happened in coordination. Where ownership overlapped, which decision nobody made, what
     the acceptance step let through.

   Each prompt is a brief from `.seatworks/guides/BRIEF.md` with disposition Architect and owned
   scope `none`. Never put the seats in one conversation and never show one seat another's
   answer: independence is what stops the first strong story from becoming the only story.
4. **Read what came back before you judge it.** Merge duplicates, keep every distinct cause, and
   drop nothing for being unlikely. A cause you cannot place in the system is still a cause; mark
   it unplaced rather than deleting it.
5. **Turn each cause into a row.** A risk the directive cannot act on is a worry, not a risk:

   ```text
   R1  Failure        what had happened, past tense, one sentence
       Cause          the mechanism, assumption, or coordination gap behind it
       First signal   the earliest thing someone could observe, and where
       Mitigation     the smallest change to the plan, or none available
       Disposition    accepted | mitigated | no-go | reserved for the Human
   ```

   `no-go` rows go into the directive's `No-gos`. A row is `reserved` only when its mitigation
   changes the project's concept; it goes into `Reserved for the Human` with the point at which
   the Lead must stop and ask. Anything the Lead can handle stays as `Risks`.
6. **Decide, then archive the seats.** You choose each row's disposition, no-gos included.
   Report the named failure, the rows in order of how early their first signal appears, and what
   you acted on. Archive every seat once its answer is in.

## What it must not become

- A second design review. The pre-mortem finds failures of this plan; a better plan is your call
  and a redesign is the Lead's job.
- A risk list with no owner and no signal. A row whose first signal is "when it breaks" has not
  been worked out yet.
- A reason to enlarge the appetite. The output can make you shrink the outcome, add a no-go, or
  stop; it never quietly buys more budget.
- A ritual. If the last three pre-mortems on similar work returned the same rows, put them in
  `AGENTS.md`, give the pattern one notebook row, and stop running it for that class of work.

The rule that matters most: the seats write in the past tense, and they never see each other.
