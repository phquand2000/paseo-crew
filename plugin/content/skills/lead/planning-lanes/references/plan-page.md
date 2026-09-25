# The plan page

The page a successor reads to resume a high-risk lane. Write it for agents, not a human team: it names
the final shape and the one check that proves it, not a schedule of phases.

```md
# <lane id> <outcome>

## Outcome (up to 5 lines)

<what is observably true when done>
Not doing: <out of scope>

## Final contract (up to 15 lines)

<the shape of the types, schema, API or protocol after the change; this is written first and every
caller and test moves to it in the same change>

## Tasks (one row each)

| Task | Holds (parallel only) | Why it is separate |
|---|---|---|
| <L1-T1> | <paths, or none in the lane's copy> | only task, or the named reason: independent paths held in parallel, mechanical fan-out, separate deliverable |

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
