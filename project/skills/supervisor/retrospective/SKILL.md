---
name: retrospective
description: "Turns a week of attention logs and lesson lines into at most one proposed rule change, by classifying each episode as a specification, coordination, or verification failure and finding which pattern has now been seen twice. Use when the Human asks what to change, or after an episode that cost a rework round; not after a single surprise."
---

# Retrospective

Use this skill to turn what the logs already recorded into one change worth making, and to
answer the question `.seatworks/prompts/SUPERVISOR.md` leaves open: which pattern has been seen
twice. It ends in updated notebook rows and at most one proposal for the Human.

## The finding this rests on

Multi-agent systems mostly fail by organizational design rather than by model capability: the
largest published trace study of agent failures classifies them into specification and system
design, inter-agent misalignment, and task verification, and finds that better orchestration,
not a larger model, is what moves the outcome. Two consequences for this procedure. Classify
every episode into one of those three, because the class names where the fix belongs. And treat
"run it on a stronger model" as a finding of last resort: propose it only after you can say which
instruction the weaker model dropped, since the same instruction usually drops silently on the
stronger one too.

| Class | It looks like | The fix lives in |
|---|---|---|
| Specification | a seat did work nobody asked for, invented a contract, or solved a different problem | the directive, the brief's fields, the prompt that let it start without them |
| Coordination | two seats owned one scope, a question died unanswered, a result reached the wrong seat, a label was ignored | the message labels, the handoff fields, what each layer is allowed to see |
| Verification | a proof passed while the behavior was absent, acceptance took a summary for evidence, a finding came back after a merge | the acceptance checklist, when a Reviewer is required, what counts as output |

## Procedure

1. **Set the window and collect the evidence.** Take the attention logs and the Lead's lesson
   lines for the period, and nothing else; a retrospective from memory reproduces whatever you
   already believed.

   ```sh
   ls .seatworks/records/attention/
   cat .seatworks/records/attention/*.md .seatworks/records/lessons/*.md
   ```

   Done when every line you will reason about is quoted with its date.
2. **Write one episode per line that cost something.** An episode is: what happened, the cost in
   something countable (a rework round, an abandoned seat, a finding found after a merge, a
   question the Human had to answer twice), and the class from the table. An event with no cost
   is not an episode; leave it in the log.
3. **Count.** Group episodes by class and by the mechanism behind them, then count occurrences
   with dates. This is the "seen twice" test, and it is a count, not an impression:

   ```sh
   grep -ciE '<mechanism pattern>' .seatworks/records/attention/*.md
   ```

   Done when each group has a number and the dates that produced it.
4. **Check the notebook before proposing anything.** A group that matches a row raises its Seen
   and Last and inherits where its fix lives; a recurrence under an `applied` row is evidence the
   fix was too weak, which is a stronger finding than a new row. A group with no row becomes one
   at `observed` and nothing else. Done when every group is a row or a raised count.
5. **Propose at most one change.** Take the group with the highest count and the clearest class,
   and write it as the smallest diff to one file: a prompt line, a brief field, an acceptance
   item, a trigger, a setting. With it, bring the two dated episodes that justify it, the class,
   and what would show it made things worse. Everything else stays in the notebook; a
   retrospective that proposes four changes makes the next one unattributable, because nobody
   can tell which change moved the outcome.
6. **Hand it over.** The proposal goes to the Human as a diff in your reply. Set its row to
   `adopted`, with the file the diff changes under Fix lives in and what would show it worked under Check.

## Rules

- One observation is not a pattern. A single surprise gets a row at `observed` and nothing more,
  because a rule added after one event makes the system unpredictable for everyone after you.
- Judge the system, not the seat. "The Peer was careless" is not a class; "the brief's owned
  scope was a directory and the work needed two" is.
- Keep observation and inference apart in every line you write. What the log says is one thing;
  what you think it means is another, and only the first survives your being replaced.
- A proposal that removes a rule counts. The kit's rules accumulate and nothing else drops them:
  if a rule's episodes stopped happening, propose deleting it and say since when.
- No retrospective about a retrospective.

The rule that matters most: one change per retrospective, with two dated episodes behind it.
