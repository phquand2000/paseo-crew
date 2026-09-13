# Workspace protocol template

A workspace protocol holds the standing decisions on how the Lead coordinates one repository: how
many Peers write at once, when a change gets independent review, when a council or an ultra-review
runs, when a Lead hands off, and what always goes to the Human. The Lead reads it at the start of
every session, and where it speaks it overrides `.seatworks/prompts/LEAD.md`.

`setup/add-project.fish` copies the block below to `.seatworks/guides/WORKSPACE_PROTOCOL.md`. Fill
in each placeholder, or delete its line to keep the Lead's default. After that the Supervisor keeps
it current on the Human's behalf, by replacing lines.

````md
# Workspace protocol

How the Lead coordinates this repository where it differs from `.seatworks/prompts/LEAD.md`. Each
line is a standing decision on the owner's side; a line naming a council or an ultra-review asks
for one in advance. Seat models live in the profiles, rules for code in `AGENTS.md`, rulings
in the Lead's ADRs, and what happened in the Supervisor's records. One line per decision, under 40
lines: a new decision replaces the line it changes.

## Routing

- Writers at once: MAX_PARALLEL_WRITERS. Full suite, ports, test database: TEST_LANE_RULE.
- Independent review: REVIEW_RULE.
- Design before code: ARCHITECT_TRIGGER.
- Council: COUNCIL_TRIGGER.
- Hand off to a fresh Lead: HANDOFF_TRIGGER.

## Gates

- Ultra-review: ULTRA_REVIEW_TRIGGER.
- Always the Human's: HUMAN_DECISIONS.
````

Replace the following, each with one line and no date:

- `MAX_PARALLEL_WRITERS`: how many Peers may write at once, for example `1`. Every Peer works in the
  Lead's checkout, so more than one needs a worktree the Human makes.
- `TEST_LANE_RULE`: who may run the full suite, hold a port or use the test database, and when.
- `REVIEW_RULE`: which changes get an independent Reviewer and how many, for example `two
  Reviewers, one axis each, for anything under billing/; otherwise the Lead reads the diff`.
- `ARCHITECT_TRIGGER`: the condition that puts an Architect before an Engineer.
- `COUNCIL_TRIGGER`: the kind of decision that gets a council without anyone asking each time, or
  delete the line.
- `HANDOFF_TRIGGER`: when a Lead hands off to a fresh one, for example `when an outcome closes, or
  when it can no longer name its own open decisions`.
- `ULTRA_REVIEW_TRIGGER`: the checkpoint that earns an ultra-review, for example `once, when the
  outcome's last slice is accepted`, or delete the line.
- `HUMAN_DECISIONS`: the changes to what this project does or how it behaves that only the Human
  decides; everything else is decided on the owner's side without asking.

## What does not go in the protocol

| What you have | Where it goes |
|---|---|
| A rule for anyone changing code: comments, commands, contracts | `AGENTS.md`, through an `OWNER DIRECTIVE:` to the Lead |
| A ruling on work in flight | a message to the Lead, and the Lead's ADR if it settles a boundary |
| The episode behind a decision: dates, quotes, SHAs | the attention log |
| The reason a line exists | the notebook row whose `Fix lives in` names that line |
| Which model, thinking level or mode a seat uses | the seat profile, or `.seatworks/project.json` to pin one per project |
| A repeat of `LEAD.md` | nowhere: delete the line |
