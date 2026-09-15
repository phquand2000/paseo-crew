# Lane plans

A plan is the page a successor reads to resume a high-risk lane. It lives in the project's `plans/`
state directory, outside the repository, and holds the present only. Normal lanes need no plan.

Write it for agents, not a human team: the lane is usually one task done in one sitting, so the plan
names the final shape and the one check that proves it, not a schedule of phases. Keep it under 80
lines and replace lines instead of adding them.

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
```

A decision belongs here when it changes ownership, public behavior, safety or data, or is expensive
to reverse. Everything else lives in git history and the task hand-backs.
