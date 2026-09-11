# Rehearsal: old text against new text

Replay the episode the old text failed on, first on a fresh seat that reads the old text, then on
one that reads the new text, and compare what each says it would do next. The seats answer in
text only, so no project changes.

## Before you start

- Ask the Human once whether you may run the rehearsal seats; that approval is what lets a Lead
  rehearsal open with `OWNER DIRECTIVE:`.
- Record `git status --porcelain`, to confirm afterwards that only your diff changed.

## The scenario

Build it from the notebook episode, with the facts the agent had at the time and no hint of the
desired answer:

```text
This is a rehearsal. Answer in text only: change no files, run no commands that write, and
create or message no agents.

Situation: SITUATION
What you have: FACTS
Question: what do you do next, and which rule or reason leads you there?
```

Replace the following:

- `SITUATION`: the moment before the wrong action, in the agent's own terms. For a Peer, leave
  out Paseo, seats, and the Supervisor.
- `FACTS`: what the agent could see then, from the retrospective's "could see" table: the brief,
  the file contents or command output, and other agents' state as that agent knew it.

## Seats per surface

Create each seat in the project's workspace; the scenario carries the facts, so no project is
touched.

| Surface changed | Seat to create | How |
|---|---|---|
| the project's `.seatworks/LEAD.md` | `claude-lead-SLUG` | `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`; first prompt `OWNER DIRECTIVE:` followed by the scenario |
| the project's `.seatworks/PEER.md` | `pi-peer-SLUG/<model>` | `settings.thinkingOptionId` only; the scenario inside a brief with disposition Scout and owned scope `none` |
| `.seatworks/SUPERVISOR.md` | `claude-supervisor-SLUG` | the Lead's settings; the scenario as the first prompt |
| `.seatworks/WATCHER.md` | `claude-watcher-SLUG/claude-haiku-4-5` | `settings.modeId: "bypassPermissions"` and no thinking option; activity excerpts as `FACTS`, and the question "which trigger, if any, matches, and what do you log or send?" |
| a repository file or a skill | the seat that reads it | the old rule quoted in `FACTS` for the first run, the new rule for the second |

## Running and comparing

1. Run the scenario on a seat with the old text, and quote its answer.
2. Apply the diff to the working tree, or pop the stash.
3. Run the same scenario on a new seat, and quote its answer.
4. Compare: did the old seat choose X, and the new seat Y without overshooting? If borderline, run
   each version once more; one run of each is weak evidence.
5. Archive every rehearsal seat with `archive_agent`, then confirm that `list_agents` shows no
   agent they created and `git status --porcelain` shows only your diff.

Record the two quotes and the comparison for the Human's approval step.
