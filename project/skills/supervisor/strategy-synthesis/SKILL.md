---
name: strategy-synthesis
description: "Writes a strategy for one concern from about five recent ADRs, design docs, and notebook patterns: diagnosis, guiding policies, and enforcing actions. Use when the Human asks for a strategy, or the same decision keeps being argued across projects."
disable-model-invocation: true
---

# Strategy synthesis

Use this skill to write a strategy for one concern from the decisions the projects already made,
not from first principles. Such a strategy is usually unsurprising; its value is writing down
tradeoffs that keep coming back so they stop being argued each time.

It produces `.seatworks/records/strategy/CONCERN.md` from
[references/strategy-template.md](references/strategy-template.md), for the Human to approve.
`references/` paths are relative to this skill's directory; the rest to the repository root.

## Procedure

1. **Name the concern and its scope** from the request given with this skill, for example "data
   migrations" or "how SDKs are released", and list the projects in scope. **Done** when the
   concern fits one line and the project list is fixed.
2. **Gather about five inputs:** recent documents where a real tradeoff on this concern was
   made: ADRs and design docs (under `docs/adr/` or `docs/decisions/`, say), ExecPlan decision
   logs, notebook patterns, integration maps, and the reserved decisions in
   `.seatworks/records/directives/`. Prefer recent ones from different projects. For a large
   repository, give the search to a read-only Peer, created as in "Before the first question" in
   the intent-interview skill, asking for paths with a one-line summary of each decision. **Done** when you hold at least three inputs; with fewer, stop and tell the Human
   the concern is too new, because a strategy generalized from one or two decisions is a guess.
3. **Extract the decisions.** List each input's decisions with the reason it gave. Mark a
   decision recurring when two or more inputs made the same choice, contested when inputs chose
   differently or the point was argued more than once, and single otherwise. **Done** when every
   input contributes at least one row and each row is marked.
4. **Write the diagnosis:** a few sentences on what makes these decisions come back (the
   constraints, forces, and costs), citing the rows. It is a theory of the challenge, not a list
   of goals. **Done** when each sentence cites at least one decision row.
5. **Write the guiding policies** under three questions:
   - Where effort goes: what the projects spend on for this concern, and what they deliberately
     don't.
   - Rules that hold without exception: each with its reason, and who can grant an exception.
   - How undecided cases get decided: who decides, by which criteria, and which cases go to the
     Human because they're irreversible.

   Take a position and show the reasoning. Each policy cites the decisions it generalizes; each
   contested decision is resolved by a policy or listed as open for the Human. **Done** when
   every recurring and contested row maps to a policy or to the open list.
6. **Write the enforcing actions.** For each policy, the concrete actions that make it real: a
   check a Lead adds to acceptance, a rule in a repository's `AGENTS.md` or protocol, a seat
   prompt or skill change through the protocol-patch skill, or a lens used in reviews. Give each
   an owner, a surface, and a check that shows it was done. **Done** when every policy has at
   least one action, or names who is accountable for it.
7. **Test the strategy.** Apply two tests to each policy:
   - Applicable: replay two decisions from the inputs and one question open now. If the policy
     doesn't settle them without further argument, it's too vague; sharpen it.
   - Enforced: if nothing makes people follow it (a check, a rule in a file agents read, a
     reviewer lens), it's a wish; add an action or drop it.

   Note where a policy creates leverage: one action that pays off across several projects.
   **Done** when every policy passes both tests, with the replayed decisions recorded.
8. **Write the file.** Save `.seatworks/records/strategy/CONCERN.md` from the template, with the
   status `draft`, the inputs, and a review date about two months out. Nothing fires on that
   date by itself; the retrospective skill's weekly review lists strategies past it.
   **Done** when the file is saved with a review date.
9. **Get the Human's approval** of the diagnosis, the policies, the open list, and the tests.
   **Done** when the Human approves and you have set the status to `approved DATE`.
10. **Relay the parts that bind Leads.** Write each affected project an `OWNER DIRECTIVE:` with
    its policies and actions, stated as constraints, and send it as in the portfolio-review
    skill's "Map a seam between projects": to this project's Lead, or to another project's
    Supervisor. Prompt or skill changes go through the protocol-patch skill. **Done** when
    every action has a directive, a patch proposal, or an owner who has confirmed it.
11. **Review at the review date.** Check the decisions made since: were the policies applied,
    the actions done, and did the diagnosis hold? Update the strategy or retire policies that
    settled nothing, and set the next review within a year. **Done** when the file shows the
    review's findings and a new date.

The rule that matters most: every policy comes from decisions the projects actually made, and
every policy has an action that enforces it.
