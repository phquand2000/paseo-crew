# CLAUDE.md template for a target repository

Every agent working in a repository reads its `CLAUDE.md` automatically, so the repository's
technical constraints belong there. That keeps one source of context, instead of a separate
file the Lead has to quote into every brief. Coordination strategy (strictness, review lanes,
spawn recipes) belongs in `WORKSPACE_PROTOCOL.md` instead; see the template next to this one.
Peers don't need it, and reading it every turn only distracts them.

When you fill in the template:

- Keep only the sections whose answer differs from the default. An empty section costs tokens
  and gives agents nothing.
- Stay well under 200 lines. Leave out what agents learn by reading the code, such as
  directory overviews.
- Make each rule checkable: a command, a path, or a threshold.
- Next to each mandatory rule, write two things: a reproducible problem that the existing
  layers don't prevent, and a removal trigger, meaning the evidence that would narrow or
  remove the rule. A rule missing either one is ceremony, and ceremony only ever tightens.
- Enforce anything that must always hold with permissions or hooks. `CLAUDE.md` is guidance,
  not enforcement.

Copy the block below into the repository's `CLAUDE.md`:

````md
## Contract boundary

These are the constraints agents can't infer from the code.

- Settled seams (use them without asking): SETTLED_SEAMS
- Decide-first seams (if one is still undecided when a test would cross it, stop and report
  `BLOCKED`): DECIDE_FIRST_SEAMS

## Authority

Push, deploy, CI changes, data deletion, external API calls, and major dependency changes need
explicit permission.

- Also allowed in this repository: EXTRA_ALLOWED
- Needs the owner's decision, even when it looks small: OWNER_DECISIONS

## Verification

- For ordinary changes, run: `CHECK_COMMAND`
- Before acceptance, run: `ACCEPT_COMMAND`
- For subjective qualities (UX, game feel, output quality), the evidence is a playtest, a
  screenshot, or a person looking at it, not a unit test.

## Repository risks

- Hard-to-reverse decisions: IRREVERSIBLE_DECISIONS
- External side effects (deploys, migrations, external calls, email): SIDE_EFFECTS

## Rules

RULES
````

Replace the following:

- `SETTLED_SEAMS`: interfaces that are final, for example `the REST API under api/v1`.
- `DECIDE_FIRST_SEAMS`: interfaces that must be decided before a test crosses them.
- `EXTRA_ALLOWED`: actions allowed here beyond the default, such as updating lockfiles.
- `OWNER_DECISIONS`: actions that always need the owner, however small.
- `CHECK_COMMAND`: the command that verifies an ordinary change, for example `npm test`.
- `ACCEPT_COMMAND`: the command that must pass before acceptance.
- `IRREVERSIBLE_DECISIONS`: decisions in this repository that are hard to undo.
- `SIDE_EFFECTS`: actions that reach outside this machine.
- `RULES`: repository-specific rules, each with a reason and a removal trigger.

A rule with both parts looks like this:

```md
- Every change touching `store/migrations/` gets an independent review.
  Reason: migrations lost dev data on 2026-07-03 and 2026-07-21; the prompt didn't stop it.
  Remove when: a migration test runs against a copy of real data in CI.
```
