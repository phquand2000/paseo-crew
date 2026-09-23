---
name: grilling
description: "Settles with the Human what new work should do before any lane opens: questions in numbered rounds, each with a recommended answer, until nothing about what the project does or how it behaves is left assumed, with every settled answer written into the project's CONTEXT.md. Use when the Human brings new work, or a change to how the project behaves, that CONTEXT.md does not already answer; not for a tiny change, a question CONTEXT.md settles, or work already settled with the Human."
---

# Grilling

The rule that matters most: facts are yours to find, what the project does is the Human's to say,
and no lane opens until the Human agrees you have understood.

## What goes to the Human

Only what changes what the project does or how it behaves: who it is for, what happens in the cases
that matter, the rules its logic follows, what it will not do, and the words it is spoken of in. Stack,
design, tests, process and sequencing are yours: decide them, list them at the foot of the round under
**Assumed**, one line each, so the Human can overturn one, and do not ask.

A fact the repository or the tools can give you is never a question. Read only what settles it, and
ask the rest of the round meanwhile; only the questions that hang on that fact wait for it.

## Rounds

Map the request as a tree: every decision branches into the ones that hang on it. A round asks every
decision whose prerequisites are already settled, and no other: a question whose answer depends on
one still open in this round belongs to a later round. Number each, give your recommended answer, and
wait for the Human's answers before the next round.

```text
❓ **Q1 - <title>**: <the question, with the choices when there are some>

➡️ <your recommended answer, and why in a line>

---

❓ **Q2 - ...**

**Assumed:** <what you decided yourself, one line each>
```

Each answer reshapes the tree: recompute what can be asked now and ask that.

- **Sharpen vague words.** When the Human says "account", ask whether the customer or the user is
  meant, and propose the term to keep.
- **Test with a scenario.** When a rule is stated, invent the case at its edge and ask what happens
  there.
- **Say when the words disagree** with CONTEXT.md or with the code, and ask which is right.

## Writing it down

Write each answer that settles a behavior or a term into `$PASEO_CREW_STATE/CONTEXT.md` the moment it
is settled, shaped by `$PASEO_CREW_KIT/content/guides/CONTEXT_FORMAT.md`. An answer that changes an
earlier one replaces its line. Create the file with the first settled answer, not before.

## Ends in

Every branch visited, nothing about the concept silently assumed, and the Human's confirmation that
you have understood. If the Human says to start before that, start, and name what is still open in
the lane's out of scope or as the point where its Lead must ask.
