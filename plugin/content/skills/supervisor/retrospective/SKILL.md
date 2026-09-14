---
name: retrospective
description: "Turns a period of attention logs and lesson lines into notebook rows and at most one proposed change, by classifying each costly episode as a specification, coordination, or verification failure and counting which pattern has been seen twice. Use when the Human asks what to change, or after an episode that cost a rework round; not after a single surprise."
---

# Retrospective

You turn what the logs already recorded into updated notebook rows and at most one change worth making. Multi-agent work mostly fails by its organization rather than by model capability, so the class of each failure says where its fix belongs, and "use a stronger model" is proposed only once you can name the instruction the weaker one dropped.

| Class | It looks like | The fix lives in |
|---|---|---|
| Specification | work nobody asked for, an invented contract, a different problem solved | the directive, the brief's fields, the prompt that let work start without them |
| Coordination | two writers on one scope, a question that died, a result at the wrong agent, an ignored label | the message labels, the handoff fields, what each layer sees |
| Verification | a proof that passed without the behavior, a summary taken as evidence, a finding after a merge | the acceptance checklist, when a Reviewer is required, what counts as output |

## Procedure

1. **Collect evidence, not memory.** Read the period's attention logs under `$SEATWORKS_STATE/attention.log` and lesson lines in `$SEATWORKS_STATE/lessons.md`, and quote each line you use with its date; a retrospective from memory reproduces what you already believed.
2. **Write one episode per costly event:** what happened, its cost in something countable (a rework round, an abandoned agent, a finding after a merge, a question the Human answered twice), and its class. An event with no cost stays in the log.
3. **Count.** Group episodes by class and mechanism, with a count and the dates behind it. "Seen twice" is a count, not an impression.
4. **Match the notebook.** A group matching a row raises its Seen and Last; a recurrence under an `applied` row means the fix was too weak, a stronger finding than a new row. An unmatched group becomes a row at `observed` and nothing more.
5. **Propose at most one change:** the group with the highest count and clearest class, as the smallest diff to one file (a prompt line, a brief field, an acceptance item, a trigger, a setting), with its two dated episodes, its class, and what would show it made things worse. One change per retrospective keeps its effect attributable. Removing a rule whose episodes stopped counts as a change.

Judge the system, not the agent: "the brief's owned scope was one directory and the work needed two" is a finding, "the Peer was careless" is not. Keep what a log says apart from what you infer from it.

## Ends in

Updated notebook rows, and the proposal as a diff for the Human in your reply, with its row set to `adopted`, the file under Fix lives in, and what would show it worked under Check.

The rule that matters most: one change per retrospective, with two dated episodes behind it.
