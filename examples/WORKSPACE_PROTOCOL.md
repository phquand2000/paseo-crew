# Workspace protocol template

A workspace protocol sets how the Lead coordinates work in one repository. Only the Lead reads
it; Peers read `CLAUDE.md` and their brief.

The two files split the work like this:

| File | Holds | Read by |
|---|---|---|
| `CLAUDE.md` | Technical constraints anyone changing code must know: contracts, test commands, authority | Every agent, automatically |
| `WORKSPACE_PROTOCOL.md` | Coordination strategy: strictness, topology, review lanes, spawn recipes | The Lead |

If an item belongs in both, put it in `CLAUDE.md`.

Strictness varies by repository: a side project might need ten lines, and a repository with
many users a few hundred. Without this file, the Lead runs on the defaults in `LEAD.md`, so
delete any section that repeats them. Give each mandatory rule a reproducible reason and a
removal trigger, as in `CLAUDE_MD_SNIPPET.md`.

To start quickly, ask the Supervisor to interview you and write the protocol for the
repository.

Copy the block below to `WORKSPACE_PROTOCOL.md` at the repository root:

````md
# Workspace protocol

This file sets how the Lead coordinates work in this repository. Where it speaks, it overrides
the Lead's defaults.

## Strictness

Level: STRICTNESS_LEVEL

- `loose`: reading the diff yourself is enough; add a Reviewer only for data or migrations.
- `standard`: the Lead's defaults.
- `strict`: every change touching a seam listed in `CLAUDE.md` gets an independent Reviewer,
  and nothing is accepted while any Verification command is missing.

## Topology

- Maximum parallel writing Peers: MAX_PARALLEL_WRITERS
- Worktree location and naming: WORKTREE_RULE
- Test lane: TEST_LANE_RULE

## Spawn recipes

| Disposition | Provider | `thinkingOptionId` | Notes |
|---|---|---|---|
| Engineer | `claude-peer` | `medium` | `high` when touching a new boundary |
| Architect | `claude-peer` | `high` | read-only |
| Reviewer | `claude-peer` | `high` | sealed |
| Scout | `claude-peer` | `low` | read-only |

Create every agent attached, with `settings.modeId: "bypassPermissions"`.

## Review lanes

- A material review question on a stable implementation gets REVIEW_LANE_COUNT sealed lanes in
  parallel, each with the same SHA and the same question.
- Optional: one lane on a different provider, if Paseo has one (for example, Codex). A
  different model has different blind spots. The lane doesn't vote; the Lead still issues one
  ruling.
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
- `REVIEW_LANE_COUNT`: how many sealed Reviewer lanes a material question gets, for example
  `2`.
- `ARCHITECT_TRIGGER`: the condition that calls for design review before implementation.
- `HUMAN_DECISIONS`: decisions the Lead never makes in this repository, even small ones.
- `RULES`: repository-specific rules, each with a reason and a removal trigger.

A rule with both parts looks like this:

```md
- Every change touching `billing/` gets two sealed Reviewers.
  Reason: on 2026-08-12 a single Reviewer missed a rounding bug that reached staging.
  Remove when: `billing/` has a rounding property test running in CI.
```
