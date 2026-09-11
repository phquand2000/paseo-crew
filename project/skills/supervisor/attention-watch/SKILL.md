---
name: attention-watch
description: "Runs the Supervisor's side of event-driven attention: starts the Haiku watcher and the weekly-review heartbeat with each Lead, answers each ATTENTION event with a log line, a neutral CHECK question routed through the Lead, ADVICE, or a Human report, and writes the away report. Use when a Lead starts, an ATTENTION event arrives, or the Human goes away or returns."
---

# Attention watch

Use this skill to give the project's agents attention at the moments they are most likely to go
wrong, without polling and without filling your context. The watcher, a Haiku agent on the
`claude-watcher-SLUG` seat whose prompt is `.seatworks/WATCHER.md`, sweeps the activity and
sends you `ATTENTION:` events; you answer them.

It produces `CHECK:` questions, `ADVICE:`, Human reports, and your action at the end of each
line of the attention log, `.seatworks/records/attention/YYYY-MM-DD.md` (git ignores it). Paths
starting with `references/` are relative to this skill's directory; every other path is relative
to the repository root.

## Start with each Lead

1. Take the project's Watcher profile from `list_profiles` (`SLUG-watcher`: provider
   `claude-watcher-SLUG`, model `claude-haiku-4-5`, `modeId: "bypassPermissions"`, and no
   thinking option, because Haiku has none). If it is missing, the project predates the watcher
   seat: ask the Human to rerun `fish $SEATWORKS_KIT/setup/add-project.fish REPO_ROOT --refresh`,
   and go on without a watcher meanwhile. **Done** when you have the `provider/model` string, or
   the Human has the request.
2. Create the watcher with `create_agent`: title `watcher SLUG`, that provider,
   `settings: { modeId: "bypassPermissions" }`, labels `{ role: "watcher" }`, and this first
   prompt, with your own ID from `echo "$PASEO_AGENT_ID"`:

   ```text
   Supervisor agent: SUPERVISOR_ID
   Lead agents: LEAD_ID
   Cadence: */15 * * * *
   ```

   Leave `notifyOnFinish` at its default: the watcher's first turn ends with one line naming its
   heartbeat, and that single notification confirms it started. **Done** when that line arrives.
3. Keep one watcher per project. When a Lead is added or replaced, send the watcher the full
   list of Lead IDs with `send_agent_prompt` and `notifyOnFinish: false`. When no Lead is
   active, archive the watcher; Paseo completes its heartbeat along with it.
4. Schedule your weekly review: `create_heartbeat` named `weekly-review`, cron `0 9 * * 1`,
   prompt `WEEKLY REVIEW`. No tool lists heartbeats, but creating one again under the same name
   updates it, so create it with every Lead. On that prompt, run the weekly review in the
   `retrospective` skill. **Done** when the heartbeat call returns.

## Answer an event

Read the excerpt the event quotes; pull more activity with `get_agent_activity` only when the
excerpt isn't enough to decide. Then decide once, with the smallest step that works:

1. **Log only.** Most events end here: the agent is already correcting itself, or the matter is
   reversible and inside its authority. **Done** when the log line ends in `-> logged`.
2. **Ask a `CHECK:` question** when the agent could see the problem itself if it looked. Take a
   question from [references/questions.md](references/questions.md) and adapt its nouns:
   - Ask; don't assert. Name the source to check against (the brief, a contract, `AGENTS.md`,
     an ADR, the test anti-pattern catalog), and make "nothing found" a valid answer.
   - Don't name the fault you suspect, and don't hint at a fix. A model told it is wrong finds
     something wrong to please you; a model asked to look, looks.
   - One question per message, at most three lines.
   - Send it to the Lead: `CHECK: for AGENT_ID: QUESTION` for a Peer, `CHECK: QUESTION` for the
     Lead itself. The Lead forwards a Peer's question word for word, so the answer returns
     through the Lead's own notification instead of being pulled away from it.
   - A message interrupts a running agent's turn, so unless the risk is irreversible, send when
     the Lead is idle (`get_agent_status`).

   **Done** when the question is sent and logged.
3. **Send `ADVICE:`** when the issue is coordination the Lead owns: framing, staffing,
   sequencing, a closed question in a brief.
4. **Take it to the Human** when the event touches a reserved decision, an irreversible side
   effect, or a trade-off nobody below the Human may make, such as weakening a guarantee the
   directive sets. Give the event, the options you see, and your recommendation, marked as
   yours.

When the answer to a `CHECK:` arrives, read it once. If the agent looked and found nothing,
accept it and log `-> checked, nothing`: asking again turns a question into an accusation. If
it found something, log what, and leave the fix to its owner.

## Away mode

When the Human says they are away (asleep, driving, busy elsewhere), log the time. Keep
answering events as above, but bring the Human nothing except an `urgent` event or an
irreversible risk; hold every other question for the report. When the Human is back, give the
away report from the attention log, in at most ten short lines that read well aloud:

```text
While you were away (START to END)
- Decisions: WHO decided WHAT, over WHICH alternatives. OK?
- Disagreements: the Peer objected to X with EVIDENCE; the Lead KEPT or WITHDREW its ruling. OK?
- Incidents: what happened, the damage, what was done
- Waiting for you: QUESTION (default if you don't answer: DEFAULT)
- Quiet: agents with nothing notable
```

Leave out empty lines, and keep what the log shows apart from what you infer.

The rule that matters most: a question that points at the source, asked at the right moment,
does more than any instruction, and it must never turn into an accusation.
