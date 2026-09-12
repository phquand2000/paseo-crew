---
name: attention-watch
description: "Keeps a watcher and the weekly review running, answers ATTENTION events with a log line, CHECK, ADVICE, or Human report, and gives the away report. Use when a Lead starts or gets a directive, an event arrives, or the Human leaves or returns."
---

# Attention watch

The watcher, a Haiku agent running `.seatworks/WATCHER.md`, sweeps the Lead's and Peers'
activity and sends you `ATTENTION:` events. This skill keeps it running and answers its events
with `CHECK:` questions, `ADVICE:`, Human reports, and your action at the end of each line of
the attention log, `.seatworks/records/attention/YYYY-MM-DD.md` (git ignores it). `references/`
paths are relative to this skill's directory; the rest to the repository root.

## Keep a watcher running

1. **Find the watcher profile** in `list_profiles`: the id ending in `-watcher`. If there is
   none, the project predates the watcher seat: ask the Human to rerun
   `fish $SEATWORKS_KIT/setup/add-project.fish REPO_ROOT` (without `--refresh`), and until then
   read the Lead's activity yourself once an hour. **Done** when you have the profile, or the
   Human has the request.
2. **Check with every directive.** Each time you send a Lead an `OWNER DIRECTIVE:`, and whenever
   a Lead is added or replaced, call `list_agents` and look for a running agent labeled
   `role: watcher`.
   - None: create one from the watcher profile, copying its provider/model and `modeId` and
     passing no thinking option; the profile guard blocks anything else. Use title
     `watcher PROJECT`, labels `{ role: "watcher" }`, and this first prompt, with your own ID
     from `echo "$PASEO_AGENT_ID"`. Leave `notifyOnFinish` at its default: its one-line reply
     confirms the heartbeat.
   - One: send it the same prompt with `send_agent_prompt` and `notifyOnFinish: false`; it
     replaces its heartbeat and records the new IDs.

   ```text
   Supervisor agent: SUPERVISOR_ID
   Lead agents: EVERY_ACTIVE_LEAD_ID
   Cadence: */15 * * * *
   ```

   While a Lead works a high-risk lane or runs a council, send cadence `*/5 * * * *`, and
   `*/15 * * * *` again once it's done. **Done** when a watcher is running with every active
   Lead ID. When no Lead is active, archive the watcher; Paseo completes its heartbeat with it.
3. **Schedule your weekly review:** `create_heartbeat` named `weekly-review`, cron `0 9 * * 1`,
   prompt `WEEKLY REVIEW`; the same name replaces an earlier one. On that prompt, run the weekly
   review in the `retrospective` skill. **Done** when the heartbeat call returns.

## Answer an event

Decide from the excerpt the event quotes; pull `get_agent_activity` only when it isn't enough.
Take the default step for its trigger from [references/questions.md](references/questions.md),
move one step up or down only with a reason from the excerpt, and log it in the watcher's
format, `HH:MM  supervisor  -> ACTION` (time from `date +%H:%M`), so the away report reads as
one timeline:

1. **Log only** when the quote shows the agent already correcting itself, or the trigger is
   `log`-class. **Done** when the line ends in `-> logged`.
2. **Ask a `CHECK:` question** when the agent could see the problem itself if it looked. Adapt
   the trigger's question, naming the source to check against: the brief, a contract,
   `AGENTS.md`, an ADR, the test anti-pattern catalog. One question per message, at most three
   lines. Send it to the Lead, as `CHECK: for AGENT_ID: QUESTION` for a Peer or `CHECK:
   QUESTION` for the Lead itself, when the Lead is idle (`get_agent_status`) unless the risk is
   irreversible, and with `notifyOnFinish: false`, since the answer comes back as the watcher's
   `check answer` event and a notification would only end the Lead's next wait early. If the
   Lead is running, log `-> held` and send it before anything new the next time an event brings
   you back. **Done** when the question is sent and logged.
3. **Send `ADVICE:`** when the issue is coordination the Lead owns: framing, staffing,
   sequencing, a closed question in a brief. Send it as in step 2.
4. **Take it to the Human** when the event touches a reserved decision, an irreversible side
   effect, or a trade-off nobody below the Human may make, such as weakening a guarantee the
   directive sets. Give the event, the options you see, and your recommendation, marked as
   yours.

A `check answer` event carries the reply. Read it once. If the agent looked and found nothing,
accept it and log `-> checked, nothing`; asking again turns a question into an accusation. If it
found something, log what, and leave the fix to its owner.

## Away mode

When the Human says they are away (asleep, driving, busy elsewhere), log the time and keep
answering events, but bring them only an `urgent` event or an irreversible risk; hold the rest
for the report. When they are back, give the away report from the attention log, in at most ten
short lines that read well aloud. Leave out empty lines, and keep what the log shows apart from
what you infer:

```text
While you were away (START to END)
- Decisions: WHO decided WHAT, over WHICH alternatives. OK?
- Disagreements: the Peer objected to X with EVIDENCE; the Lead KEPT or WITHDREW its ruling. OK?
- Incidents: what happened, the damage, what was done
- Waiting for you: QUESTION (default if you don't answer: DEFAULT)
- Quiet: agents with nothing notable
```

The rule that matters most: a question that points at the source, asked at the right moment,
does more than any instruction, and it must never turn into an accusation.
