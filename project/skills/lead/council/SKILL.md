---
name: council
description: "Runs a Lead-only council on a contested, hard-to-reverse decision: sealed Peer judgments, verification, one binding verdict. Use when intake, a dispute, or a request needs independent judgment. Not for a question a few reads settle."
---

# Council

Get sealed, independent judgments on one decision from fresh Peers, and turn them into one
binding verdict you write and can defend. The verdict goes in your reply; the records go in
Phase 9.

A council member is a Peer created for this case alone. Keep that framing out of the prompts
seats read: a Peer knows only the Lead that briefs it.

`references/` and `scripts/` paths are relative to this skill's directory, shown below as
`SKILL_DIR`. Run `python3 SKILL_DIR/scripts/case.py --help` for its four subcommands.

## Guard

- Run this only as the Lead, holding the `create_agent` tool. Otherwise reply that the council
  runs in the Lead's session, and stop.
- A seat never starts another council.
- When the decision is reserved for the Human, the output is a recommendation, and the verdict
  says so.

## Choose a tier

Answering from a few reads is the default, not a tier. Name the tier in one sentence, with no
analysis to justify it, then announce each phase in one short line as you enter it.

| Tier | Seats |
|---|---|
| `lens` | one Independent: a second judgment on a bounded question |
| `debate` (default) | an Independent and a Premise Challenger |
| `debate-with-proof` | `debate`, plus Verifiers where facts are disputed, plus a draft-verdict audit by default |
| `high-risk` | an Independent on the high-risk routing and a Challenger, optionally one Specialist, Verifiers as needed, and a mandatory audit; for high-risk-lane decisions that can't be undone |

Read `references/routing.md` when you set up the first seat: it resolves each seat's profile and
thinking, and says when the verdict must list a same-family Challenger.

## Phase 1: neutral brief

Print the field skeleton, then fill it in as one compact, self-contained brief from the request
given with this skill:

```bash
python3 SKILL_DIR/scripts/case.py brief CASE_ID
```

| Field | Rule |
|---|---|
| ORIGINAL REQUEST | the request word for word |
| DECISION QUESTION | may clarify the request, never narrow or replace it |
| AUTHORITATIVE FACTS | Human decisions and verified facts only, each with its provenance |
| DIRECT OBSERVATIONS | what a source shows, with its exact location |
| UNVERIFIED CLAIMS | every other premise, yours included |
| HARD CONSTRAINTS | kept apart from PREFERENCES, so a seat can tell what it may trade away |
| CASE OUTPUT CONTRACT | the case's natural units (below) |

Fit the output contract to the case: a finding ledger for an audit, options and trade-offs for a
design choice, one row per gate for a plan review, a timeline and causal model for an incident
(patterns in `references/report-format.md`). Require direct evidence, labeled inference, material
unknowns, falsifiers where relevant, and an actionable conclusion. Leave out headings that would
only produce filler.

Record the SNAPSHOT when the source can change. This pins HEAD and preserves the bytes of any
uncommitted authorized path outside the repository, because a hash detects drift but does not
preserve what drifted:

```bash
python3 SKILL_DIR/scripts/case.py snapshot CASE_ID --root REPO_ROOT --path PATH
```

**Framing lint.** Revise the brief until each answer is yes:

- Is the original request preserved word for word?
- Is the wording free of any hint of a preferred verdict?
- Is the decision question open, not a choice among options you picked?
- Does every authoritative fact carry its authority or provenance?
- Are unverified premises written as claims rather than facts?
- Are hard constraints separate from preferences?
- Is every excluded option excluded for an authoritative reason?
- Can a seat investigate on its own within the authorized scope and sources?
- Is the snapshot current and unambiguous?
- Does the output contract keep every unit the request expects decided?
- Does every requested heading help comparison, rather than create filler, hide evidence, cap
  coverage, or seed a conclusion?

Ask the Human only when missing authority or scope would change the decision. After the lint,
your next action is `create_agent` for every Round 1 seat, not more analysis.

## Phase 2: sealed Round 1

Create every seat in the same turn, each as a fresh agent:

```text
create_agent         as in the decompose skill's step 9
  title:             "council CASE_ID independent"
  provider, settings RESOLVED_PROVIDER and RESOLVED_THINKING from references/routing.md
  initialPrompt:     the preamble, BRIEF, ROLE, and the epilogue, per references/seat-prompt.md
  labels:
    council.case_id: CASE_ID
    council.title:   SHORT_TITLE
    council.tier:    TIER
    council.phase:   "sealed"
    council.role:    "independent" | "challenger" | "specialist"
    council.round:   "1"
```

