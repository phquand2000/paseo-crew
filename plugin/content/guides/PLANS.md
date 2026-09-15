# Lane plans

A plan is the page a successor reads to resume a high-risk lane: where it stands now. It lives
outside the repository, in the project's `plans/` state directory, so it never lands in a commit.
Normal lanes need no plan; the directive and the tasks are enough.

Keep it under 120 lines and replace lines instead of adding them:

```md
# <lane id> <outcome>

## Outcome and non-goals (up to 6 lines)

<the outcome and its success check>
Not doing: <non-goals>

## Decisions (one line each)

- <decision>: <what was chosen, the option set aside, and why>

## Contracts to settle first (one row each)

| Contract | State | Settled by |
|---|---|---|
| <API shape, data model, message format, migration> | open or settled | <task id or the decision line> |

## Tasks (one row each)

| Task | Outcome | Depends on | Status |
|---|---|---|---|
| <L1-T1> | <what a caller can observe> | none | started, merged or cut |

## Open questions (one line each, deleted once answered)

- <question> (blocks <task>; answered by <owner or Lead>)

## Acceptance and recovery (up to 10 lines)

- Claim: <claim>. Shown false by: <evidence>.
- Rollback: <how>.
```

A decision belongs here when it changes ownership, public behavior, safety, compatibility or data,
or is expensive to reverse. Everything else lives in git history and the task hand-backs.
