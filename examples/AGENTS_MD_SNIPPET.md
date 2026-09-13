# AGENTS.md template for a target repository

Every agent working in a repository reads its instruction file automatically, so the
repository's technical constraints belong there. The seats don't all read the same file: each
harness names the one it reads in its manifest's `contextFile`, and a harness that reads
something other than `AGENTS.md` also says `contextFileNeedsPointer`.

So keep the constraints in `AGENTS.md`, and let `setup/add-project.fish` add a one-line pointer
for every other file a harness in use reads. A pointer is this one line:

```md
@AGENTS.md
```

Standing coordination decisions (writers at once, review, council, gates) belong in
`.seatworks/guides/WORKSPACE_PROTOCOL.md` instead (template next to this one): Peers don't need
them, and reading them every turn only distracts them.

When you fill in the template, replacing each `<hint>`:

- Keep only the sections whose answer differs from the default. An empty section costs tokens
  and gives agents nothing.
- Stay well under 200 lines. Leave out what agents learn by reading the code, such as
  directory overviews.
- Make each rule checkable: a command, a path, or a threshold, in code font.
- Next to each mandatory rule, write two things: a reproducible problem that the existing
  layers don't prevent, and a removal trigger, meaning the evidence that would narrow or
  remove the rule. A rule missing either one is ceremony, and ceremony only ever tightens.
- Enforce anything that must always hold with the coding agents' own settings, such as
  permission rules or a sandbox. An instruction file is guidance, not enforcement.
- Put no maintainer notes in HTML comments: some harnesses strip them, and the rest read them to the
  Peer.

Copy the block below into the repository's `AGENTS.md`:

````md
## Contract boundary

These are the constraints agents can't infer from the code.

- Settled seams (use them without asking): <interfaces that are final, e.g. the REST API under api/v1>
- Decide-first seams (if one is still undecided when a test would cross it, stop and report
  `BLOCKED`): <interfaces that must be decided before a test crosses them>
- Changing a contract: <hard cut, replacing the old form everywhere in one change with no shim; or keep the old form until a date, for consumers this repository doesn't ship>

## Authority

Pushing is the Human's. Deploys, CI changes, data deletion, external API calls, and major
dependency changes need explicit permission.

- Also allowed in this repository: <actions allowed beyond the default, e.g. updating lockfiles>
- Needs the owner's decision, even when it looks small: <actions that always need the owner>

## Verification

- For ordinary changes, run: <the command that verifies an ordinary change, e.g. npm test>
- Before acceptance, run: <the command that must pass before acceptance>
- For subjective qualities (UX, game feel, output quality), the evidence is a playtest, a
  screenshot, or a person looking at it, not a unit test.

## Repository risks

- Hard-to-reverse decisions: <decisions in this repository that are hard to undo>
- External side effects (deploys, migrations, external calls, email): <actions that reach outside this machine>

## Rules

<repository-specific rules, each with a reason and a removal trigger>
````

A rule with both parts looks like this:

```md
- Every change touching `store/migrations/` gets an independent review.
  Reason: migrations lost dev data on 2026-07-03 and 2026-07-21; the prompt didn't stop it.
  Remove when: a migration test runs against a copy of real data in CI.
```
