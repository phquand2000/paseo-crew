---
name: review-orchestration
description: "Chooses the review a change needs (the Lead's own reading, sealed Reviewers on separate axes, or a scout sweep) and adjudicates each finding. Use before briefing any Reviewer, or when intake's Rigor line or a Reviewer condition calls for one."
---

# Review orchestration

Give a change the review its risk calls for, and no more. Sealed axes end in a ruling in your
acceptance summary; a sweep ends in one report at `docs/reviews/DATE-NAME-round-N.md` in the
target repository, which stays until its findings are routed and fixed (repo-refresh retires it
once its durable decisions reach their owners).

## Choose the lane

| Lane | When | Who reviews |
|---|---|---|
| Read it yourself | default: tiny or normal work, no review condition | you: `git diff "$base" "$head"` |
| Sealed axes | a condition under "Independent review" in your seat prompt applies | two or three Reviewer Peers, one axis each, same SHA and question |
| Sweep | high-risk work with weak proof, a large or unfamiliar surface, or a pre-merge audit where recall beats noise | four to ten scout Peers on overlapping concerns |

`.seatworks/WORKSPACE_PROTOCOL.md` overrides these counts where it sets strictness or a review
lane count. Done when you have named the lane and the reason.

## Sealed axes

1. **Fix the target and the question**: one commit or range and one question, identical for
   every Reviewer, such as "Is `SHA` ready to accept as the implementation of the S2 brief?".
   Done when both are in the Reviewer brief.

2. **Give each Reviewer one axis**, so their reports overlap little and their blind spots
   differ: spec conformance, standards, or structural, worded in `references/briefs.md`. Two
   Reviewers get spec conformance and structural. A protocol lane on a different model gets the
   same brief: other blind spots, not a vote. Give the Open Code Review pass
   (`Machine pass: run`) to the standards Reviewer, or the structural one when there are two,
   and `skip` to the rest; one run per round is enough. Done when each Reviewer has one axis
   and exactly one runs the machine pass.

3. **Brief and launch** each Reviewer from the Reviewer profile (`list_profiles`)
   with the axis Reviewer brief in `references/briefs.md` (relative to this skill's directory):
   disposition Reviewer, thinking `high`, slice brief and handoff as files, global constraints
   word for word. List each `(ambiguous)` ruling it implements under Rulings to check as a
   question; an unasked Reviewer checks your reading, not the directive's. Seal each: no other
   Reviewer's findings, none of your opinions, no instruction to leave an issue unflagged. Use
   `create_agent` with labels `review.name`, `review.round`, `review.axis`, and wait for the
   notifications. Done when every Reviewer has reported.

4. **Adjudicate and rule.** Adjudicate every finding (below), then issue one ruling: which
   findings you accept, which you reject, and why. When two reports conflict on a decision
   point, ask each Reviewer once about that point only (`send_agent_prompt`), then rule; if it
   stays open and is hard to reverse, take it to the council skill or the Human.

## Sweep

The sweep lane runs four to ten scout Peers on overlapping concerns and consolidates them into
one report. Its procedure, the concern allocation counts, the restart recovery, and the report
script are in `references/sweep.md`; the scout brief and concern lenses it uses are in
`references/briefs.md`. Read both before you launch a scout.

## Adjudicate every finding

For each finding from either lane:

1. **Restate the claim**: what fails, where, under which input or timing, and which contract it
   breaks. If you can't, ask the reporting Peer once for the missing piece; many false
   positives fall apart here.
2. **Run its disconfirming check**: read the path from input to failure, every upstream
   validation included; confirm who controls the input; run a targeted test if the test lane
   allows, or brief a Peer to write a failing one.
3. **Argue the other side once.** Are you dismissing it because the failure path is long, or
   crediting a protection you haven't seen in the code?
4. **Record the verdict** (true positive, false positive, or unresolved) with evidence: command
   and output, or file:line. A sweep records it in the report's Adjudication table; otherwise it
   goes in the acceptance summary.
5. **Look for chains and a shared cause.** Once every verdict is in, check whether rejected or
   low-rated findings combine into a real failure, such as an unvalidated input reaching a check
   dismissed as unreachable, and whether the true positives come from one missing mechanism or
   a wrong foundation. Record each chain and each shared cause, or `none`.
6. **Route the result by impact × probability.** A shared cause goes back as one fix of that
   mechanism, not one patch per finding, and as a new slice or a `DETOUR:` when it lies outside
   the outcome. Another true positive goes back as a fix round to the slice's owner, under the
   decompose skill's fix-round cap, but a low-impact, unlikely one (P3) gets the smallest fix or
   a line in the acceptance summary, never a new abstraction. A real finding outside every slice
   becomes a new slice; an unresolved one gets a verification slice or a line in the acceptance
   summary. False positives stay recorded with their evidence for the next round's notes.

Done when `grep -c TODO REPORT_PATH` prints `0`. Then commit the report on its own
(`git add REPORT_PATH && git commit -m "review: NAME round N"`) and archive the scouts.

After a fix round, check the fixes with the scoped re-review brief in `references/briefs.md`:
each finding is `ADDRESSED` or `NOT ADDRESSED`, and only new breakage inside the fix diff counts.
Run a fresh sweep round only when the fixes were broad or the lane is high-risk.

The rule that matters most: every finding gets a disconfirming check, a recorded verdict, and a
route, and the ruling is yours alone.
