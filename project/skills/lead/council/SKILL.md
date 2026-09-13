---
name: council
description: "Lead-only: settles one non-trivial architecture, code, product, research, strategy, policy, or incident decision with fresh read-only seats, sealed independent reports, bounded verification, and one binding Lead verdict. Use when the Human or an owner directive asks for a council."
---

# Council

You are the Lead and final arbiter. You run the protocol and adjudicate; the seats do the
analysis, so do not perform a seat's analysis yourself.

## Protocol at a glance

```text
tier    -> choose the smallest sufficient tier in one sentence
brief   -> neutral brief + case-fit output contract + framing lint
sealed  -> launch every Round 1 seat, then wait for them all
collect -> audit seats, handle failures
model   -> preserve the case's natural decision units in a typed decision model
verify  -> bounded Verifiers for material factual disputes only
cross   -> at most one challenge/response per disputed decision unit
draft   -> Lead drafts the verdict alone
audit   -> fresh Auditor per tier policy
verdict -> binding verdict, handoff contract
```

When unsure mid-case which step is active, re-anchor on this list. Announce each phase transition
in one short Lead-timeline line.

Every seat is a fresh agent on the read-only Reviewer profile.
[references/routing.md](references/routing.md) gives the model and thinking level per function,
including the Challenger's different model family, which is what makes `debate` stronger than
`lens`. Label each seat `council.case_id`, `council.role`, and `council.round` so its report can be
traced back to the case.

## Select a tier

`direct` is a bypass outside Council, not a Council tier.

- `lens`: one Independent seat.
- `debate` (default): Independent + Premise Challenger.
- `debate-with-proof`: `debate`, plus bounded Verifiers as needed and a default draft-verdict
  audit.
- `high-risk`: Independent at the high-risk reasoning level + Premise Challenger; optionally one
  Specialist; bounded Verifiers as needed; mandatory draft-verdict audit.

Choose in one sentence; do not perform task analysis merely to justify the tier.

## Phase 1: neutral brief

Write a compact, self-contained brief:

```text
Case ID: <stable URL-safe ID, reused on every seat label>
Original request: <the message that asked for the council, verbatim; never your summary>
Decision question: <may clarify the request, never narrow or replace it>
Observable outcome: <what is true in the world once the decision is right>
Authoritative facts: <user/system decisions or already-verified facts, each with provenance>
Direct observations: <source-backed observations with exact locations>
Unverified claims: <every other premise>
Unknowns: <material gaps no one has resolved>
Hard constraints: <non-negotiable limits, kept apart from preferences>
Preferences: <priority order among soft goals>
Authorized scope and sources: <what seats may inspect>
Snapshot: <commit, checkpoint, or captured archive of mutable source, when state matters>
Requested output: <the work product the user expects>
Case output contract: <the case-fit sections or fields each seat returns>
```

Design the case output contract for the actual work product before launching seats: choose the
request's natural units (the same units Phase 4 preserves) and require only what is needed to
compare evidence and reach the verdict. Keep a shared comparable core for the core reasoning seats,
adding role-specific fields only when a role genuinely needs them. Do not force `Position`, `Best alternative`, a fixed claim count, or any
heading that does not fit. Require direct evidence, inference labels, material unknowns,
falsifiers or reopen conditions where relevant, and an actionable conclusion.
[references/report-format.md](references/report-format.md) holds adaptable patterns, not a schema
to copy.

Inspect external artifacts only when the request requires them. A fingerprint detects drift but does
not preserve bytes, so never call a commit-plus-hash a recoverable lock: when a dirty repository can
change during review and exact state matters, use a stable checkpoint or a reconstructable
read-only patch or archive outside the repository. Scope identity checks to decision-relevant
source; unrelated mutable metadata and pre-existing uncommitted changes are not blockers.

### Framing lint

Repair the brief until every answer is satisfactory:

