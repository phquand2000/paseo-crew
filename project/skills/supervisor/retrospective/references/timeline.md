# Timeline and visibility template

Build the timeline first, and interpret it afterwards. Each row is one event with a source a
reader can check.

Copy the block below. If it runs over 15 rows, save it to `.seatworks/records/timelines/YYYY-MM-DD-SLUG.md`; otherwise, summarize it in the entry's Observed line.

```md
# TITLE

Question: QUESTION
Window: START to END
Agents: AGENT_LIST

## Timeline

| Time | Agent | Event | Source |
|---|---|---|---|
| TIME | AGENT | EVENT | SOURCE |

## What each agent could see

| Decision point | Agent | Brief or prompt | Context | Tools | Time and quota |
|---|---|---|---|---|---|
| ROW_REF | AGENT | BRIEF | CONTEXT | TOOLS | QUOTA |
```

Replace the following:

- `TITLE`: the episode in a few words, for example `Lost Peer commit in echo`.
- `QUESTION`: which outcome went wrong, in which project.
- `START`, `END`: the ISO timestamps bounding the window.
- `AGENT_LIST`: each agent's role and ID, for example `Lead a1b2, Peer c3d4 (archived)`.
- `TIME`: the ISO timestamp of the event.
- `AGENT`: the role and ID of the agent that acted.
- `EVENT`: what happened, quoting output where you can. Leave causes out of this column.
- `SOURCE`: where the event came from: `activity c3d4`, `git log abc123`, `reflog`,
  `NOTEBOOK 2026-08-28`, `.seatworks/records/directives/2026-08-25-sdk.md`, or `unknown`.
- `ROW_REF`: the timeline row where the decision was made.
- `BRIEF`: the part of the brief or prompt that bore on the decision, quoted.
- `CONTEXT`: the session length, whether it had compacted, and what it had read.
- `TOOLS`: what it could and couldn't call, and the guard or deny entry behind that.
- `QUOTA`: rate limits, auth errors, or time spent waiting, or `none`.
