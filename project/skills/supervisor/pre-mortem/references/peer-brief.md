# Pre-mortem brief

Every pre-mortem seat gets this same text as its `initialPrompt`. It uses the fields of
`.seatworks/skills/lead/decompose/references/brief-template.md`, so the Peer reads it like any
other assignment. Copy the block below:

```text
Task ID                       premortem-SLUG-SEAT_LETTER
Repository root + workspace   REPO_ROOT (read-only; no worktree needed)
Disposition                   Architect
Objective                     It is HORIZON_DATE. The plan below was carried out as written,
                              and it failed: OUTCOME didn't happen, or it happened and caused
                              damage. Explain why it failed.
Decided / ruled out           The failure is certain; your job is its causes. The plan is
                              fixed, so leave out a better plan.
Starting points               PLAN_LOCATION; STARTING_FILES
Owned scope                   none
Excluded scope                every file; change nothing and make no commits
Authority                     read only
Verification                  none to run; for each reason, cite the file and line, or the
                              command and its output, that supports it
Handoff                       Before the six fields, list every reason for the failure, most
                              likely first. For each reason give: the mechanism; the first
                              sign someone could have observed, and when it would appear;
                              whether the damage can be undone; and whether you saw the cause
                              in the code or inferred it.

Plan
PLAN_TEXT
```

Replace the following:

- `SLUG`: a short name for the plan, for example `sdk-release`.
- `SEAT_LETTER`: `A`, `B`, or `C`; the only field that differs between seats.
- `REPO_ROOT`: the absolute path of the repository the plan changes, or of this project when the
  plan has no repository yet. It must match the workspace passed to `create_agent`.
- `HORIZON_DATE`: the date by which failure would be visible.
- `OUTCOME`: the directive's outcome, word for word.
- `PLAN_LOCATION`: where the plan lives, for example an ExecPlan path and SHA, or `below`.
- `STARTING_FILES`: files worth reading first, or `none`.
- `PLAN_TEXT`: the frozen plan, or the directive draft without its Risks section.
