---
name: council
description: "Lead-only: settles one non-trivial architecture, code, product, research, strategy, policy, or incident decision with fresh read-only seats, sealed independent reports, bounded verification, and one binding Lead verdict. Use only when the Human asked for a council or an owner directive names one, never on the Lead's own initiative, and never inside a council seat."
---

# Council — instructions for the Lead

You are the Lead and final arbiter. Execute this protocol with the orchestrator's control-plane
tools. Do not start another Lead. Do not perform a council seat's analysis yourself.

The request is the message that asked for the council; quote it verbatim into the brief's
`ORIGINAL REQUEST`.

## When a council is allowed

A council costs several read-only seats and two or three rounds of waiting, so the Human decides
to spend it, not you. Run this skill only when the Human asked for a council, or an
`OWNER DIRECTIVE:` names one. A decision that merely feels hard is not a request for one: settle
it from the code, from one read-only Peer, or by taking the options and your recommendation to
the Human. If you reach this skill without such a request, say what you would ask a council and
stop.

The Human controls your own model and reasoning effort. Do not inspect, enforce, or second-guess
that choice.

## Protocol at a glance

```text
tier    -> choose the smallest sufficient tier in one sentence
brief   -> neutral brief + case-fit output contract + framing lint
sealed  -> create_agent for every Round 1 seat, then wait on notifications
collect -> audit seats, handle failures, set council.phase=review
model   -> preserve the case's natural decision units in a typed decision model
verify  -> bounded Verifiers for material factual disputes only
cross   -> at most one challenge/response per disputed proposition
draft   -> Lead drafts the verdict alone
audit   -> fresh Auditor per tier policy
verdict -> binding verdict, set council.phase=verdict, handoff contract
```

When unsure mid-case which step is active, re-anchor on this list. Announce each phase
transition in one short Lead-timeline line as it happens.

## Use the control plane directly

The orchestrator's agent tools are the runtime.

Use these tools directly:

- `create_agent` to launch seats;
- `update_agent` to update council labels;
- `send_agent_prompt` for bounded retries and targeted follow-up;
- `get_agent_activity` to collect reports and audit seat activity;
- `list_agents` only when an ID must be recovered.

Do not inspect the orchestrator's installation or CLI when these tools are available, and do not
reach for a provider-native subagent tool: every council seat is a first-class agent of its own.

Every council seat runs on the read-only Reviewer profile, which is the only profile that blocks
writes; `references/routing.md` holds the model and thinking level per function, and the
Challenger's different model family, which is what makes `debate` stronger than `lens`. Read it
when a configured value is missing or rejected.

Create every seat with your own `create_agent` tool, so its result returns to you. Never
substitute a shell `paseo run` for seat creation: that call is not caller-scoped, establishes no
completion routing, and a hand-written parent label is metadata only. If `create_agent` is
unavailable or refuses the launch, stop before creating seats and report the blocker rather than
degrading into a fire-and-forget launch and status polling.

## Select a tier

`direct` is a bypass outside Council, not a Council tier.

- `lens`: one Independent reasoning seat.
- `debate` (default): Independent + Premise Challenger.
- `debate-with-proof`: Independent + Premise Challenger, bounded Verifiers as needed, and a
  default draft-verdict audit.
- `high-risk`: Independent + Premise Challenger using the configured high-risk reasoning
  profile; optionally one Specialist; bounded Verifiers as needed; mandatory draft-verdict
  audit.

Choose the smallest sufficient tier in one sentence. Do not perform task analysis merely to
justify it.

## Phase 1 — neutral brief

Create a compact, self-contained brief from the user's actual question:

```text
CASE_ID
ORIGINAL REQUEST
DECISION QUESTION
OBSERVABLE OUTCOME
AUTHORITATIVE FACTS
DIRECT OBSERVATIONS
UNVERIFIED CLAIMS
UNKNOWNS
HARD CONSTRAINTS
PREFERENCES / PRIORITY ORDER
AUTHORIZED SCOPE AND SOURCES
SNAPSHOT OR VERSION
REQUESTED OUTPUT
CASE OUTPUT CONTRACT
```

Preserve the decision request verbatim under `ORIGINAL REQUEST`; do not substitute the Lead's
summary. `DECISION QUESTION` may clarify the request but must not narrow or replace it.

Use `AUTHORITATIVE FACTS` only for user/system-authoritative decisions or already-verified facts,
and include provenance. Put source-backed observations with exact locations under
`DIRECT OBSERVATIONS`. Put every other premise under `UNVERIFIED CLAIMS`. Separate hard
constraints from preferences.