- Does it preserve the original request?
- Does any wording imply a preferred verdict?
- Does every authoritative fact have authority or provenance?
- Are unverified premises claims rather than facts?
- Are hard constraints separate from preferences?
- Has any option been excluded without an authoritative reason?
- Can seats investigate independently within the authorized scope?
- Is the snapshot current and unambiguous where source state matters?
- Does the output contract keep every natural decision unit the user expects adjudicated?
- Does any requested heading create filler, hide evidence, cap coverage, or seed a conclusion?

Ask the user only when missing authority or scope cannot be resolved without materially changing
the decision. Once the lint passes, launch the Round 1 seats next; no further task analysis or
context gathering first.

## Phase 2: sealed Round 1

Launch every required seat in parallel, and keep each returned agent ID. Every core reasoning seat
gets the same neutral brief and case output contract plus exactly one role instruction. A
Specialist may get extra domain fields that reveal no other seat's view and no preferred answer.

- **Independent:** reason from first principles, recommend the strongest answer, and expose
  decision-critical assumptions.
- **Premise Challenger:** test the framing and shared premises, construct at least one viable
  counterfactual, and state what it would make unnecessary. Do not manufacture disagreement; the
  incumbent framing may survive as strongest.
- **Specialist:** apply only the requested domain semantics; expertise does not override stronger
  evidence or product authority.

Begin every seat prompt with:

```text
Work as an autonomous reviewer with independent judgment inside the authorized scope. Challenge false premises, choose what evidence to inspect, and make ordinary analytical decisions without waiting for the Lead. Do not look for or read other reviewers' work or council artifacts. Begin the work directly, without a preamble.
```

End every seat prompt with:

```text
This is analysis only. Do not optimize for agreement. Distinguish direct observations from inference, and state what evidence would prove your position wrong.
```

Round 1 is sealed: reveal no Lead opinion, desired conclusion, other report, agent ID, or
transcript, and do not read or synthesize any report while a required seat is unfinished.

## Phase 3: collect, audit, handle failures

Once every required seat is terminal:

1. read each seat's activity;
2. audit it for attempts to read another seat's work, and mark a violating seat `COMPROMISED`;
3. compare the snapshot where practical;
4. collect the complete valid reports; never silently use a compromised one.

If decision-relevant source changed and the snapshot cannot be reconstructed, stop the affected
review and report the exact mismatch. Drift outside the authorized source is not a mismatch. Do
not clean up destructively or blame a seat for a concurrent human change without evidence.

Failure policy:

- one attempt and at most one retry per seat, with the same brief and snapshot;
- a format-only failure gets one request to the same seat for the missing decision-relevant
  content, never cosmetic conformance;
- an infrastructure failure or a compromised seat gets one fresh replacement;
- `lens` cannot issue a verdict without its only seat;
- `debate` and `debate-with-proof` may continue with one core seat missing only as `DEGRADED`;
- `high-risk` issues no normal binding verdict without both core seats;
- `insufficient coverage` is never evidence that a proposition is false.

## Phase 4: adaptive decision model

Reduce the valid reports to the smallest model that keeps every natural unit the verdict needs:

- focused decision: normally three to five material propositions;
- supplied finding set or audit: one ledger row per finding, plus only the cross-cutting claims
  needed to classify and route them;
- plan or contract review: one row per gate, requirement, or disputed obligation;
- incident: a bounded timeline and causal/recovery model;
- research or strategy: evidence-backed alternatives, assumptions, and discriminating tests.

Adapt the patterns in [references/report-format.md](references/report-format.md) to the case.
Never merge, cap, or omit requested findings to fit a size limit. If the model grows too large to
reason about truthfully, decompose it by sub-question or causal family with a complete index back
to the user's units. Build no claim graph, database, or custom store.

Classify a material claim when its type changes the evidence bar: `FACT`, `INFERENCE`,
`CAUSAL CLAIM`, `FORECAST`, `VALUE / PREFERENCE`, `AUTHORITATIVE CONSTRAINT`. Only facts and direct
observations get factual verification; the others need their own evidence bar, not a fake fact
check.

