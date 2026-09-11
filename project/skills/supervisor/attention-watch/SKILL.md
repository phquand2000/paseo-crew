---
name: attention-watch
description: "Starts the watcher and weekly-review heartbeat with each Lead, answers ATTENTION events with a log line, CHECK, ADVICE, or Human report, and gives the away report. Use when a Lead starts, an ATTENTION event arrives, or the Human goes away or returns."
---

# Attention watch

The watcher, a Haiku agent on the `claude-watcher-SLUG` seat running `.seatworks/WATCHER.md`,
sweeps the Lead's and Peers' activity and sends you `ATTENTION:` events. This skill starts it
and answers them with `CHECK:` questions, `ADVICE:`, Human reports, and your action at the end
of each line of the attention log, `.seatworks/records/attention/YYYY-MM-DD.md` (git ignores
it). `references/` paths are relative to this skill's directory; the rest to the repository
root.

## Start with each Lead

1. **Find the Watcher profile** in `list_profiles`: `SLUG-watcher`, provider
   `claude-watcher-SLUG`, model `claude-haiku-4-5`, `modeId: "bypassPermissions"`, and no
   thinking option (Haiku has none). If it is missing, the project predates the watcher seat:
   ask the Human to rerun `fish $SEATWORKS_KIT/setup/add-project.fish REPO_ROOT --refresh`, and
   go on without a watcher meanwhile. **Done** when you have the `provider/model` string, or the
   Human has the request.
2. **Create the watcher** with `create_agent`: title `watcher SLUG`, that provider,
   `settings: { modeId: "bypassPermissions" }`, labels `{ role: "watcher" }`, and this first
   prompt, with your own ID from `echo "$PASEO_AGENT_ID"`:

   ```text
   Supervisor agent: SUPERVISOR_ID
   Lead agents: LEAD_ID
   Cadence: */15 * * * *
   ```

   Leave `notifyOnFinish` at its default: the watcher's first turn ends with one line naming its
   heartbeat, and that notification confirms it started. **Done** when that line arrives.
3. **Keep one watcher per project.** When a Lead is added or replaced, send the watcher the full
   list of Lead IDs with `send_agent_prompt` and `notifyOnFinish: false`. When no Lead is
   active, archive the watcher; Paseo completes its heartbeat along with it.
4. **Schedule your weekly review:** `create_heartbeat` named `weekly-review`, cron `0 9 * * 1`,
   prompt `WEEKLY REVIEW`. No tool lists heartbeats, but the same name updates one, so create it
   with every Lead. On that prompt, run the weekly review in the `retrospective` skill. **Done**
   when the heartbeat call returns.

## Answer an event

Decide from the excerpt the event quotes; pull `get_agent_activity` only when it isn't enough.
Decide once, with the smallest step that works, and log it in the watcher's format,
`HH:MM  supervisor  -> ACTION` (time from `date +%H:%M`), so the away report reads as one
timeline:

1. **Log only** when the agent is already correcting itself, or the matter is reversible and
   inside its authority. Most events end here. **Done** when the line ends in `-> logged`.
2. **Ask a `CHECK:` question** when the agent could see the problem itself if it looked. Adapt
   one from [references/questions.md](references/questions.md):
   - Ask; don't assert. Name the source to check against (the brief, a contract, `AGENTS.md`,
     an ADR, the test anti-pattern catalog), make "nothing found" a valid answer, and never name
     the fault you suspect or hint at a fix.
   - One question per message, at most three lines.
   - Send it to the Lead: `CHECK: for AGENT_ID: QUESTION` for a Peer, which the Lead forwards
     word for word, or `CHECK: QUESTION` for the Lead itself.
   - Unless the risk is irreversible, send when the Lead is idle (`get_agent_status`), since a
     message interrupts a running turn.

   **Done** when the question is sent and logged.
3. **Send `ADVICE:`** when the issue is coordination the Lead owns: framing, staffing,
   sequencing, a closed question in a brief.
4. **Take it to the Human** when the event touches a reserved decision, an irreversible side
   effect, or a trade-off nobody below the Human may make, such as weakening a guarantee the
   directive sets. Give the event, the options you see, and your recommendation, marked as
   yours.

When a `CHECK:` answer arrives, read it once. If the agent looked and found nothing, accept it
and log `-> checked, nothing`; asking again turns a question into an accusation. If it found
something, log what, and leave the fix to its owner.

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
