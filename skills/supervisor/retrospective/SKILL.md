---
name: retrospective
description: "Runs a blameless retrospective on an agent episode: builds the timeline from Paseo activity, git, and the notebook before interpreting anything, reconstructs what each agent could see, looks for contributing causes in the system, and records one or two typed actions as a notebook entry. Use when a failure repeats, work is lost, or an acceptance is reversed, or when the Human asks for one."
---

# Retrospective

Use this skill to learn from an episode where the agents went wrong, and to record the lesson as
an entry in `notebook/NOTEBOOK.md`, in that file's entry format. You can't fix a model, but you
can fix what it was given (the brief, the tools, the checks, the topology), so the question is
always what made the wrong action look right at the time.

Paths starting with `references/` are relative to this skill's directory; every other path is
relative to the kit.

## When to run it

Run a retrospective when one of these holds:

- A failure repeated: the same notebook pattern on two different days, or two identical
  failures within one task.
- Work was lost: a commit is unreachable, a user's uncommitted change was overwritten, a Peer
  was archived with unaccepted work, or a handoff arrived without its SHAs.
- An acceptance was reversed: an accepted SHA was reverted or reopened, or the Human rejected it
  after acceptance.
- The Human asks for one.

For a first, one-off failure, a plain notebook entry is enough.

## Procedure

The phases follow the usual shape of a retrospective: set the stage, gather data, generate
insights, decide what to do, and close.

1. **Set the stage.** Write down the question (which outcome went wrong, in which project), the
   time window, and the agents involved; use `list_agents` for IDs, and the notebook and git for
   agents that are already archived. **Done** when the question, the window, and the agent list
   are written at the top of the timeline.
2. **Gather the timeline before interpreting anything.** A cause proposed before the timeline
   exists tends to pick the evidence that fits it. Use these sources:
   - `get_agent_activity` for each agent, limited to the window;
   - `git -C REPO log --since=START --until=END --format='%h %ad %an %s' --date=iso`;
   - `git -C REPO reflog --date=iso` for commits that were lost or rewritten;
   - notebook entries, copies of directives under `records/directives/`, and handoffs quoted in activity.

   Record one row per event, with the time, the agent, what happened, and the source, quoting
   output where you can; [references/timeline.md](references/timeline.md) has the format. Mark
   gaps `unknown` instead of filling them in. If the timeline runs over 15 rows, save it to
   `records/timelines/YYYY-MM-DD-SLUG.md`. **Done** when every event you will cite later has a
   row with a source.
3. **Reconstruct what each agent could see.** For each decision point in the timeline, record:
   - the brief or first prompt, word for word;
   - the context: how long the session was, whether it had compacted, and what the agent had
     read;
   - the tools: the provider's `disallowedTools`, `pi/extensions/peer-guard.ts` for Peers, and
     whether Paseo tools were present;
   - time and quota: rate limits, auth errors, and waiting on dead agents.

   **Done** when every decision point has a "could see" line.
4. **Find the contributing causes in the system.** For each decision point that went wrong, ask
   which of these made the wrong action likely, or let it through:

   | Category | Ask |
   |---|---|
   | Navigation and context access | Did the information exist but was hard to reach, or was it missing (logs, state, a decision)? |
   | Automated checks | Could a test, lint, guard, or `--check` have caught it? |
   | Standards | Did the acceptance checklist or the Reviewer brief miss it, or does a rule in it misfire? |
   | `AGENTS.md` or protocol | Was a repository rule missing or wrong, or in the file the wrong agent reads? |
   | Tool economy | Were there expensive or looping tool calls, polling, or permission loops? |
   | No-op work | Did steps or instructions change nothing: duplicate proof, ceremony? |
   | Topology | Ownership, parallel writers, archive cascades, notification routing, who created whom? |
   | Prompt | Did a seat prompt's wording cause or permit it? |

   "The model erred" isn't a cause; rewrite it as what in the system made the error likely or let
   it through. Several causes are normal, and `unknown` is a valid finding. **Done** when every
   cause cites timeline rows.
5. **Check earlier actions.** Find notebook entries on the same pattern with the status
   `applied KIT_SHA`. Did the behavior change after that commit's date? An action that didn't
   change behavior is a finding in its own right. **Done** when each related entry is marked as
   held or not held, with the timeline row that shows it.
6. **Decide on one or two actions.** Give each action a type:
   - `notebook-only`: record it and watch for recurrence. This is the default for a first
     occurrence, because a rule changed after one observation makes the system unpredictable.
   - `advice`: an `ADVICE:` message to a Lead, when it would materially improve that Lead's next
     action.
   - `patch`: a prompt, protocol, or check change through the protocol-patch skill, allowed only
     when the pattern has recurred on two different days or the Human asks.

   Give each action an owner (you, a named Lead, or the Human) and a removal trigger. Prefer a
   check or an enforced limit over prose when either would work, because a prompt is guidance
   and a check is enforcement. **Done** when every action has a type, an owner, and a removal
   trigger.
7. **Write the notebook entry.** Use the format in `notebook/NOTEBOOK.md` exactly:
   - Observed: the project, the agent IDs, and a summary of the timeline with quotes, plus the
     timeline file's path if you saved one.
   - Suspected mechanism: the contributing causes, each with its category.
   - Seen: the count and the dates.
   - Smallest correction: each action as `TYPE: ACTION; owner OWNER; remove when TRIGGER`.
   - Status: `open`.

   If an existing entry describes the same pattern, update only its `Seen` line instead of
   adding an entry, unless your evidence is materially stronger. **Done** when the entry is
   appended, or the `Seen` line is updated.
8. **Close.** Send the advice, if an action has that type. Report to the Human in at most five
   lines: the question, the main cause, the actions, and what needs a Human decision. **Done**
   when the report is sent. The next retrospective on this pattern starts at step 5 with this
   entry.

An entry looks like this:

```text
## 2026-09-02 — Lead waited on a Peer that had run out of quota
- Observed: project echo, Lead a1b2, Peer c3d4. The Peer failed at 10:14 with "429 quota
  exceeded"; the Lead waited without any check until 13:40 (timeline:
  records/timelines/2026-09-02-echo-quota.md).
- Suspected mechanism: topology (the failure notification went to the Lead, which treated
  silence as progress); automated checks (no heartbeat on a task expected to run over 30 minutes).
- Seen: 2 (2026-08-28, 2026-09-02)
- Smallest correction: advice: set one heartbeat on Peers expected to run over 30 minutes;
  owner Lead of echo; remove when Paseo reports quota errors as a notification.
- Status: open
```

The rule that matters most: build the timeline before naming any cause, and look for causes in
what the agents were given rather than in the agents.