- Seats work read-only in your workspace: pass no `workspaceId`, and create no worktree.
- Leave `notifyOnFinish` at its default `true` for every seat, Verifier, and Auditor.
- Use `create_agent`, never a shell `paseo run`: a shell launch isn't your subagent, so no
  completion notification reaches you, and a label naming you as parent doesn't change that.
- If `create_agent` is unavailable or rejects the launch, stop before any seat exists and report
  the blocker.
- Keep every returned agent ID, report the seats in one line, then wait for the notifications
  instead of polling.

Give each core seat the same brief and output contract, the disposition Architect, and exactly
one role:

| Role | Mandate |
|---|---|
| Independent | Reason from first principles, recommend the strongest answer, expose the assumptions the decision rests on. |
| Premise Challenger | Test the framing and shared premises, build at least one viable alternative framing, say what it would make unnecessary. The current framing may win when nothing better survives scrutiny. |
| Specialist | Apply only the requested domain knowledge; expertise doesn't outrank stronger evidence or Human authority. It may get extra output fields that reveal no other seat's view and no preferred answer. |

Round 1 stays sealed: no seat sees your opinion, another seat's report, a desired conclusion,
another agent's ID, or a transcript, and you read no report until every required seat has
finished. The isolation is soft and audited: seats have no Paseo tools and `peer-ro` blocks their
writes, but nothing stops one from reading beyond its sources, so never describe a forbidden read
to them as impossible.

Before you read any report, record your current position on the decision question in two or three
sentences with its main reason, so you notice when a report merely matches your framing and when
it contradicts it. This writes it outside the repository, where no seat is pointed:

```bash
printf '%s\n' "YOUR POSITION" | python3 SKILL_DIR/scripts/case.py position CASE_ID
```

## Phases 3 to 6: evidence

When every Round 1 seat has finished, open `references/evidence.md` and work through it. It holds
the isolation audit and the failure policy (Phase 3), the claim types and statuses the decision
model needs (Phase 4), the Verifier mandates (Phase 5), and the one-challenge cross-examination
(Phase 6). Two rules decide how much of it you use:

- Audit every seat's activity before you read a single report; a compromised seat's report is
  left out, not discounted.
- Skip Phases 5 and 6 when every valid seat agrees and no factual or framing issue remains.

## Phase 7: draft verdict

You decide, not the seats. Work through:

- the authoritative outcome and hard constraints;
- the options verified constraints exclude;
- which premises are verified, falsified, or unresolved;
- each option under realistic failure modes, and its robustness if an assumption is wrong;
- its reversibility;
- whether serious dissent has stronger evidence or a decisive falsifier.

Draft the binding verdict before deciding on an audit. Start from the position you recorded in
Phase 2: for every point where a seat's evidence contradicts it, say in the verdict whether it
changed your view and why. A verdict that restates your first position without answering those
points is a framing failure, and an audit counts it as a material finding.

## Phase 8: draft-verdict audit

- `debate`: optional, for material dissent, an unresolved high-impact claim, or a fragile chain
  of reasoning.
- `debate-with-proof`: by default, on the auditor routing.
- `high-risk`: mandatory, on the deep-auditor routing.

The auditor's packet and what its findings oblige you to do are in `references/evidence.md`.

## Phase 9: binding verdict

Write the verdict in the case's vocabulary, covering every point under "Binding verdict" in
`references/report-format.md`, including limitations and reopen conditions. For a supplied set of
findings, give each one a disposition. Then:

1. Set `council.phase` to `verdict` on every seat of the case with `update_agent`; keep the
   verdict itself in your reply, not in labels.
2. Record it: a Decision log line in the ExecPlan when the case belongs to one, and an ADR with
   the decision-records skill when it is architecturally significant.
3. Carry the required action, the do-not-touch boundaries, and the validation into the
   "Decided / ruled out" field of the briefs that implement it. Seats don't implement.
4. Archive every seat of the case with `archive_agent`.

Done when the seats are archived and the verdict is recorded where it will be read.

## Stopping rules

- No new worktree for a council.
- No daemon, database, queue, or permanent council team.

The rule that matters most: cheap workers increase coverage, strong seats deliberate, and you
adjudicate; seat count never becomes authority.