Design `CASE OUTPUT CONTRACT` for the actual work product before launching seats. It is a
case-specific content contract, not a universal report template. Choose the natural units of the
request and require only the sections or fields needed to compare evidence and reach the verdict.
Examples include:

- a finding ledger for an audit or supplied review, with one disposition per finding;
- option/constraint/trade-off analysis for an architecture or product decision;
- gate-by-gate acceptance analysis for a plan review;
- timeline, causal model, and recovery decisions for an incident;
- evidence synthesis with competing explanations for research.

Add role-specific fields only when the role genuinely needs them. Keep a shared comparable core
for core reasoning seats, but do not force `POSITION`, `BEST ALTERNATIVE`, a fixed claim count, or
any other heading when it does not fit the request. Require direct evidence, inference labels,
material unknowns, falsifiers or reopen conditions where relevant, and an actionable conclusion.
Read [references/report-format.md](references/report-format.md) for adaptable patterns, not a
schema to copy mechanically.

Inspect external artifacts only when the user's request requires them. For a mutable source,
record a task-appropriate snapshot before launching seats. A fingerprint detects drift but does
not preserve source bytes; never describe a commit-plus-hash as a recoverable lock. When a dirty
repository can change during review and exact state matters, use a stable checkpoint or capture a
read-only, reconstructable patch/archive of the authorized source outside the repository. Scope
identity checks to decision-relevant source and treat unrelated mutable metadata as non-blocking.
Do not require a previously dirty worktree to be clean and do not treat unrelated existing changes
as Council writes.

### Framing lint

Repair the brief internally until every answer is satisfactory:

- Does it preserve the user's original request?
- Does any wording imply a preferred verdict?
- Does every authoritative fact have authority or provenance?
- Are unverified premises represented as claims rather than facts?
- Are hard constraints separate from preferences?
- Has any option space been excluded without an authoritative reason?
- Can seats investigate independently within the authorized scope and sources?
- Is the snapshot current and unambiguous where source state matters?
- Does the output contract preserve every natural decision unit the user expects adjudicated?
- Does any requested heading create filler, hide evidence, cap coverage, or seed a preferred
  conclusion? If so, remove or replace it.

Ask the user only when missing authority or scope cannot be resolved without materially changing
the decision. Framing lint is not a mandatory confirmation ceremony.

After framing lint, the next orchestration action must be `create_agent` for every required
Round 1 seat. Do not continue task analysis, provider discovery, or broad context gathering
before creating them.

## Phase 2 — sealed Round 1

Create all required seats in parallel where the tool surface permits. Every call must use:

```text
create_agent
  title:    "<role>: <short case title>"
  provider: "reviewer/REVIEWER_MODEL"
  settings: { modeId: "REVIEWER_MODE_ID", thinkingOptionId: <per routing.md> }
  labels:
    council.case_id: <stable URL-safe case ID>
    council.title: <short human-readable title>
    council.tier: <tier>
    council.phase: sealed
    council.role: <independent|challenger|specialist>
    council.round: "1"
  initialPrompt: <the sealed seat prompt>
```

Leave `workspaceId` out, so the seat starts in your own workspace, and leave `notifyOnFinish` at
its default, so the seat's completion reaches you. Take `REVIEWER_MODEL` and `REVIEWER_MODE_ID`
from what `list_profiles` shows for the Reviewer profile, spelled exactly as it shows them: the
profile guard refuses a launch whose model or mode differs from its profile, and an omitted
`modeId` counts as differing. Use a fresh session for every seat. Preserve every returned agent ID. Do not end
the launch turn until all required seat IDs have been returned. Then report the launched
seat names/IDs concisely and wait for the completion notifications; do not poll.

Immediately reject any proposed launch route that uses a shell command or merely stamps
`paseo.parent-agent-id`. Parent ownership must come from the agent-scoped `create_agent` call
itself, and every required Round 1, Verifier, follow-up, and Auditor turn must retain
`notifyOnFinish: true`.

Give every core reasoning seat the exact same neutral brief and shared case output contract, plus
exactly one role instruction. A Specialist may receive additional domain-specific output fields
only when they do not reveal another seat's view or the Lead's preferred answer:

- **Independent:** reason from first principles, recommend the strongest answer, and expose
  decision-critical assumptions.
- **Premise Challenger / Falsification Seat:** test the problem framing and shared premises,
  construct at least one viable counterfactual, and state what it would make unnecessary. Do not
  manufacture disagreement. The incumbent framing may be the strongest result when no better
  alternative survives scrutiny.
