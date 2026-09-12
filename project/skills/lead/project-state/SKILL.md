---
name: project-state
description: "Rebuilds verified project state on a cold start (acceptance check, claims vs evidence, open decisions, live agents), picks one next slice, and writes HANDOFF blocks. Use when starting as a new or successor Lead, resuming a project, or handing off."
---

# Project state

Establish what is actually true before you add to a project: handoffs, plans, and status lines
are claims until a command confirms them. Output: a state summary in your reply, ExecPlan
Progress lines corrected to the verified state, and one next slice. The last section covers the
HANDOFF block you write when leaving.

Before you start, finish your seat prompt's start-of-session steps: the repository root,
`AGENTS.md`, and `.seatworks/WORKSPACE_PROTOCOL.md`.

## Procedure

1. **Confirm where you are.**

   ```bash
   git rev-parse --show-toplevel && git branch --show-current
   git status --short
   git worktree list
   ```

   Done when the root matches your first prompt or the HANDOFF block, and you know whose
   uncommitted changes, if any, are in the checkout. Leave changes you didn't make alone.

2. **Read the durable record**, in order: the HANDOFF block if you are a successor;
   `docs/exec-plans/active/*.md`, especially Progress and the Decision log; titles and statuses
   in `docs/adr/`; `CONTEXT.md`; then `git log --oneline -30` and
   `git log --since="2 weeks ago" --stat --format='%h %ad %s' --date=short`. Treat all of it as
   claims to check in step 4, not as facts. Done when you have a list of claims: slices
   accepted, SHAs, checks said to pass, and decisions said to be settled.

3. **Run the acceptance check before any new work**: the check and acceptance commands in
   `AGENTS.md`, or the project's smoke test. Record the output. A failure left by the previous
   session is cheapest to find now, and it tells you what comes first. Done when you have the
   output, pass or fail, with the first failure named.

4. **Compare claimed with verified status.** For each claim, run
   `git cat-file -e "$sha^{commit}" && echo exists` and
   `git merge-base --is-ancestor "$sha" HEAD && echo reachable`, and rerun its verification
   command if step 3 didn't cover it. Mark it `verified`, `contradicted` (with evidence), or
   `unverifiable` (with where you looked), and correct the ExecPlan's Progress lines. Done when
   every claim has a mark.

5. **Find the hotspots**, the large, often-changed files where defects and merge conflicts
   collect:

   ```bash
   git log --since="6 months ago" --format= --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20
   ```

   Add the line count (`wc -l`) of the top entries as a rough measure of complexity. Done when
   you have the top five files by churn and size together. A slice touching one rates at least
   Medium on leverage at intake.

6. **List the open decisions and their holders** (the Human, you, or a named Peer): ADRs with
   status `proposed`, open Decision log entries, the HANDOFF block's open decisions, and
   `BLOCKED` or `REOPEN_REQUEST` items without a ruling. Done when every open decision has a
   holder.

7. **List the live agents.** Call `list_agents`, raising `sinceHours` (up to 720) for a quiet
   project, and read each agent's `status` and labels (`plan`, `task`, `council.*`, `review.*`)
   to see what it holds. Check `list_schedules` for leftover schedules; it never shows
   heartbeats, and only the agent that set one can delete it, so ask the Human about any
   heartbeat the HANDOFF block lists as still live. A predecessor's agents notify it, not you:
   read their state with `get_agent_activity`, treat any committed SHA as a
   fact to review, and ask the Human to detach or archive an agent you need to take over. Done
   when every live agent is matched to a slice or marked unowned.

8. **Choose one next slice**, the first that applies: a failing check from step 3; a
   contradicted claim other work depends on; an open decision blocking the frontier; otherwise
   the next frontier slice in the ExecPlan, preferring the riskiest. Run intake for it if it is
   new work. Done when the state summary names exactly one next slice and the reason.

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

When the Human asks you to hand off, first update the ExecPlan's Progress so the block can point
at it. Then write the HANDOFF block, one line per field, each pointing to an artifact rather than
copying it:

- **Outcome**: the ExecPlan path, and the date of the owner directive that set the outcome.
- **Open Peers**: agent ID, labels, and state, only for Peers the Human has to detach.
- **SHAs**: accepted and awaiting acceptance, one line each; the diffs live in git.
- **Open decisions**: the ADR numbers and Decision log lines, with each holder.
- **Schedules**: the IDs `list_schedules` still shows. First delete your heartbeats with
  `delete_heartbeat` and the IDs you noted, in Progress or in your replies, since no one else
  can; list any left.
- **Lessons**: what you would do differently, in a few lines.
- **Verified**: which of these you confirmed by command in this session.
- **Start with**: the skills the successor should run first, usually `/project-state`.

Copy nothing that lives in a plan, ADR, commit, or report (copies go stale), and leave secrets
and credentials out. Done when the block fits on one screen and every item is a path, an ID, a
SHA, or a one-line fact.

The rule that matters most: run the check before you trust the record, and before you add
anything to it.
