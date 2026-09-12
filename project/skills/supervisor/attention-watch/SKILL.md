---
name: attention-watch
description: "Keeps a watcher and the weekly review running, then turns each ATTENTION event into the step the seat prompt's ladder allows, worded as a CHECK or ADVICE and recorded in the attention log. Use when a Lead starts or gets a directive, an event arrives, or the Human leaves or returns."
---

# Attention watch

The watcher, a small-model agent running `.seatworks/WATCHER.md`, sweeps the Lead's and Peers'
activity and sends you `ATTENTION:` events. This skill keeps it running and turns each event into
one line of the attention log, `.seatworks/records/attention/YYYY-MM-DD.md` (git ignores it).
`references/` paths are relative to this skill's directory; the rest to the repository root.

## Keep a watcher running

1. **Check with every directive.** Each time you send a Lead an `OWNER DIRECTIVE:`, and whenever
   a Lead is added or replaced, call `list_agents` and look for a running agent labeled
   `role: watcher` in this project's workspace.
   - None: create one from the `watcher` profile, copying its provider/model and `modeId` and
     passing no thinking option; the profile guard blocks anything else. Start it in this
     project's workspace, which is what makes it this project's watcher. Use title
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
   `*/15 * * * *` again on the event that ends it, which is the council's verdict or the Lead's
   acceptance; nothing else reports the state, and polling for it is what the cadence exists to
   avoid. **Done** when a watcher is running with every active Lead ID. When no Lead is active,
   archive the watcher; Paseo completes its heartbeat with it.

   If `list_profiles` shows no `watcher` profile, this machine's profiles predate the watcher
   seat: ask the Human to run `fish $SEATWORKS_KIT/setup/setup-seats.fish`, and until it exists
   read the Lead's activity yourself once an hour.
2. **Schedule your weekly review:** `create_heartbeat` named `weekly-review`, cron `0 9 * * 1`,
   prompt `WEEKLY REVIEW`; the same name replaces an earlier one. On that prompt, follow the
   weekly review in the `retrospective` skill. **Done** when the heartbeat call returns.

## Answer an event

Which step to take is the intervention ladder in your seat prompt; this skill supplies the
default per trigger and the wording. Decide from the excerpt the event quotes, and pull
`get_agent_activity` only when it isn't enough. Take the trigger's default step from
[references/questions.md](references/questions.md), move one rung up or down only with a reason
from the excerpt, and end every event with a line in the watcher's format,
`HH:MM  supervisor  -> ACTION` (time from `date +%H:%M`), so the away report reads as one
timeline.

What the ladder doesn't say:

- Stop at a log line when the quote shows the agent already correcting itself, or the trigger is
  `log`-class. The line ends in `-> logged`.
- A `CHECK:` names the source to look at (the brief, a contract, `AGENTS.md`, an ADR, the test
  anti-pattern catalog), asks one question in at most three lines, and goes to the Lead, as
  `CHECK: for AGENT_ID: QUESTION` for a Peer or `CHECK: QUESTION` for the Lead itself. Send it
  while the Lead is idle (`get_agent_status`) unless the risk is irreversible, and with
  `notifyOnFinish: false`, since the answer returns as the watcher's `check answer` event and a
  notification would only end the Lead's next wait early. If the Lead is running, log `-> held`
  and send it before anything new the next time an event brings you back.
- `ADVICE:` fits coordination the Lead owns: framing, staffing, sequencing, a closed question in
  a brief. Send it the same way.
- A `check answer` event carries the reply. Read it once. If the agent looked and found nothing,
  accept it and log `-> checked, nothing`; asking again turns a question into an accusation. If
  it found something, log what, and leave the fix to its owner.

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