- **Specialist:** apply only the requested domain semantics; expertise does not override stronger
  evidence or product authority.

Begin every seat prompt with:

```text
SEAT EXECUTION MODE
Work as a fully autonomous reviewer with independent judgment and initiative inside the authorized scope. Challenge false premises, choose what evidence to inspect, and make ordinary analytical decisions without waiting for the Lead. This assignment asks for your own analysis, not council orchestration: do NOT load or apply the council skill, use control-plane tools, discover or inspect other agents, create or contact agents, read other timelines or council artifacts, or coordinate with other reviewers. Begin the work directly without a meta preamble or skill announcement.
```

End every seat prompt with:

```text
This is analysis only. Do NOT edit, create, rename, or delete files. Do NOT write code. Do NOT spawn or contact agents. Do NOT use orchestration, agent-discovery, timeline, log, send, or chat operations. Do NOT optimize for agreement. Distinguish direct observations from inference and state what evidence would prove your position wrong.
```

Round 1 is sealed:

- do not create or expose a chat room;
- do not reveal the Lead's opinion, another report, desired conclusion, another agent ID, or
  another transcript;
- do not read and synthesize a report while any required seat remains unfinished.

Isolation here is real for writes and asked-for elsewhere: the Reviewer profile blocks edits and
repository-changing git through its own guard, so a seat cannot write whatever its prompt says.
Everything else in the seat rules — no orchestration, no reading another timeline — is asked for
and audited in Phase 3, not enforced. Say which of the two a claim rests on.

## Phase 3 — collect, audit, and handle failures

After every required Round 1 seat reaches a terminal state:

1. use `get_agent_activity` for each seat;
2. audit for control-plane and discovery calls, attempts to inspect another seat, and workspace
   writes;
3. compare the mutable-source snapshot where practical;
4. mark a violating seat `COMPROMISED` and do not silently use its report;
5. update valid case seats to `council.phase=review`;
6. collect complete valid reports only after all required seats have finished.

If unexpected workspace mutation changes decision-relevant source and the authorized snapshot
cannot be reconstructed, stop the affected review. Drift outside the authorized/material source
is not by itself a snapshot mismatch. Report the exact mismatch; do not perform destructive cleanup
or attribute a concurrent human change to a seat without evidence.

Failure policy:

- allow one execution attempt and at most one retry for infrastructure or output-contract failure;
- retry with the same brief and snapshot;
- for a format-only failure, ask the same seat once for only the missing decision-relevant
  content; do not demand cosmetic conformance;
- for infrastructure failure or a compromised seat, create one fresh replacement;
- `lens` cannot issue a Council verdict without its only seat;
- `debate` and `debate-with-proof` may continue with one missing core seat only as explicitly
  `DEGRADED`;
- `high-risk` must not issue a normal binding verdict without both core reasoning seats;
- never interpret `insufficient coverage` as evidence that a proposition is false.

## Phase 4 — adaptive decision model

Reduce valid reports into the smallest decision model that preserves every natural unit needed
for the verdict. Select the representation from the case rather than forcing every council into a
proposition matrix:

- focused decision: normally three to five material propositions;
- supplied finding set or audit: one ledger row per finding, plus only the cross-cutting causal or
  architectural claims needed to classify and route them;
- plan or contract review: one row per acceptance gate, requirement, or disputed obligation;
- incident: a bounded timeline and causal/recovery model;
- research or strategy: evidence-backed alternatives, assumptions, and discriminating tests.

Use [references/report-format.md](references/report-format.md) as patterns. Adapt column names and
shape to the case. Never merge, cap, or omit requested findings merely to satisfy a generic size
limit.

Classify each material claim when its epistemic type affects the evidence bar:

- `FACT`
- `INFERENCE`
- `CAUSAL CLAIM`
- `FORECAST`
- `VALUE / PREFERENCE`
- `AUTHORITATIVE CONSTRAINT`

Use only these statuses:

```text
verified
falsified
authoritative
supported inference
contested inference
unresolved
insufficient coverage
snapshot mismatch
```

Only factual propositions and direct observations are eligible for factual verification.
Inference, causality, forecasts, values, and authority require the matching evidence bar rather
than a fake fact check.

If the decision model becomes too large to reason about truthfully, decompose it by meaningful
sub-question or causal family while retaining a complete index back to the user's natural units.
Do not silently discard material content. Do not build a claim graph, database, or custom store.

