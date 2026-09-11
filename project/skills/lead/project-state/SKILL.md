---
name: project-state
description: "Reconstructs a project's true state on a cold start: confirms the root, reads plans, ADRs, and git history, runs the acceptance check before new work, compares claimed with verified status, finds hotspots, open decisions, and live agents, and picks one next slice; also writes a HANDOFF block of pointers. Use when starting as a new or successor Lead, returning to a stale project, or handing off."
---

# Project state

Use this skill to find out what is actually true in a project before you add to it, because a
handoff, a plan, and a status line are claims until a command confirms them.

It produces a state summary in your reply, Progress lines in the ExecPlan corrected to the
verified state, and one chosen next slice. The last section covers writing a HANDOFF block when
you are the one leaving.

Before you start, finish the start-of-session steps in your seat prompt: the repository root,
`AGENTS.md`, and `.seatworks/WORKSPACE_PROTOCOL.md`.

## Procedure

1. **Confirm where you are.** Run:

   ```bash
   git rev-parse --show-toplevel && git branch --show-current
   git status --short
   git worktree list
   ```

   Done when the root matches the one in your first prompt or the HANDOFF block, and you know
   whose uncommitted changes, if any, are in the checkout. Leave changes you didn't make alone.

2. **Read the durable record**, in this order: the HANDOFF block if you are a successor;
   `docs/exec-plans/active/*.md`, especially Progress and the Decision log; the titles and
   statuses in `docs/adr/`; `CONTEXT.md`; and the recent history:

   ```bash
   git log --oneline -30
   git log --since="2 weeks ago" --stat --format='%h %ad %s' --date=short
   ```

   Treat everything you read here as claims to check in step 4, not as facts. Done when you
   have a list of claims: slices accepted, SHAs, checks said to pass, and decisions said to be
   settled.

3. **Run the acceptance check before any new work**: the check and acceptance commands in
   `AGENTS.md`, or the smoke test the project uses. Record the output. A failure left by the
   previous session is cheaper to find now than after you have built on it, and it tells you
   what comes first. Done when you have the output, pass or fail, with the first failure named.

4. **Compare claimed with verified status.** Check each claim from step 2:

   ```bash
   git cat-file -e "$sha^{commit}" && echo exists
   git merge-base --is-ancestor "$sha" HEAD && echo reachable
   ```

   Rerun the verification command of any claim that the step 3 run doesn't already cover. Mark
   each claim `verified`, `contradicted` (with the evidence), or `unverifiable` (with where you
   looked). Correct the ExecPlan's Progress lines to match. Done when every claim has a mark.

5. **Find the hotspots**, the files that change often and are large or complex, since that is
   where defects and merge conflicts collect:

   ```bash
   git log --since="6 months ago" --format= --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20
   ```

   For the top entries, add the line count (`wc -l`) as a rough measure of complexity. Done when
   you have the top five files by churn and size together. A slice that touches one of them
   rates at least Medium on leverage at intake.

6. **List the open decisions and who holds each**: ADRs with status `proposed`, open entries in
   the ExecPlan's Decision log, the HANDOFF block's open decisions, and `BLOCKED` or
   `REOPEN_REQUEST` items without a ruling. The holder is the Human, you, or a named Peer. Done
   when every open decision has a holder.

7. **List the live agents.** Call `list_agents`, raising `sinceHours` (up to 720) for a project
   that has been quiet, and read each agent's `status` and labels (`plan`, `task`, `council.*`,
   `review.*`) to see what it holds. Check `list_schedules` for heartbeats left behind. Agents
   created by a predecessor send their notifications to it, not to you: read their state with
   `get_agent_activity`, take any committed SHA as a fact to review, and ask the Human to detach
   or archive an agent you need to take over. Done when every live agent is matched to a slice
   or marked as unowned.

8. **Choose one next slice.** Take the first of these that applies: a failing check from step 3;
   a contradicted claim that other work depends on; an open decision that blocks the frontier;
   then the next slice on the ExecPlan's frontier, preferring the riskiest. Run intake for it if
   it is new work. Done when the state summary names exactly one next slice and the reason.

Write the state summary in this form:

```text
Root          PATH on BRANCH, clean | N uncommitted files (whose)
Check         CHECK_COMMAND: pass | fail, first failure: FAILURE
Plans         active ExecPlans and the next slice in each
Verified      claims that held
Contradicted  claims that failed, with evidence
Hotspots      top files by churn and size
Decisions     each open decision and its holder
Agents        live agents, what each holds, and unowned ones
Next slice    one slice, and why it comes first
```

## Writing a HANDOFF block

When the Human asks you to hand off, first bring the ExecPlan's Progress up to date, so the
block can point at it. Then write the HANDOFF block from your seat prompt so that every field
points to an artifact instead of copying it:

- **Outcome**: the ExecPlan path, and the date of the owner directive that set the outcome.
- **Open Peers**: agent ID, labels, and state, only for Peers the Human has to detach.
- **SHAs**: accepted and awaiting acceptance, one line each; the diffs live in git.
- **Open decisions**: the ADR numbers and Decision log lines, with each holder.
- **Schedules**: the IDs `list_schedules` still shows.
- **Lessons**: what you would do differently, in a few lines.

Add two more lines: `Verified` (which of these you confirmed by command in this session) and
`Start with` (the skills the successor should run first, usually `/project-state`). Copy nothing
that already lives in a plan, an ADR, a commit, or a report; a copy goes stale while the
original stays current. Leave secrets and credentials out. Done when the block fits on one
screen and every item in it is a path, an ID, a SHA, or a one-line fact.

The rule that matters most: run the check before you trust the record, and before you add
anything to it.
