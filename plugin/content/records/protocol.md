# Workspace protocol

How the Lead coordinates this repository where it differs from its role prompt. Each line is a
standing decision from the owner's side. Rules for code live in `AGENTS.md`, rulings in the Lead's
ADRs. One line per decision, under 40 lines: a new decision replaces the line it changes. Replace
each `<hint>` with one line and no date, or delete the line to keep the Lead's default.

## Routing

- Writers at once: <how many Peers may write at once; each writer works in its own worktree>.
- Full suite: <where and when the full test suite runs, e.g. one Peer runs it on the merged lane>.
- Independent review: <which changes get a Reviewer and how many, e.g. two for anything under billing/; otherwise the Lead reads the diff>.
- Design before code: <the condition that puts an Architect before an Engineer>.
- Council: <decisions that always get a council, or never do>.
- Council models: <the model of each council position, from those the reviewer profile offers>.
- Hand off to a fresh Lead: <when, e.g. when an outcome closes>.

## Gates

- Always the Human's: <the changes to what this project does or how it behaves for its users that only the Human decides; everything else is decided on the owner's side>.

## What does not go here

| What you have | Where it goes |
|---|---|
| A rule for anyone changing code | `AGENTS.md`, through an `OWNER DIRECTIVE:` to the Lead |
| A ruling on work in flight | a message to the Lead, and the Lead's ADR if it settles a boundary |
| The episode behind a decision | nowhere: the attention log beside this file already has it |
| Which model, thinking level or mode a role starts with | the role's profile |
| A repeat of the Lead's role prompt | nowhere: delete the line |
