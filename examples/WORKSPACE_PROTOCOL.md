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
repository. On the way it renames `pi-peer` and `pi-reviewer` to the project's providers, `pi-peer-SLUG` and `pi-reviewer-SLUG`, and with
`--model` it fills in `PEER_MODEL`. To fill in the rest, ask the Supervisor to run its
`workspace-protocol` skill, which interviews you.

````md
# Workspace protocol

This file sets how the Lead coordinates work in this repository. Where it speaks, it overrides
the Lead's defaults.

## Strictness

Level: STRICTNESS_LEVEL

- `loose`: reading the diff yourself is enough; add a Reviewer only for data or migrations.
- `standard`: the Lead's defaults.
- `strict`: every change touching a seam listed in `AGENTS.md` gets an independent Reviewer,
  and nothing is accepted while any Verification command is missing.

## Topology

- Maximum parallel writing Peers: MAX_PARALLEL_WRITERS
- Worktree location and naming: WORKTREE_RULE
- Test lane: TEST_LANE_RULE

## Spawn recipes

Peers run on `provider: "pi-peer/PEER_MODEL"` and Reviewers on
`provider: "pi-reviewer/PEER_MODEL"`. Pass `settings.thinkingOptionId` and no `settings.modeId`.

| Disposition | `thinkingOptionId` | Notes |
|---|---|---|
| Engineer | `medium` | `high` when touching a new boundary |
| Architect | `high` | read-only |
| Reviewer | `high` | the Reviewer profile: read-only, runs Open Code Review; sealed |
| Scout | `low` | read-only |

## Review lanes

- A material review question on a stable implementation gets REVIEW_LANE_COUNT sealed lanes in
  parallel, each with the same SHA and the same question.
- Optional: one lane on a different model, for example another model in Pi or a Claude-based
  reviewer. A different model has different blind spots. The lane doesn't vote; the Lead
  still issues one ruling.
- Give each lane only the SHA and the question, never another lane's findings.

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
- `PEER_MODEL`: the Pi model the Peers use, as `list_models` shows it for `pi-peer-SLUG`, for
  example `zai/glm-5.3`.
- `REVIEW_LANE_COUNT`: how many sealed Reviewer lanes a material question gets, for example
  `2`.
- `ARCHITECT_TRIGGER`: the condition that calls for design review before implementation.
- `HUMAN_DECISIONS`: decisions the Lead never makes in this repository, even small ones.
- `RULES`: repository-specific rules, each with a reason and a removal trigger.

Pi thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`; Paseo
offers them only for models that support reasoning.

A rule with both parts looks like this:

```md
- Every change touching `billing/` gets two sealed Reviewers.
  Reason: on 2026-08-12 a single Reviewer missed a rounding bug that reached staging.
  Remove when: `billing/` has a rounding property test running in CI.
```