## Phase 5 — verification

For a material factual dispute, create one to three Verifiers in your own workspace on the
Reviewer profile, at the verifier thinking level in routing.md. Label them with the same case ID, role
`verifier`, and round `verify`.

Give each Verifier only one precise proposition, the authorized sources, and one distinct mandate:

- search for direct supporting evidence;
- search for disconfirming evidence and counterexamples;
- audit coverage and identify likely missed sources.

Use only as many mandates as the proposition needs. Never send identical prompts as an ensemble
vote. Begin Verifier prompts with the same seat-execution instruction forbidding the Council
skill and Paseo control-plane tools.

Require:

```text
PROPOSITION CHECKED
MANDATE
SOURCES OR LOCATIONS SEARCHED
DIRECT OBSERVATIONS
RESULT: verified | falsified | partial | insufficient coverage | snapshot mismatch
LIMITATIONS
```

Use a reasoning verifier instead of a cheap verifier when source meaning requires semantic
judgment. A `snapshot mismatch` stops work on that proposition until the source is refreshed or
the case is restarted.

## Phase 6 — targeted cross-examination

If evidence leaves a material disagreement, call `send_agent_prompt` on the original seat. Send
only the disputed finding, gate, proposition, causal claim, or alternative and relevant evidence.
Require the cross-examination schema from
[references/report-format.md](references/report-format.md).

Allow at most one challenge and one response per disputed decision unit. Never reopen free-form debate.
A council never opens a shared room.

If every valid seat agrees, no material factual dispute exists, and no framing or audit issue
remains, skip verification and cross-examination.

## Phase 7 — Lead draft verdict

The Lead—not the seats—decides:

1. authoritative outcome and hard constraints;
2. options excluded by verified constraints;
3. verified, falsified, and unresolved premises;
4. fit under realistic failure modes;
5. robustness if an assumption is wrong;
6. reversibility;
7. whether serious dissent has stronger evidence or a decisive falsifier.

Do not vote or average confidence. Seat count never creates authority. Draft the binding output
before deciding whether an audit is required.

## Phase 8 — draft-verdict audit

- `debate`: optional when the draft contains material dissent, unresolved high-impact claims, or
  a fragile reasoning chain.
- `debate-with-proof`: default.
- `high-risk`: mandatory.

Create one fresh Auditor in your own workspace on the Reviewer profile, at the auditor thinking
level in routing.md; use the deep-auditor level for semantic or high-risk review.

Give the Auditor only:

- neutral brief;
- every valid Round 1 seat report, attributed by role only;
- adaptive decision model;
- verified evidence;
- draft verdict;
- material dissent.

Do not include seat identities, agent IDs, or raw transcripts; seat reports are the case-fit
outputs, not transcripts. The seat reports let the Auditor check that the decision model and
dissent summary omit nothing material; an omitted material claim is a material finding. Label it with the same case ID, role `auditor`,
round `audit`, and phase `audit`. Apply the same no-skill, no-orchestration, no-edits seat rules.
Use the audit schema from [references/report-format.md](references/report-format.md).

The Auditor cannot replace the verdict. Resolve every material finding by revising the draft,
removing an unsupported claim, or returning the affected proposition to the appropriate bounded
step. Run at most one verdict-audit round.

## Phase 9 — binding verdict

Structure the binding verdict for the user's case and vocabulary. It must communicate, without
requiring these as literal headings: the decision and why; accepted versus rejected or unproven
material claims; required action and owner boundaries; do-not-touch constraints; validation;
material dissent and Lead's response; limitations; and reopen conditions. For a supplied finding
set, preserve an explicit disposition for every finding.

State whether the run used soft isolation, became degraded, encountered incomplete coverage, or
skipped optional audit. After issuing the verdict, update every case seat to
`council.phase=verdict`. Keep the verdict body in the Lead timeline, not in labels.

Council ends at the decision and handoff contract. Council seats do not implement. A later
Implementer should receive the verdict, required action, do-not-touch boundaries, and validation
requirements. A fresh Validator may check implementation against that contract without reopening
the architecture unless a reopen condition is triggered.

## Stopping rules

- one sealed Round 1;
- a complete case-fit decision model; decompose only when it improves reasoning without losing
  traceability;
- at most one targeted rebuttal exchange per disputed decision unit;
- at most one verdict-audit round;
- no voting, unrestricted group chat, or shared room;
- no workspace edits by seats;
- no new workspace/worktree for an ordinary Council;
- no daemon, database, queue, event log, claim graph, or standing council.
