# Supervisor notebook

The coordination patterns this project keeps producing, one row each, and where each one's fix
lives. Read it at the start of a session and match what you see against it before acting.

## Where things go

| You have | It goes to |
|---|---|
| An event, a quote, a time or a SHA | nowhere: the desk logs events in `events.log` beside this file |
| A ruling on work in flight | a `message` to the Lead |
| A rule for code in this repository | a `message` asking the Lead to put it in `AGENTS.md` through a task |
| What the project does or how it behaves, as the Human settled it | `CONTEXT.md` beside this file |
| A pattern, new or seen again | a row below |
| A change to a prompt, skill, role setting or profile | a diff for the Human |

## Working method

- A row is a mechanism, not an episode: "a brief that states the expected answer gets it back
  unchecked", not "the L2 brief on 09-13".
- A first occurrence goes in at `seen` when it is genuinely new, or when it shows something you
  already have a row for more sharply than that row does; what does not go in is the same thing
  again in different words. The second sighting, on a different day, moves the row to `adopted`
  naming one place its fix lives; `applied` when that fix exists; `verified` when its Check has
  held.
- Prefer a change to authority, information or integration over one more rule.
- When it gets long, the answer is to fold rows into the pattern they are all instances of, not to
  drop the oldest to stay under a number. A `verified` row whose fix has held for weeks has done its
  work and can go.

## Patterns

| ID | Pattern | State | Seen | Last | Fix lives in | Check |
|---|---|---|---|---|---|---|
