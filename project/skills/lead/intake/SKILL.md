---
name: intake
description: "Classifies each request as tiny, normal, or high-risk via hard gates and a risk rubric that set review, council, and rollout rigor, and opens an ExecPlan when needed. Use when a request or owner directive arrives, or new evidence may raise a lane."
---

# Intake

Use this skill to put each request into one lane, tiny, normal, or high-risk, before you act on
it, so planning, review, and rollout effort match what a mistake would cost. It produces an
intake result block in your reply and, for high-risk or long-running work, an ExecPlan at
`docs/exec-plans/active/SLUG.md` in the target repository.

Keep intake to a few lines of reasoning per request; analyzing the work itself belongs to the
decompose skill.

## Procedure

1. **State the outcome.** Write one sentence saying what is observably different when the work
   is done, and one line saying what is excluded, from the request given with this skill, in
   the Human's wording when an owner directive carries it. Done when the sentence names no file
   or function: the lane follows the outcome, and files come later.

2. **Check the hard gates.** The work is high-risk when it materially includes any of these:

   - authentication, authorization, privacy, audit, or secret handling;
   - data loss, deletion, retention, an irreversible migration, replay, or recovery behavior;
   - money, credentials, user-visible delivery, or an external side effect that isn't
     idempotent;
   - replacing a contract that several owners consume, or resetting or rebuilding shared state;
   - a change to a runtime ownership boundary, concurrency, lifecycle, or ordering;
   - weakening a proof that protects a real security, data, contract, or external-system claim.

   Judge by material impact, not labels: a typo fix in `auth.ts` isn't high-risk, and a "small"
   retry change on a payment call is. Done when each gate has a yes or a no.

3. **Answer the risk rubric**, putting each answer in the column that fits:

   | Question | Low | Medium | High |
   |---|---|---|---|
   | Can it be undone? | `git revert` restores everything | revert plus a local step: regenerate, rebuild, reset dev data | needs a data repair or a reverse migration, or can't be undone |
   | Does it touch a leverage point? | private code inside one owned scope | an internal interface that two or more scopes use | a public API, schema, data model, stateful system (database, queue, cache, on-disk format), or a decide-first seam in `AGENTS.md` |
   | How large is the blast radius? | one module, caught by its own tests | several modules, or every developer's workflow | users, external parties, money, security, or data |
   | Is there a runnable check? | an existing command fails if the behavior disappears | a check can be written as part of the task | no: the proof needs a person, production traffic, or time |

   Done when all four answers have a column.

4. **Choose the lane**, the smallest that honestly covers the answers:

   - **tiny**: no gate applies and every rubric answer is Low.
   - **normal**: no gate applies and the highest answer is Medium.
   - **high-risk**: a gate applies, an answer is High, or broad uncertainty or weak proof
     remains after a few reads.

   Done when you can name the gate or rubric answer that set the lane.

5. **Check the compatibility policy.** If the repository's `AGENTS.md` sets a hard-cut policy
   (one live contract, no backward compatibility before the first release), a request for
   backward compatibility, a fallback, dual reads or writes, a shim, a legacy parser, or a
   version branch conflicts with it: stop and ask the Human, because the policy is theirs, not
   an implementation choice. Without such a policy, compatibility work is an ordinary design
   choice, usually High on the undo question, and the change-rollout skill plans it. Done when
   you know which policy applies.

6. **Apply the design gate** for normal and high-risk work. Before any Engineer starts, resolve
   each choice that would materially change ownership, public behavior, safety, compatibility,
   data consequences, or another direction that is expensive to reverse. Record the
   constraints, the alternatives worth weighing, the decision, and its likely failure modes in
   the ExecPlan's Direction section or as an ADR with the decision-records skill. Leave files,
   symbols, pseudocode, and private control flow to the Peer; a design that pre-solves them
   throws away the Peer's judgment. Route each open choice:

   - product direction, priority, or an irreversible trade-off: ask the Human;
   - a technical choice a few reads can settle: decide it and record it;
   - a technical choice that stays contested: run the council skill at the tier in step 7.

   Also ask the Human when the requested behavior, a destructive scope, or a weakened proof
   stays materially ambiguous. Done when no open choice is left for an Engineer to make by
   accident.

7. **Set the rigor** from the lane's column. Where `.seatworks/WORKSPACE_PROTOCOL.md` sets
   strictness or a review lane count, its numbers win.

   | | tiny | normal | high-risk |
   |---|---|---|---|
   | Plan | none; the request is the acceptance | the brief carries acceptance | ExecPlan before implementation |
   | Who writes | one Engineer Peer; never you | Engineer Peers, one per owned scope | Engineer Peers, with an Architect first where a decide-first seam is open |
   | Review | you read the diff | you read the diff, and add sealed Reviewers when a condition under "Independent review" in your seat prompt applies | at least two sealed Reviewers on separate axes, and a high-recall sweep when the proof is weak (review-orchestration) |
   | Council | none | lens or debate, for a contested choice only | debate-with-proof for a contested choice; the high-risk tier when it can't be undone |
   | Rollout | none | local revert | a change-rollout plan with the rollback proven before rollout |

   Done when the intake result's Rigor line names a number of Reviewers, a council tier or
   `none`, and a rollout route.

8. **Open an ExecPlan** when the lane is high-risk, or when normal work will span sessions,
   several Peers, or a handoff. Copy the template in `references/execplan.md` (relative to this
   skill's directory) to `docs/exec-plans/active/SLUG.md` in the target repository, fill it in,
   and commit it on its own:

   ```bash
   git add docs/exec-plans/active/SLUG.md && git commit -m "plan: SLUG"
   ```

   Done when a reader with only the plan and the working tree could name the next step.

9. **Record the intake result** in your reply, and at the top of the ExecPlan's "Outcome and
   constraints" section when there is one:

   ```text
   Lane        tiny | normal | high-risk
   Reason      the gate or rubric answer that set the lane
   Rubric      undo L|M|H, leverage L|M|H, blast radius L|M|H, check L|M|H
   Owners      canonical docs, contracts, and ADRs the work touches
   Plan        docs/exec-plans/active/SLUG.md | none
   Rigor       Reviewers N (axes), council TIER | none, rollout ROUTE
   Validation  the command or observation that would fail if the outcome were not reached
   Human       decisions reserved for the Human, or none
   ```

   Done when every line has a value; "unknown" is valid when you say where you looked.

## Reclassify only upward

When new evidence trips a gate or moves a rubric answer mid-task, raise the lane at once: update
the result block and the ExecPlan, apply the new rigor to the work still ahead, and extend it to
accepted slices the new risk reaches. When the work turns out easier, keep the lane and say so
in the acceptance summary's `LESSON:` line; the pull to lower a lane comes under mid-task
schedule pressure, when a dropped check is hardest to put back; the lesson calibrates the next
intake instead.

## Examples

- "Fix the typo in the settings page heading": tiny. Every answer is Low.
- "Add a CSV export to the invoice list": normal. It adds a new internal interface between the
  query layer and the view (leverage Medium), and a test can be written for it.
- "Rename the `amount` column to `amount_cents`": high-risk. The schema is a leverage point,
  and a rename with data in place can't be undone by `git revert`.

The rule that matters most: choose the lane from what a mistake would cost, and move it only
upward.
