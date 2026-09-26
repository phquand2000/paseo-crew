---
name: grilling
description: "Settles with the Human what new work should do before any lane opens: numbered rounds of questions, each with a recommended answer, until nothing about what the project does or how it behaves is assumed, and every settled answer is in CONTEXT.md. Use when the Human brings new work or a behavior change CONTEXT.md does not answer; not for a tiny change, a question CONTEXT.md settles, or work already settled with the Human."
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
ask the rest of the round meanwhile.

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

Write each answer that settles a behavior or a term into `$SEATWORKS_STATE/CONTEXT.md` the moment it
is settled, shaped by `$SEATWORKS_KIT/content/guides/CONTEXT_FORMAT.md`; one that changes an earlier
answer replaces its line. Create the file with the first settled answer, not before.

## Read-back

Before the first lane opens, give the Human one screen to correct: the lanes you will open, each
with its outcome and acceptance, what you assumed, and what will bring them back (a question only they
can answer, an act that cannot be undone). With it, settle what the desk keeps for every lane: where
lanes work when their copy makes that a question (`set_project` `laneHome`), and which paths no landing
touches before the Human looks (`set_project` `askFirst`). Offer the ones this work reaches among
access (auth, login, session, passwords, secrets, credentials, tokens), money (payments, billing) and
what ships (CI workflows, Docker, `.env`, infra, deploy, terraform, k8s, helm); they keep or drop each,
and nothing waits for them unless they keep one. Name the risk rules this work reaches (the kit's put a
question to every review of migrations, schemas and SQL; `set_project` `riskRules` replaces them), and
ask for a command that rehearses one, such as a migration run twice on a copy, where they have one. A correction is a settled answer like any other; what
they want to be woken for, in their words, goes in `$SEATWORKS_STATE/notebook.md`.

## Ends in

Every branch visited, nothing about the concept silently assumed, and the Human's confirmation that
you have understood. If the Human says to start before that, start, and name what is still open in
the lane's out of scope or as the point where its Lead must ask.