Statuses, and no others:

```text
verified | falsified | authoritative | supported inference | contested inference | unresolved | insufficient coverage | snapshot mismatch
```

## Phase 5: verification

For a material factual dispute, launch one to three Verifiers (role `verifier`, round `verify`).
Each gets one precise proposition, the authorized sources, the same opening instruction as the
seats, and one distinct mandate:

- search for direct supporting evidence;
- search for disconfirming evidence and counterexamples;
- audit coverage and find likely missed sources.

Use only the mandates the proposition needs; never send identical prompts as a vote. Use the deep
verifier level when source meaning takes semantic judgment. Require:

```text
Proposition checked: <the one proposition, verbatim>
Mandate: <support | disconfirm | coverage>
Sources searched: <files, locations, or sources inspected>
Direct observations: <what the sources show, with exact locations>
Result: <verified | falsified | partial | insufficient coverage | snapshot mismatch>
Limitations: <what was not or could not be checked>
```

A `snapshot mismatch` halts that proposition until the source is refreshed or the case restarts.

## Phase 6: targeted cross-examination

When evidence leaves a material disagreement, send the original seat only the disputed unit and
the relevant evidence, and require the cross-examination response from
[references/report-format.md](references/report-format.md). Skip verification and
cross-examination when every valid seat agrees and no factual dispute, framing issue, or audit issue
remains.

## Phase 7: Lead draft verdict

The Lead, not the seats, decides:

1. authoritative outcome and hard constraints;
2. options excluded by verified constraints;
3. verified, falsified, and unresolved premises;
4. fit under realistic failure modes;
5. robustness if an assumption is wrong;
6. reversibility;
7. whether serious dissent has stronger evidence or a decisive falsifier.

Do not vote or average confidence; seat count never creates authority. Draft the binding output
before deciding whether to audit it.

## Phase 8: draft-verdict audit

- `debate`: optional, when the draft carries material dissent, unresolved high-impact claims, or a
  fragile reasoning chain.
- `debate-with-proof`: default.
- `high-risk`: mandatory.

Launch one fresh Auditor (role `auditor`, round `audit`) at the auditor level, or the deep-auditor
level for semantic or high-risk review, with the seat closing instruction and the opening one minus
its ban on reading other reviewers' work, since the reports are its input. Give it
only the neutral brief, every valid Round 1 report attributed by role, the decision model, verified
evidence, the draft verdict, and material dissent; no seat identities, agent IDs, or transcripts.
The reports let it check that the model and dissent summary omit nothing material. Require the
audit response from [references/report-format.md](references/report-format.md).

The Auditor cannot replace the verdict. Resolve every material finding by revising the draft,
removing the unsupported claim, or returning the proposition to its bounded step.

## Phase 9: binding verdict

Shape the verdict to the user's case and vocabulary. Without requiring literal headings, it
conveys: the decision and why; accepted versus rejected or unproven material claims; required
action and owner boundaries; do-not-touch constraints; validation; material dissent and the
Lead's response; limitations; reopen conditions. A supplied finding set keeps an explicit
disposition per finding. State whether a seat was marked `COMPROMISED`, the run became degraded,
coverage was incomplete, or an optional audit was skipped.

Council ends at the decision and handoff contract; seats do not implement. A later Implementer
receives the verdict, required action, do-not-touch boundaries, and validation requirements, and a
fresh Validator may check against that contract without reopening the architecture unless a reopen
condition fires.

## Stopping rules

- one sealed Round 1;
- at most one retry or replacement per seat;
- at most one challenge and one response per disputed decision unit; new material factual claims
  go to verification, never to free-form debate;
- at most one verdict-audit round;
- no voting, group chat, or shared room;
- no daemon, database, queue, event log, claim graph, or standing council.
