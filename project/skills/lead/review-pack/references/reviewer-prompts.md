# Reviewer prompts

Write the prompt for one review into a file outside the repository, then pass that path to
`--prompt-file` when the Human wants it inside the artifact. Leave the flag off otherwise, so a
snapshot stays neutral and reusable with another question. Review priorities come from
`review-kinds.md`, beside this file.

## Pack prompt

For a small Markdown pack, which the reviewer reads end to end:

```text
You are reviewing an attached source review pack.

Focus: FOCUS
Profiles: PROFILES
Review kinds: KINDS

Read in this order:
1. Review Pack Manifest / MANIFEST.md.
2. Reviewer Prompt / PROMPT.md.
3. Git Diff / DIFF.patch, if present.
4. Rust Impact Summary and Source Excerpts, if present.
5. Source Files.

Review priorities:
PRIORITIES

Response format:
- Start with findings, ordered by severity.
- For each finding include severity (P0, P1, P2, or P3), file:line, issue, why it matters, and a concrete fix or test.
- Ground every finding in paths and line references from the pack.
- Separate missing-context requests from findings, and ask for exact files or ranges.
- If there are no findings, say that clearly and list residual risks or test gaps.

Constraints:
- Do not suggest broad rewrites unless a concrete issue requires one.
- Do not assume repository context outside this pack.
- Treat omitted files as unavailable unless you request them explicitly.

Task:
TASK

Specific review questions:
QUESTIONS
```

Replace the following:

- `FOCUS`: the paths the pack centers on, or "the included source".
- `PROFILES`: the `--profile` values you passed, or "generic".
- `KINDS`, `PRIORITIES`: the headings you chose in `review-kinds.md` and their lists.
- `TASK`, `QUESTIONS`: the same brief and questions you pass as `--task` and `--question`; drop
  either block when the request carries neither.

This prompt rules out broad rewrites, so use it where a local fix is the answer.

## Adversarial source-truth prompt

For a source snapshot, an architecture review, or a large adversarial review:

```text
You are an independent adversarial reviewer for PROJECT_OR_TASK.
The attached ZIP holds source and docs only; treat repo/ as the current source truth.
GIT_STATUS.txt is orientation, not the boundary of the review.
Review GOVERNING_PLAN_OR_TASK as a whole, not only a local patch or a list of earlier findings.
Try to falsify both local correctness and fit with the long-lived architecture.
Read MANIFEST.md, AGENTS.md, the governing plan and ADRs, then the source.
Don't dump whole large files: map from MANIFEST.md, SOURCE_TREE.txt, and doc headings, search,
then read focused line ranges (narrower when output is cut off), and cite only lines you read.
If tests are excluded, name the missing test context rather than guess.
Cover these surfaces: SURFACES.
Flag issues that pass locally but weaken the architecture.
Report findings first, each with severity, file:line, failure path, the rule or boundary it
breaks, and a durable fix direction rather than the least painful patch.
```

Replace the following:

- `PROJECT_OR_TASK`, `GOVERNING_PLAN_OR_TASK`: the project and the plan or task under review.
- `SURFACES`: the owner, protocol, runtime, and proof surfaces in scope.

Keep earlier findings out of the mission, adding them afterwards as optional hints if they help,
because a list of known blockers tends to become the scope. Mention only operating limits that
matter for this reviewer.
