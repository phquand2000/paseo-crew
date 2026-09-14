# Supervisor notebook

The coordination patterns this project keeps producing, one row each, and where each one's fix
lives. Read it at the start of a session and match an observation against it before acting.

## Where things go

| You have | It goes to |
|---|---|
| An event, a quote, a time or a SHA | nowhere: the plugin logs events in `attention.log` beside this file |
| A ruling on work in flight | an `OWNER DIRECTIVE:` or `ADVICE:` to the Lead, who writes an ADR if it settles a boundary |
| A rule for code in this repository | an `OWNER DIRECTIVE:`, and the Lead writes it into `AGENTS.md` |
| A standing coordination decision | one line of `protocol.md` beside this file, replacing the line it changes |
| A pattern that has happened twice | a row below |
| A change to a prompt, skill, role setting or profile | a diff for the Human |

## Working method

- A row is a mechanism, not an episode: "a brief that states the expected answer gets it back
  unchecked", not "the S2 brief on 09-13".
- A first occurrence adds nothing. The second, on a different day, adds a row at `adopted` that
  names one place its fix lives; `applied` when that fix exists; `verified` when its Check has held.
- Check what the prompts, profiles and protocol already say before proposing a line, and prefer a
  change to authority, information or integration over one more rule.
- At 20 rows, delete a `verified` or `rejected` row before adding one.

## Patterns

| ID | Pattern | State | Seen | Last | Fix lives in | Check |
|---|---|---|---|---|---|---|
