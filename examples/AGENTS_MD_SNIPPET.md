# AGENTS.md template for a target repository

Every agent working in a repository reads its instruction file automatically, so the
repository's technical constraints belong there. The seats read different files, though:

- Pi (the Peer and the Reviewer) reads `AGENTS.md`, and takes only one file per directory,
  preferring `AGENTS.md` over `CLAUDE.md`.
- Claude Code (the Supervisor, the Lead, and the watcher) reads `CLAUDE.md`.

So keep the constraints in `AGENTS.md`, and give the repository a one-line `CLAUDE.md` that
imports it:

```md
@AGENTS.md
```

Coordination strategy (strictness, review lanes, spawn recipes) belongs in
`.seatworks/WORKSPACE_PROTOCOL.md` instead (template next to this one): Peers don't need it,
and reading it every turn only distracts them.

When you fill in the template:

- Keep only the sections whose answer differs from the default. An empty section costs tokens
  and gives agents nothing.
- Stay well under 200 lines. Leave out what agents learn by reading the code, such as
  directory overviews.
- Make each rule checkable: a command, a path, or a threshold.
- Next to each mandatory rule, write two things: a reproducible problem that the existing
  layers don't prevent, and a removal trigger, meaning the evidence that would narrow or
  remove the rule. A rule missing either one is ceremony, and ceremony only ever tightens.
- Enforce anything that must always hold with permissions, hooks, or the Peer's guard
  extension. An instruction file is guidance, not enforcement.
- Put no maintainer notes in HTML comments: Claude Code strips them, but Pi shows them to the
  Peer.

Copy the block below into the repository's `AGENTS.md`:

````md
## Contract boundary

These are the constraints agents can't infer from the code.

- Settled seams (use them without asking): SETTLED_SEAMS
- Decide-first seams (if one is still undecided when a test would cross it, stop and report
  `BLOCKED`): DECIDE_FIRST_SEAMS
- Changing a contract: COMPAT_POLICY

## Authority

Pushing is the Human's. Deploys, CI changes, data deletion, external API calls, and major
dependency changes need explicit permission.

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
- `COMPAT_POLICY`: `hard cut` (replace the old form everywhere in one change, with no shim) or
  `keep the old form until DATE` for consumers this repository doesn't ship.
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
