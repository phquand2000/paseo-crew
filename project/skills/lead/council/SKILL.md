---
name: council
description: "Settles one non-trivial architecture, code, product, research, strategy, policy, or incident decision with sealed independent reports, bounded verification, and one binding verdict the Lead drafts alone. Use when a decision has several defensible answers and is expensive or hard to reverse, or when the Human or an owner directive asks for one; not for a choice a cheap slice settles."
---

# Council

You run the protocol and adjudicate; the reviewers do the analysis, so don't do a reviewer's analysis yourself. Each position is a fresh agent from the read-only `reviewer` profile, labeled with the case ID, its role and its round.

```text
tier    -> the smallest sufficient tier, in one sentence
brief   -> neutral brief + case output contract + framing lint
sealed  -> launch every Round 1 reviewer, then wait for all of them
model   -> reduce the reports to the case's natural decision units
verify  -> bounded Verifiers for material factual disputes only
cross   -> at most one challenge and response per disputed unit
draft   -> you draft the verdict alone
audit   -> a fresh Auditor, per tier
verdict -> binding verdict and handoff contract
```

Re-anchor on this list whenever you're unsure which step is active.

## Tier

- `lens`: one Independent.
- `debate` (default): Independent + Premise Challenger.
- `debate-with-proof`: `debate`, plus Verifiers as needed and a draft audit by default.
- `high-risk`: Independent + Premise Challenger at the strongest level the protocol allows, optionally one Specialist, Verifiers as needed, mandatory draft audit.

Create each position with the model and thinking level the `Council models` line of `.seatworks/guides/WORKSPACE_PROTOCOL.md` names for it; without that line, use the `reviewer` profile's defaults and say so in the verdict's limitations. Cheap agents add coverage, strong ones deliberate, and you adjudicate. Sealing removes contamination, not correlation: when the Independent and the Challenger run one model family, treat their agreement as weak evidence, look hardest where they agree without independent sources, and list "same-family Challenger" under the verdict's limitations.

## 1. Neutral brief

```text
Case ID: <stable URL-safe ID, reused on every label>
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
Snapshot: <commit or archive of mutable source, when state matters>
Requested output: <the work product the requester expects>
Case output contract: <the sections or fields each reviewer returns>
```

Build the output contract from the request's natural units, the same ones the decision model keeps, asking only for what comparing evidence needs: direct evidence, inference labels, material unknowns, falsifiers, and an actionable conclusion. Force no heading that doesn't fit the case; [references/report-format.md](references/report-format.md) holds adaptable patterns. When a dirty repository could change during review and exact state matters, snapshot to a commit or an archive outside the repository; a hash only detects drift.

**Framing lint.** Repair the brief until each answer is yes: it preserves the original request; no wording implies a preferred verdict; every fact has provenance and unverified premises are claims; constraints are apart from preferences; no option is excluded without authority; reviewers can investigate independently; the output contract keeps every unit the requester expects and creates no filler. Ask the requester only when missing authority or scope would change the decision. Then launch Round 1 at once, with no further analysis.

## 2. Sealed Round 1

Launch every reviewer in parallel with the same brief and output contract and exactly one role instruction. A Specialist may get extra domain fields that reveal no view and no preferred answer.

- **Independent:** reason from first principles, recommend the strongest answer, expose decision-critical assumptions.
- **Premise Challenger:** test the framing and shared premises and build at least one viable counterfactual, stating what it would make unnecessary. Don't manufacture disagreement; the incumbent framing may survive.
- **Specialist:** apply only the requested domain semantics; expertise doesn't outrank stronger evidence or product authority.

Every prompt opens with:

```text
Work as an autonomous reviewer with independent judgment inside the authorized scope. Challenge false premises, choose what evidence to inspect, and make ordinary analytical decisions without waiting. Do not look for or read other reviewers' work or council artifacts. Begin the work directly, without a preamble.
```

and closes with:

```text
This is analysis only. Do not optimize for agreement. Distinguish direct observations from inference, and state what evidence would prove your position wrong.
```

Reveal no opinion of yours, other report, agent ID or transcript, and read no report until every reviewer has finished. A reviewer that fails gets one retry with the same brief, or one fresh replacement for an infrastructure failure; a report missing decision content gets one request for that content, never for cosmetics. `lens` issues no verdict without its reviewer, `debate` tiers may continue with one core reviewer missing only as `DEGRADED`, and `high-risk` needs both core reviewers. If decision-relevant source changed and the snapshot can't be rebuilt, stop and report the mismatch.

## 3. Decision model

Reduce the reports to the smallest model that keeps every unit the verdict needs: three to five material propositions for a focused decision; one row per supplied finding for an audit; one row per gate or obligation for a plan review; a bounded timeline and causal model for an incident; alternatives with discriminating tests for research. Never merge, cap or drop requested findings to fit; decompose by sub-question instead.

Type a claim when its type changes the evidence bar: `FACT`, `INFERENCE`, `CAUSAL CLAIM`, `FORECAST`, `VALUE / PREFERENCE`, `AUTHORITATIVE CONSTRAINT`. Only facts get factual verification. Statuses: `verified`, `falsified`, `authoritative`, `supported inference`, `contested inference`, `unresolved`, `insufficient coverage`, `snapshot mismatch`. Insufficient coverage never shows a proposition false.

## 4. Verification and cross-examination

For a material factual dispute, launch one to three Verifiers, each with one proposition verbatim, the sources, the opening instruction, and a distinct mandate: find supporting evidence, find disconfirming evidence, or audit coverage. Never send identical prompts as a vote. Each returns the proposition, mandate, sources searched, direct observations with locations, a result (`verified`, `falsified`, `partial`, `insufficient coverage`, `snapshot mismatch`) and limitations.

When evidence leaves a material disagreement, send the original reviewer only the disputed unit and its evidence, and require the cross-examination response from the report patterns. Skip both steps when every report agrees and no factual or framing dispute remains.

## 5. Draft, audit, verdict

Draft alone, weighing: the authoritative outcome and hard constraints, options they exclude, verified and unresolved premises, fit under realistic failure, robustness if an assumption is wrong, reversibility, and whether serious dissent has stronger evidence. Don't vote or average: the number of reviewers never creates authority.

The draft audit is optional in `debate` (use it for material dissent, high-impact unresolved claims or a fragile chain), the default in `debate-with-proof`, and mandatory in `high-risk`. The Auditor gets the opening instruction without its ban on reading other work, the closing one, the brief, every valid report attributed by role, the decision model, verified evidence, the draft and material dissent, with no agent IDs or transcripts, and returns the audit response from the report patterns. It can't replace the verdict: resolve each material finding by revising, removing the claim, or returning it to its step.

The verdict, in the requester's vocabulary, conveys the decision and why, accepted versus rejected or unproven claims, required action and owner boundaries, do-not-touch constraints, validation, material dissent and your answer, limitations, and reopen conditions; a supplied finding set keeps a disposition per finding. Say whether the run was degraded, coverage incomplete, or an optional audit skipped. A verdict that settles a boundary becomes an ADR.

## Stopping rules

- One sealed Round 1; one retry or replacement per reviewer; one challenge and one response per disputed unit, with new factual claims sent to verification, not debate; one audit round.
- No voting, group chat or shared room: in a shared room the most assertive model wins, not the best evidence.
- The council ends at the verdict and its handoff contract. Reviewers don't implement; an Engineer brief carries the required action, boundaries and validation.
