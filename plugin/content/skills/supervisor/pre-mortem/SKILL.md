---
name: pre-mortem
description: "Finds how a lane will have failed before it is opened, from failure stories written in the past tense, and turns their causes into the outcome, acceptance and out-of-scope wording of open_lane plus the decisions reserved for the Human. Use when a lane about to open has an outcome that is expensive, externally visible, or hard to reverse; not for work a revert undoes."
---

# Pre-mortem

You find how a lane fails while changing its directive is still free, so its outcome, acceptance and out-of-scope entries are earned rather than guessed. Say in one line why this lane warrants it: expensive, leaves this machine, touches money, credentials or unrecoverable data, or rests on one untested assumption.

The mechanism is the tense. Each story starts from the directive having been carried out and the outcome having **failed**, and is written in the past tense. A question about what could go wrong returns a polite list of generic risks; one about what did go wrong returns the specific failure nobody wanted to raise. Keep every prompt in that tense.

## Procedure

1. **Fix the plan.** Write the outcome, acceptance, appetite, deadline and assumptions exactly as `open_lane` will state them; a pre-mortem on unsettled wording returns risks about the wording.
2. **Name the failure.** A date and a failure the Human would recognise: "eight weeks from now the migration shipped and a week of orders can't be reconstructed", not "the project failed".
3. **Get two stories, three at most,** one per lens:
   - **Mechanism:** what state was wrong, which owner didn't hold it, what ordering or rollback broke.
   - **Assumption:** which stated premise turned out false, and what would have shown it early.
   - **Process** (when the work spans several tasks): where ownership overlapped, which decision nobody made, what acceptance let through.

   For most lanes write them yourself, one lens at a time, finishing each story before starting the next. When the code must be read to tell the story, `open_lane` a read-only lane instead: outcome "a pre-mortem report on <the plan>", any code change out of scope; then `message` its Lead to use one sealed reviewer per lens, each started with `start_review` whose focus holds the plan, the named failure and that lens in the past tense, with no other reviewer's answer. Use the Lead's report, then `close_lane` with land false.
4. **Merge, dropping nothing for being unlikely.** Keep every distinct cause; one you can't place in the system is marked unplaced, not deleted.
5. **Turn each cause into a row.** A cause the directive can't act on is a worry, not a risk.

   ```text
   R1  Failure        what had happened, past tense, one sentence
       Cause          the mechanism, assumption, or coordination gap behind it
       First signal   the earliest thing someone could observe, and where
       Mitigation     the smallest change to the plan, or none available
       Disposition    accepted | mitigated | no-go | reserved for the Human
   ```

   You decide each disposition. A `mitigated` row becomes an acceptance item or a sentence in the outcome; a `no-go` row becomes an `outOfScope` entry; an `accepted` row whose first signal the Lead can watch goes into the outcome as the point to stop and `ask`. A row is reserved only when its mitigation changes the project's concept: ask the Human before opening the lane.

The output can shrink the outcome, add an out-of-scope entry, or stop the lane; it never enlarges the appetite, and a better plan is a redesign for the Lead, not part of this. When similar work returns the same rows twice, add a notebook row and stop running it for that class of work.

## Ends in

The `open_lane` call with its fields filled, and the named failure with rows ordered by how early their first signal appears in `$SEATWORKS_STATE/pre-mortem/<lane-title>.md`.

The rule that matters most: every story is written in the past tense, and no story sees another.
