# Lane plans

A plan is the page a successor reads to resume a high-risk lane. It lives in the project's `plans/`
state directory, outside the repository, and holds the present only. Normal lanes need no plan.

Write it for agents, not a human team: the lane is usually one task done in one sitting, so the plan
names the final shape and the one check that proves it, not a schedule of phases. Keep it under 80
lines and replace lines instead of adding them.

## When the repository keeps its own workflow

If the repository has a `docs/WORKFLOW.md`, its rules for plans and decisions replace this guide,
and the rest of this page applies only where they are silent:

- **When:** a high-risk lane, or work that meets the repository's own reasons for a durable plan. A
  lane with several tasks is not one of them by itself: the desk already keeps who does what.
- **Where and what shape:** one file in `docs/plans/active/`, named after the lane, following the
  repository's plan template (`docs/templates/exec-plan.md` when it has one). Keep it current as the
  lane moves, and move it to `docs/plans/completed/` before you report the lane ready.
- **Decisions:** one that meets the bar at the end of this page also goes into `docs/decisions/`, in
  the repository's decision template, not only into the plan.
- **Checks:** the repository's gate, whatever the plan template calls it, is the end check.

Those directories are the Human's and may be kept out of git; write them where they are, and never
commit, stage or move them with git.

```md
# <lane id> <outcome>

## Outcome (up to 5 lines)

<what is observably true when done>
Not doing: <out of scope>

## Final contract (up to 15 lines)

<the shape of the types, schema, API or protocol after the change; this is written first and every
caller and test moves to it in the same change>

## Tasks (one row each)

| Task | Write set | Why it is separate |
|---|---|---|
| <L1-T1> | <paths> | only task, or the named reason: independent write set run in parallel, mechanical fan-out, separate deliverable |

## Intermediate states

Red inside the lane is fine. No compatibility, bridge or transition code, unless a shipped consumer
needs it: <none, or the consumer, why, and when the layer goes>.

## Decisions (one line each)

- <decision>: <what was chosen, the option set aside, and why>

## End check

<the command or scenario that proves the outcome on the whole lane>

## Getting back (only when this lane leaves state behind it)

<how the work is undone, and what has to be repaired by hand if it is: a migration that has run, a
record written outside this repository, an external call that cannot be taken back, a switch
somebody else is now reading. "Revert the branch" when that is genuinely the whole of it.>
```

A decision belongs here when it changes ownership, public behavior, safety or data, or is expensive
to reverse. Everything else lives in git history and the task hand-backs.

Getting back is not optional for a lane that migrates data, writes outside the repository, or makes
a call nobody can take back. A plan that says how to reach the outcome and not how to get out of it
is half a plan, and the half that is missing is the one that is needed under pressure. A lane that
leaves nothing behind says so in one line and moves on.
