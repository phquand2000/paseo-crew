# Workspace protocol template

A workspace protocol holds the standing decisions on how the Lead coordinates one repository. The
Lead reads it at the start of every session, and where it speaks it overrides
`.seatworks/prompts/LEAD.md`.

`setup/add-project.fish` copies the block below to `.seatworks/guides/WORKSPACE_PROTOCOL.md`.
Replace each `<hint>` with one line and no date, or delete its line to keep the Lead's default.
After that the Supervisor keeps it current on the Human's behalf, by replacing lines.

````md
# Workspace protocol

How the Lead coordinates this repository where it differs from `.seatworks/prompts/LEAD.md`. Each
line is a standing decision on the owner's side. Seat models live in the profiles, rules for code in `AGENTS.md`, rulings
in the Lead's ADRs, and what happened in the owner's records. One line per decision, under 40
lines: a new decision replaces the line it changes.

## Routing

- Writers at once: <how many Peers may write at once, e.g. 1; more than one needs a worktree the Human makes>. Full suite, ports, test database: <who may use them, and when>.
- Independent review: <which changes get an independent Reviewer and how many, e.g. two Reviewers, one axis each, for anything under billing/; otherwise the Lead reads the diff>.
- Design before code: <the condition that puts an Architect before an Engineer>.
- Council: <decisions that always get a council, or never do, where the Lead's own judgment isn't wanted>.
- Council models: <the model and thinking level of each council position, from those the reviewer profile offers, e.g. Independent and Challenger zai/glm-5.3 max, Verifiers zai/glm-5.3-flash low, Auditor zai/glm-5.3 high>.
- Ultra-review scouts: <the model and thinking level of the ten scouts, e.g. zai/glm-5.3-flash high>.
- Hand off to a fresh Lead: <when, e.g. when an outcome closes, or when it can no longer name its own open decisions>.

## Gates

- Ultra-review: <the checkpoint that earns one, e.g. once, when the outcome's last slice is accepted>.
- Always the Human's: <the changes to what this project does or how it behaves that only the Human decides; everything else is decided on the owner's side>.
````

## What does not go in the protocol

| What you have | Where it goes |
|---|---|
| A rule for anyone changing code: comments, commands, contracts | `AGENTS.md`, through an `OWNER DIRECTIVE:` to the Lead |
| A ruling on work in flight | a message to the Lead, and the Lead's ADR if it settles a boundary |
| The episode behind a decision: dates, quotes, SHAs | the attention log |
| The reason a line exists | the notebook row whose `Fix lives in` names that line |
| Which model, thinking level or mode a seat starts with | the seat profile, or `.seatworks/project.json` to pin one per project |
| Which of the profile's models a lane a skill opens runs (council positions, ultra-review scouts) | the Routing lines above; `seats.json` lists the models a profile may run |
| A repeat of `LEAD.md` | nowhere: delete the line |
