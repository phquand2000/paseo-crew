# Rehearsal: old text against new text

Replay the episode the old text failed on, first on a fresh seat that reads the old text, then on
one that reads the new text, and compare what each says it would do next. The seats answer in
text only, so no project changes.

## Before you start

- Ask the Human once whether you may run the rehearsal seats; that approval is what lets a Lead
  rehearsal open with `OWNER DIRECTIVE:`.
- Record `git status --porcelain`, to confirm afterwards that nothing else changed.

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

Create each seat with `create_agent` in this project's workspace, which is what makes it this
project's seat, from the role profile below, passing the provider/model and settings the profile
lists; the scenario carries the facts, so no project is touched.

| Surface changed | Profile | First prompt |
|---|---|---|
| `LEAD.md` | `lead` | `OWNER DIRECTIVE:` followed by the scenario |
| `PEER.md` or `REVIEWER.md` | `peer-ro` or `reviewer` | the scenario inside a brief with disposition Scout (Reviewer for `REVIEWER.md`) and owned scope `none` |
| `SUPERVISOR.md` | `supervisor` | the scenario |
| `WATCHER.md` | `watcher` | `This is a rehearsal. Supervisor agent: none. Lead agents: none. Answer in text only; call no tools.`, then the scenario with activity excerpts as `FACTS` and the question "which trigger, if any, matches, and what do you log or send?" |
| `WORKSPACE_PROTOCOL.md`, `AGENTS.md`, or a skill | the seat that reads it | the scenario, with the old rule quoted in `FACTS` for the first run and the new rule for the second |

## Running and comparing

1. Run the scenario on a seat with the old text, and quote its answer.
2. For a seat prompt, which the seat reads from the project's `.seatworks/`, copy the project's
   file to `.seatworks/records/drafts/FILE.old`, then make the diff's change in the project's
   file.
3. Run the same scenario on a new seat, and quote its answer.
4. Compare: did the old seat choose X, and the new seat Y without overshooting? If borderline, run
   each version once more; one run of each is weak evidence.
5. Copy `FILE.old` back over the project's file, because every seat started from then on reads
   it, and the approved change arrives through the kit. Archive every rehearsal seat with
   `archive_agent`, then confirm that `list_agents` shows no agent they created and
   `git status --porcelain` matches what you recorded.

Record the two quotes and the comparison for the Human's approval step.
