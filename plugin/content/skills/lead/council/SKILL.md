---
name: council
description: "Settles one non-trivial architecture, code, product, research, strategy, policy, or incident decision with sealed independent reviewers, bounded verification, and one binding verdict the Lead drafts alone. Use when a decision has several defensible answers and is expensive or hard to reverse, or when the owner or the directive asks for one; not for a choice a cheap slice settles."
---

# Council

You run the protocol and adjudicate; the reviewers do the analysis, so don't do it for them. Each position is a reviewer started with `start_review` and no task, reading the lane branch; its `focus` carries the neutral brief, the case output contract and one role instruction, and its `title` the case ID, role and round.

```text
tier    -> the smallest sufficient tier, in one sentence
brief   -> neutral brief + case output contract + framing lint
sealed  -> start every Round 1 reviewer, end your turn, read nothing until all have handed back
model   -> reduce the reports to the case's natural decision units
verify  -> bounded Verifiers for material factual disputes only
cross   -> at most one challenge and response per disputed unit
draft   -> you draft the verdict alone
audit   -> an Auditor, per tier
verdict -> binding verdict and the tasks it starts
```

Re-anchor on this list whenever you're unsure which step is active.

## Tier

`lens`: one Independent. `debate` (default): Independent + Premise Challenger. `debate-with-proof`: plus Verifiers as needed and a draft audit. `high-risk`: plus optionally one Specialist, and a mandatory audit. Say why in one sentence, like "`debate-with-proof`, because the choice turns on one disputed throughput fact a Verifier can settle."

Reviewers of one model are sealed but correlated: treat their agreement as weak evidence, look hardest where they agree without independent sources, and list "single model family" under the verdict's limitations. `start_review`'s `role` picks another model where the kit has one.

## 1. Neutral brief

Fill the neutral brief in [references/report-format.md](references/report-format.md): the request verbatim, a decision question that clarifies it but never narrows it, facts with provenance apart from claims, constraints apart from preferences, the scope reviewers may read, and the snapshot commit. Build the case output contract from the request's natural units, asking only for what comparing evidence needs; the same file holds patterns, focus texts, claim types and statuses. Work only on a task's branch is read by starting reviewers with that `task`.

**Framing lint.** Repair the brief until it preserves the request, implies no preferred verdict, marks unverified premises as claims, excludes no option without authority, and keeps every unit the requester expects with no filler. `ask` the owner only when missing authority or scope would change the decision. Then start Round 1 at once.

## 2. Sealed Round 1

Start every reviewer in the same turn with the same brief and contract and one role instruction; every focus opens and closes with the two texts in the report patterns, verbatim.

- **Independent:** reason from first principles, recommend the strongest answer, expose decision-critical assumptions.
- **Premise Challenger:** test the framing and shared premises and build at least one viable counterfactual, without manufacturing disagreement.
- **Specialist:** apply only the requested domain semantics; expertise doesn't outrank stronger evidence or product authority.

Reveal no opinion, other report or agent ID. End your turn, and open no hand-back until all of Round 1 is in. A silent or failed reviewer gets one `message` or one replacement; a report missing decision content gets one `message` asking for it. `debate` may go on with one core reviewer missing only as `DEGRADED`; `lens` and `high-risk` may not. If relevant source moved past the snapshot, stop and report the mismatch.

## 3. Decision model

Reduce the reports to the smallest model that keeps every unit the verdict needs: three to five propositions for a focused decision, a row per finding, gate or obligation, a bounded timeline for an incident. Never merge, cap or drop requested findings; decompose instead. Only facts get factual verification, and insufficient coverage never shows a proposition false.

## 4. Verification and cross-examination

For a material factual dispute, start one to three Verifiers, each with one proposition verbatim, the sources and a distinct mandate: support, disconfirm, or audit coverage; never identical focuses as a vote. Where evidence leaves a material disagreement, `message` the original reviewer only the disputed unit and its evidence, for a cross-examination response in a second hand-back.

## 5. Draft, audit, verdict

**Draft alone**, weighing the outcome and hard constraints, which premises hold, fit under realistic failure, reversibility, and whether dissent has stronger evidence. Don't vote or average. Read the positions in reverse order of arrival and check whether that changes which one you favour.

**Audit** the draft (optional in `debate`, default in `debate-with-proof`, mandatory in `high-risk`) with an Auditor whose focus holds the brief, the reports by role, the model, the draft and the dissent. Resolve each material finding by revising, removing the claim, or returning it to its step.

**The verdict**, in the requester's words: the decision and why, which claims stand, required action and owner boundaries, validation, dissent and your answer, limitations and reopen conditions, and whether the run was degraded. Keep it with `note` in council as `<case-id>.md`.

## Stopping rules

- One sealed Round 1; one retry per reviewer; one challenge and response per disputed unit, new facts sent to verification; one audit round.
- No voting, group chat or shared room: in a shared room the most assertive model wins, not the best evidence.
- The council ends at the verdict: an `add_tasks` task carries its action as goal and acceptance, its boundaries as owned paths and out of scope, and its decisions in context.
- `cut` each reviewer once you have no further question for it: an idle one still costs money.
