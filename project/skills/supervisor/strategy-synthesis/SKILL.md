---
name: strategy-synthesis
description: "Writes a bottom-up technical strategy for one concern from about five recent ADRs, design docs, and notebook patterns across projects: a diagnosis, guiding policies, and enforcing actions, each tested for being applicable and enforced, with a review date about two months out. Use when the Human asks for a strategy on a concern, or the same decision keeps being argued across projects."
disable-model-invocation: true
---

# Strategy synthesis

Use this skill to write a strategy for one concern from the decisions the projects have already
made, rather than from first principles. A strategy drawn from real, recent decisions is usually
unsurprising, and that's its value: it writes down tradeoffs that keep coming back so that they
stop being argued each time.

The skill produces `.seatworks/records/strategy/CONCERN.md`, built from
[references/strategy-template.md](references/strategy-template.md), for the Human to approve.
Paths starting with `references/` are relative to this skill's directory; every other path is
relative to the repository root.

## Procedure

1. **Name the concern and its scope.** Take the concern from the request given with this skill,
   for example "data migrations" or "how SDKs are released", and list the projects in scope.
   **Done** when the concern fits in one line and the project list is fixed.
2. **Gather about five inputs.** Collect recent documents in which a real tradeoff on this
   concern was made: ADRs and design docs (for example under `docs/adr/` or `docs/decisions/`),
   the decision logs in ExecPlans, notebook patterns, integration maps, and the reserved decisions
   in `.seatworks/records/directives/`. Prefer recent documents and ones from different projects. If a repository is
   large, give a read-only Peer the search for it, as in the other Supervisor skills: disposition
   Scout, owned scope `none`, and a list of paths with a one-line summary of each decision as the
   result. **Done** when you hold at least three inputs. With fewer than three, stop and tell the
   Human the concern is too new for a strategy, because a strategy generalized from one or two
   decisions is a guess.
3. **Extract the decisions.** For each input, list each decision with the reason the document
   gave. Mark a decision as recurring when two or more inputs made the same choice, and as
   contested when inputs chose differently or the same point was argued more than once. **Done**
   when every input contributes at least one row, and each row is marked recurring, contested, or
   single.
4. **Write the diagnosis.** In a few sentences, explain what about the situation makes these
   decisions come back: the constraints, the forces, and the costs. Cite the rows. A diagnosis is
   a theory of the challenge, not a list of goals. **Done** when each sentence cites at least one
   decision row.
5. **Write the guiding policies.** Cover three questions:
   - Where effort goes: what the projects spend on for this concern, and what they deliberately
     don't.
   - Rules that hold without exception: each with its reason, and who can grant an exception.
   - How undecided cases get decided: who decides, by which criteria, and which cases go to the
     Human because they're irreversible.

   Take a position and show the reasoning. Each policy cites the decisions it generalizes, and
   each contested decision is either resolved by a policy or listed as open for the Human.
   **Done** when every recurring and contested row maps to a policy or to the open list.
6. **Write the enforcing actions.** For each policy, list the concrete actions that make it
   real: a check a Lead adds to acceptance, a rule in a repository's `AGENTS.md` or protocol, a
   change to a seat prompt or skill through the protocol-patch skill, or a lens used in reviews.
   Give each action an owner, a surface, and a check that shows it was done. **Done** when every
   policy has at least one action, or names who is accountable for it.
7. **Test the strategy.** Apply two tests to each policy:
   - Applicable: replay two decisions from the inputs and one question that is open now. Does
     the policy settle them without further argument? A policy that settles nothing is too vague;
     sharpen it.
   - Enforced: does something make people follow it (a check, a rule in a file agents read, a
     reviewer lens)? A policy with no enforcing action is a wish; add an action or drop it.

   Note where a policy creates leverage, meaning one action that pays off across several
   projects. **Done** when every policy passes both tests, with the replayed decisions recorded.
8. **Write the file.** Save `.seatworks/records/strategy/CONCERN.md` from the template, with the status `draft`, the
   inputs, and a review date about two months out. Seats have no scheduler, so the
   date in the file is the reminder; the portfolio-review skill flags strategies past their
   review date. **Done** when the file is saved with a review date.
9. **Get the Human's approval.** Show the diagnosis, the policies, the open list, and the tests.
   **Done** when the Human approves, and you have set the status to `approved DATE`.
10. **Relay the parts that bind Leads.** Send each affected Lead an `OWNER DIRECTIVE:` with the
    policies and actions that apply to its project, stated as constraints. Changes to seat prompts
    or skills go through the protocol-patch skill. **Done** when every action has a directive, a
    patch proposal, or an owner who has confirmed it.
11. **Review at the review date.** Check the decisions made since: were the policies applied,
    were the actions done, and did the diagnosis hold? Update the strategy or retire policies that
    settled nothing, and set the next review within a year. **Done** when the file shows the
    review's findings and a new date.

The rule that matters most: every policy comes from decisions the projects actually made, and
every policy has an action that enforces it.
