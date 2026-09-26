---
name: planning-lanes
description: "Decides how a high-risk lane is built before any task starts: whether it is high-risk at all, the final contract written first, where the work splits into tasks, which design choices to settle, and how to get back if it fails, kept as the lane's plan page. Use when a lane touches auth, money, data loss, migrations, concurrency or a shared contract, or needs more than one task. Not for a one-task lane that leaves nothing behind."
---

# Planning lanes

The rule that matters most: write the final contract first, split only where you can name the reason, and plan no lane you cannot get back out of.

## Is it high-risk?

A lane is high-risk when it materially changes:

- authentication, authorization, privacy, audit or secret handling;
- data: loss, an irreversible migration, deletion, retention, replay or recovery;
- money, credentials, user-visible delivery, or an external side effect that cannot safely run twice;
- a current contract replaced in coordination;
- runtime ownership, concurrency, lifecycle or ordering;
- a proof that protects a security, data, contract or external claim;
- compatibility: a fallback, shim, dual read or write, legacy parser or version branch.

A label alone does not make a lane high-risk; material impact does. A normal lane needs no plan page: its directive and acceptance are the plan.

## Split for agents

Split the way the work divides, not by a count: pieces that do not call each other run as parallel tasks, and the one that wires them waits for both.

- Split only for a reason you can name: write sets that do not meet and can run in parallel, a mechanical fan-out too big for one sitting, separately accepted deliverables, or shipped production state that needs a staged change.
- Never split by layer, to show progress, or into phases that keep a half-built state compiling: one writer changes a contract with all its callers and tests.
- Red inside the lane is fine when the gate runs on the lane, the default; the directive says when it runs per task instead.
- A compatibility layer is legitimate only for a named shipped consumer: a published API, persisted production data, an independently deployed service or client. Record the consumer and when the layer goes; everything else changes in place.

## Settle design first

Settle every choice that changes ownership, public behavior, safety, compatibility or data, or is expensive to reverse, before a task that depends on it starts: the options weighed and why, never files, symbols or control flow. A choice with several defensible answers goes to `council`; one only the Human can make goes up with `ask` kind question, your default with it.

## The plan page

Keep it with `note` in plans, as `$SEATWORKS_STATE/plans/<lane>.md`, from the template in [references/plan-page.md](references/plan-page.md): outcome, final contract, one row per task with why it is separate, intermediate states, decisions, the end check, and getting back. It holds the present only, under 80 lines, replacing lines rather than adding them, so a successor can resume the lane from it.

Getting back is not optional for a lane that migrates data, writes outside the repository, or makes a call nobody can take back: a plan that says how to reach the outcome but not how to get out of it is missing the half needed under pressure. A lane that leaves nothing behind says so in one line.

## Ends in

The plan page, then one `add_tasks` laying out every task it names, each with its owned paths, what it waits for, and `parallel` only where its write set meets no other.
