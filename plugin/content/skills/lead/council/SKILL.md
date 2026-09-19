---
name: council
description: "Settles one non-trivial architecture, code, product, research, strategy, policy, or incident decision with sealed independent reviewers, bounded verification, and one binding verdict the Lead drafts alone. Use when a decision has several defensible answers and is expensive or hard to reverse, or when the owner or the directive asks for one; not for a choice a cheap slice settles."
---

# Council

You run the protocol and adjudicate; the reviewers do the analysis, so don't do a reviewer's analysis yourself. Each position is a reviewer started with `start_review` and no task, so it reads the lane branch; its `focus` carries the neutral brief, the case output contract and its one role instruction, and its `title` carries the case ID, role and round.

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

- `lens`: one Independent.
- `debate` (default): Independent + Premise Challenger.
- `debate-with-proof`: `debate`, plus Verifiers as needed and a draft audit by default.
- `high-risk`: Independent + Premise Challenger, optionally one Specialist, Verifiers as needed, mandatory draft audit.

The sentence reads like: "`debate-with-proof`, because the choice between the two queue designs turns on one disputed throughput fact a Verifier can settle."

Reviewers run one role's model unless you name another with `start_review`'s `role`, and one kit may hold several roles that review. Where they are the same model, sealing removes contamination but not correlation: treat agreement between the Independent and the Challenger as weak evidence, look hardest where they agree without independent sources, and list "single model family" under the verdict's limitations when that is what it was.

## 1. Neutral brief

```text
Case ID: <stable URL-safe ID, reused on every title>
Original request: <the message that asked for the council, verbatim, never your summary>
Decision question: <may clarify the request, never narrow or replace it>
Observable outcome: <what is true in the world once the decision is right>
Authoritative facts: <decisions or verified facts, each with provenance>
Direct observations: <source-backed observations with exact locations>
Unverified claims: <every other premise>
Unknowns: <material gaps no one has resolved>
Hard constraints: <non-negotiable limits, apart from preferences>
Preferences: <priority order among soft goals>
Authorized scope and sources: <what reviewers may inspect>
Snapshot: <the lane branch commit reviewers read>
Requested output: <the work product the requester expects>
Case output contract: <the sections or fields each reviewer returns in done's findings>
```

Build the output contract from the request's natural units, the same ones the decision model keeps, asking only for what comparing evidence needs: direct evidence, inference labels, material unknowns, falsifiers, and an actionable conclusion. Force no heading that doesn't fit the case; [references/report-format.md](references/report-format.md) holds adaptable patterns, the focus texts, and the claim types and statuses. Reviewers read the lane branch, or a task's branch when you start them with that `task`; you do not commit or merge yourself. Work still on a task's branch is read by starting each reviewer with that task, and anything not yet committed reaches a branch through a task first. Name the commit they read as the snapshot.

**Framing lint.** Repair the brief until each answer is yes: it preserves the original request; no wording implies a preferred verdict; every fact has provenance and unverified premises are claims; constraints are apart from preferences; no option is excluded without authority; reviewers can investigate independently; the output contract keeps every unit the requester expects and creates no filler. `ask` the owner only when missing authority or scope would change the decision. Then start Round 1 at once, with no further analysis.

## 2. Sealed Round 1

Start every reviewer in the same turn with the same brief and output contract and exactly one role instruction. A Specialist may get extra domain fields that reveal no view and no preferred answer.

- **Independent:** reason from first principles, recommend the strongest answer, expose decision-critical assumptions.
- **Premise Challenger:** test the framing and shared premises and build at least one viable counterfactual, stating what it would make unnecessary. Don't manufacture disagreement; the incumbent framing may survive.
- **Specialist:** apply only the requested domain semantics; expertise doesn't outrank stronger evidence or product authority.

Every focus opens and closes with the two texts under "Focus opening and closing" in [references/report-format.md](references/report-format.md), copied verbatim.

- Reveal no opinion of yours, other report or agent ID.
- End your turn after starting them. Each handback arrives as mail with its file path; open none until every Round 1 handback is in.
- A reviewer that goes silent or fails gets one `message` asking it to finish, or one fresh replacement with the same focus. A report missing decision content gets one `message` asking for that content, never for cosmetics.
- `lens` issues no verdict without its reviewer; `debate` tiers may continue with one core reviewer missing only as `DEGRADED`; `high-risk` needs both core reviewers.
- If decision-relevant source moved past the snapshot, stop and report the mismatch.

## 3. Decision model

Reduce the reports to the smallest model that keeps every unit the verdict needs: three to five material propositions for a focused decision; one row per supplied finding for an audit; one row per gate or obligation for a plan review; a bounded timeline and causal model for an incident; alternatives with discriminating tests for research. Never merge, cap or drop requested findings to fit; decompose by sub-question instead.

Type a claim only when its type changes the evidence bar, and give each proposition a status; both lists are under "Claim types and statuses" in the report patterns. Only facts get factual verification, and insufficient coverage never shows a proposition false.

## 4. Verification and cross-examination

For a material factual dispute, start one to three Verifiers with `start_review`, each focus holding one proposition verbatim, the sources, the opening text, a distinct mandate (find supporting evidence, find disconfirming evidence, or audit coverage), and the Verifier result from the report patterns. Never send identical focuses as a vote.

When evidence leaves a material disagreement, `message` the original reviewer only the disputed unit and its evidence, and require the cross-examination response from the report patterns in a second `done`. Skip both steps when every report agrees and no factual or framing dispute remains.

## 5. Draft, audit, verdict

**Draft alone**, weighing:

- the authoritative outcome and hard constraints, and the options they exclude;
- verified and unresolved premises;
- fit under realistic failure, and robustness if an assumption is wrong;
- reversibility;
- whether serious dissent has stronger evidence.

Don't vote or average: the number of reviewers never creates authority. Read the positions in reverse order of arrival and check whether that changes which one you favour; being read first is not evidence.

**Audit** the draft: optional in `debate` (use it for material dissent, high-impact unresolved claims or a fragile chain), the default in `debate-with-proof`, mandatory in `high-risk`. The Auditor is a reviewer started with `start_review` whose focus holds, with no agent IDs:

- the opening text without its ban on reading other work, and the closing text;
- the brief, every valid report attributed by role, the decision model and verified evidence;
- the draft and material dissent;
- the ask for the draft-verdict audit from the report patterns.

The audit doesn't replace the verdict: resolve each material finding by revising, removing the claim, or returning it to its step.

**The verdict**, in the requester's vocabulary, conveys:

- the decision and why, and accepted versus rejected or unproven claims, with a disposition per finding when a finding set was supplied;
- required action and owner boundaries, do-not-touch constraints, and validation;
- material dissent and your answer to it;
- limitations and reopen conditions, and whether the run was degraded, coverage incomplete, or an optional audit skipped.

Write it to `$SEATWORKS_STATE/council/<case-id>.md`, not into the repository.

## Stopping rules

- One sealed Round 1; one retry or replacement per reviewer; one challenge and one response per disputed unit, with new factual claims sent to verification, not debate; one audit round.
- No voting, group chat or shared room: in a shared room the most assertive model wins, not the best evidence.
- The council ends at the verdict. Reviewers don't implement; `start_task` carries the required action as goal and acceptance, the boundaries as owned paths and out of scope, and the verdict's decisions in context.
- `cut` each reviewer as soon as you have no further question for it — one you may still challenge stays, the rest are seats costing money to sit idle. A review is closed by `cut`, not `accept`.
