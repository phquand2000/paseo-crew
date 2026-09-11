# Rehearsal: old text against new text

A rehearsal shows whether a changed rule changes behavior. You replay the episode the old text
failed on, first on a fresh seat that reads the old text and then on one that reads the new text,
and compare what the two seats say they would do next. The seats answer in text only, so nothing
in a project changes.

## Before you start

- Ask the Human once whether you may run the rehearsal seats. That approval is what lets a Lead
  rehearsal open with `OWNER DIRECTIVE:`.
- Record `git status --porcelain` in the kit, so you can confirm afterwards that only your diff
  changed.

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
  the file contents or command output, and the state of other agents as that agent knew it.

## Seats per surface

| Surface changed | Seat to create | How |
|---|---|---|
| the project's `.seatworks/LEAD.md` | `claude-lead-SLUG` | `settings.modeId: "bypassPermissions"`, a `thinkingOptionId`, and a first prompt of `OWNER DIRECTIVE:` followed by the scenario |
| the project's `.seatworks/PEER.md` | `pi-peer-SLUG/<model>` | `settings.thinkingOptionId` only; the scenario inside a brief with disposition Scout and owned scope `none` |
| `claude/SUPERVISOR.md` | `claude-supervisor` | same settings as the Lead; the scenario as the first prompt |
| a repository file or a skill | the seat that reads it | quote the old rule in the first run and the new rule in the second, as part of `FACTS` |

Create each seat in the kit's workspace, since the scenario carries the facts and no project needs
to be touched.

## Running and comparing

1. Run the scenario on a seat with the old text, and quote its answer.
2. Apply the diff to the working tree, or pop the stash.
3. Run the same scenario on a new seat, and quote its answer.
4. Compare: did the old seat choose X, and the new seat choose Y without overshooting? If the
   result is borderline, run each version once more; one run of each is weak evidence.
5. Archive every rehearsal seat with `archive_agent`. Then confirm that `list_agents` shows no
   agent the rehearsal seats created, and that `git status --porcelain` in the kit shows only your
   diff.

Record the two quotes and the comparison for the Human's approval step.
