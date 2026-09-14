---
name: pre-mortem
description: "Finds how a directive will have failed before it is sent, from two or three sealed read-only reviewers writing in the past tense, and turns their causes into the risks, no-gos and reserved decisions the directive template asks for. Use before a directive whose outcome is expensive, externally visible, or hard to reverse; not for work a revert undoes."
---

# Pre-mortem

You find how a directive fails while changing it is still free, so its `Risks`, `No-gos` and `Reserved for the Human` fields in `~/.local/share/seatworks-v2/guides/DIRECTIVE.md` are earned rather than guessed. Say in one line why this directive warrants it: expensive, leaves this machine, touches money, credentials or unrecoverable data, or rests on one untested assumption.

The mechanism is the tense. Each reviewer is told the directive was carried out and the outcome **did** fail, and writes that story in the past tense. A question about what could go wrong returns a polite list of generic risks; one about what did go wrong returns the specific failure nobody wanted to raise. Keep every prompt in that tense.

## Procedure

1. **Fix the plan.** Write the outcome, success check, appetite and assumptions exactly as the directive will state them; a pre-mortem on unsettled wording returns risks about the wording.
2. **Name the failure.** A date and a failure the Human would recognise: "eight weeks from now the migration shipped and a week of orders can't be reconstructed", not "the project failed".
3. **Run two sealed reviewers, three at most,** each a fresh agent from the `reviewer` profile with a brief from `~/.local/share/seatworks-v2/guides/BRIEF.md` (disposition Architect, owned scope `none`), the same plan and failure, and one lens:
   - **Mechanism:** what state was wrong, which owner didn't hold it, what ordering or rollback broke.
   - **Assumption:** which stated premise turned out false, and what would have shown it early.
   - **Process** (when the work spans several slices): where ownership overlapped, which decision nobody made, what acceptance let through.

   No reviewer sees another's answer: independence stops the first strong story from becoming the only one.
4. **Merge, dropping nothing for being unlikely.** Keep every distinct cause; one you can't place in the system is marked unplaced, not deleted.
5. **Turn each cause into a row.** A cause the directive can't act on is a worry, not a risk.

   ```text
   R1  Failure        what had happened, past tense, one sentence
       Cause          the mechanism, assumption, or coordination gap behind it
       First signal   the earliest thing someone could observe, and where
       Mitigation     the smallest change to the plan, or none available
       Disposition    accepted | mitigated | no-go | reserved for the Human
   ```

   You decide each disposition. `no-go` rows go into No-gos. A row is reserved only when its mitigation changes the project's concept, and it names the point where the Lead must stop and ask; everything else stays under Risks.

The output can shrink the outcome, add a no-go, or stop the directive; it never enlarges the appetite, and a better plan is a redesign for the Lead, not part of this. When similar work returns the same rows three times, put them in `AGENTS.md` and stop running it for that class of work.

## Ends in

The directive's filled fields, and a report of the named failure and the rows ordered by how early their first signal appears. Archive each reviewer once its answer is in.

The rule that matters most: the reviewers write in the past tense, and never see each other.
