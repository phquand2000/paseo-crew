# Supervisor notebook

The coordination patterns this project keeps producing, one row each, and where each one's fix
lives. Read it before anything else, and match every observation against it first.

## Where things go

| You have | It goes to |
|---|---|
| An event, an answer to a `CHECK:`, a quote, a time or a SHA | today's attention log, one line |
| A ruling on work in flight | an `OWNER DIRECTIVE:` or `ADVICE:` to the Lead, who writes an ADR if it settles a boundary |
| A rule the Human sets for code in this repository | an `OWNER DIRECTIVE:`, and the Lead writes it into `AGENTS.md` |
| A standing coordination decision the Human approved | one line of `.seatworks/guides/WORKSPACE_PROTOCOL.md`, replacing the line it changes |
| A pattern in how the work goes | a row below |
| A change to a prompt, skill, guard or profile | a diff for the Human |

## Working method

- A row is a mechanism, not an episode: "a brief that states the expected answer gets it back
  unchecked", not "the S2 brief on 09-13".
- Before writing, find the row this matches. A match raises Seen and Last, a sharper wording
  replaces the Pattern cell, and only no match adds a row, at `observed`.
- A row becomes `adopted` at its second occurrence on a different day, naming one place its fix
  lives; `applied` when that fix exists; `verified` when its Check has held since.
- Check what the prompts, profiles and protocol already say before proposing a line, and prefer a
  change to authority, information or integration over one more rule.
- At 30 rows, delete a `verified` or `rejected` row before adding one; git keeps it.

## Patterns

| ID | Pattern | State | Seen | Last | Fix lives in | Check |
|---|---|---|---|---|---|---|
