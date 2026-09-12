# Workspace protocol template

A workspace protocol sets how the Lead coordinates work in one repository. Only the Lead reads
it; Peers read `AGENTS.md` and their brief.

The two files split the work like this:

| File | Holds | Read by |
|---|---|---|
| `AGENTS.md` | Technical constraints anyone changing code must know: contracts, test commands, authority | Every agent, automatically |
| `.seatworks/WORKSPACE_PROTOCOL.md` | Coordination strategy: strictness, topology, review lanes, spawn recipes | The Lead |

If an item belongs in both, put it in `AGENTS.md`.

Strictness varies by repository: a side project might need ten lines, and a repository with
many users a few hundred. Without this file, the Lead runs on the defaults in
`.seatworks/LEAD.md`, so delete any section that repeats them. Give each mandatory rule a
reproducible reason and a removal trigger, as in `AGENTS_MD_SNIPPET.md`.

`setup/add-project.fish` copies the block below to `.seatworks/WORKSPACE_PROTOCOL.md` in the
repository, adding the project's slug to `peer-SLUG`, `peer-ro-SLUG`, and `reviewer-SLUG`; `--model`,
or the Peer harness's `provider.defaultModel`, fills in `PEER_MODEL`. For the rest, ask the Supervisor to run its
`workspace-protocol` skill, which interviews you.

````md
# Workspace protocol

This file sets how the Lead coordinates work in this repository. Where it speaks, it overrides
the Lead's defaults.

## Strictness

Level: STRICTNESS_LEVEL

- `loose`: reading the diff yourself is enough; add a Reviewer only for data or migrations.
- `standard`: the Lead's defaults.
- `strict`: every change touching a seam listed in `AGENTS.md` gets an independent Reviewer.

## Topology

- Maximum parallel writing Peers: MAX_PARALLEL_WRITERS
- Worktree location and naming: WORKTREE_RULE
- Test lane: TEST_LANE_RULE

## Spawn recipes

Launch every agent from its profile in `list_profiles`, copying the profile's model, mode, and
thinking: Engineers from the Peer profile (`peer-SLUG/PEER_MODEL`), Architects and Scouts from the
read-only Peer profile, Reviewers from the Reviewer profile. The profile notes say when to raise
thinking.

## Review lanes

- A material review question gets REVIEW_LANE_COUNT Reviewers, briefed through
  `review-orchestration`: one axis each, never cloned prompts. One may run on a profile with a
  different model family; it adds blind spots, not a vote, and the Lead still issues one ruling.

## Escalation

- Add an Architect before an Engineer when: ARCHITECT_TRIGGER
- Always goes to the Human in this repository: HUMAN_DECISIONS

## Rules for this repository

RULES
````

Replace the following:

- `STRICTNESS_LEVEL`: `loose`, `standard`, or `strict`.
- `MAX_PARALLEL_WRITERS`: the most Peers that may write at once, for example `2`.
- `WORKTREE_RULE`: where worktrees go and how they are named, for example
  `../REPO-wt/TASK_ID`.
- `TEST_LANE_RULE`: who may run the full suite, hold a port, or use the test database, and
  when.
- `PEER_MODEL`: the model of the Peer profile, spelled exactly as `list_models` shows it for
  `peer-SLUG`; each harness spells a model its own way.
- `REVIEW_LANE_COUNT`: how many Reviewers a material question gets, for example `2`.
- `ARCHITECT_TRIGGER`: the condition that calls for design review before implementation.
- `HUMAN_DECISIONS`: decisions the Lead never makes in this repository, even small ones.
- `RULES`: repository-specific rules, each with a reason and a removal trigger.

A rule with both parts looks like this:

```md
- Every change touching `billing/` gets two sealed Reviewers.
  Reason: on 2026-08-12 a single Reviewer missed a rounding bug that reached staging.
  Remove when: `billing/` has a rounding property test running in CI.
```
