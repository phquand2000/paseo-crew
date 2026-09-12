---
name: pre-mortem
description: "Runs a sealed pre-mortem: two or three read-only Peers assume a plan failed and say why, merged into a risk register with one response per risk. Use when a directive or plan carries material risk, or the Human asks what could go wrong."
---

# Pre-mortem

Use this skill to find how a plan fails before a Lead commits to it. Told the plan has already
failed, models name causes they hold back when asked "what could go wrong?".

It produces a risk register from [references/risk-register.md](references/risk-register.md),
placed under Risks in the directive and in the directive's copy under
`.seatworks/records/directives/`. `references/` paths are relative to this skill's directory;
the rest to the repository root.

## When it applies

Run it when the Human asks, or when the plan has material risk, touching any of:

- authentication, authorization, secrets, or personal data;
- deleting, migrating, or retaining data;
- money, credentials, or external side effects unsafe to repeat (email, payments, publishing,
  deploying);
- a public contract that other projects or users consume;
- concurrency, lifecycle, or which component owns runtime state.

Skip it for small plans git can revert; there it costs more than the risk.

## Procedure

1. **Freeze the plan and set the horizon.** The plan is the directive draft or a Lead's plan,
   referenced by path and SHA. The horizon is when failure would be visible: the end of the
   appetite plus the time failure takes to show (for example, a month after release). **Done**
   when you have one fixed plan text and one horizon date.
2. **Choose the seats.** Every seat runs on the read-only Peer profile (`<slug>-peer-ro` in
   `list_profiles`), except that one goes to a second read-only Peer profile for this project if
   one runs another model family. Take two seats for moderate risk, and three when the plan
   contains an irreversible decision and two families are available. One family shares blind
   spots, so its agreement is weak evidence: with one family, add `one model family` to the
   register's horizon line. **Done** when each seat has a profile.
3. **Write one brief for every seat** from [references/peer-brief.md](references/peer-brief.md).
   Every seat gets the same text, with neither your opinion nor another seat's output, because a
   seat anchors on reasons it sees. Check that the brief implies no preferred answer, doesn't
   mention Paseo, seats, or the Supervisor, and its repository root and workspace match where
   the Peer will run. **Done** when all three checks pass.
4. **Create the seats.** First record the repository state with
   `git -C REPO status --porcelain` and `git -C REPO rev-parse HEAD`. For each seat, call
   `create_agent` from its profile, passing the provider/model and settings the profile lists
   with `thinkingOptionId: "high"`, and the brief as `initialPrompt`, in the workspace of the
   brief's repository root. Wait for the finish notifications instead of polling; retry a seat
   that fails for infrastructure reasons once, with the same brief. **Done** when every seat has
   finished.
5. **Collect the handoffs and check the seats stayed read-only.** Read each handoff with
   `get_agent_activity`, then rerun the two git commands from step 4. The read-only profile
   blocks file edits and git writes but not every shell write, so a seat that changed the
   repository has a compromised report: set it aside, and record the episode in the notebook.
   Archive every seat with `archive_agent`. **Done** when you hold every valid reason list and
   `list_agents` shows none of the seats.
6. **Merge the reasons round-robin.** Take reason 1 from each seat, then reason 2 from each, and
   so on, so the first list doesn't set the agenda. Merge duplicates into one row, noting how
   many seats raised it. The count isn't a vote: a reason one seat raised with a concrete
   mechanism stays. **Done** when every reason is a row or merged into one, none dropped.
7. **Sort the register.** Irreversible failures first, then by damage (who is hurt, and how
   badly), then by likelihood. **Done** when irreversible and high-damage rows come first.
8. **Give each risk exactly one response:**
   - Mitigation: a constraint or outcome the Lead takes on, stated as a constraint rather than an
     implementation, because the Lead owns the framing.
   - Tripwire: an observable signal with a threshold and whoever watches it, for example "more
     than 1% failed calls in the 10 minutes after deploy: stop the rollout".
   - Reserved decision: an irreversible choice for the Human, added to the directive's reserved
     list.

   A risk nobody wants to answer goes to the Human, to accept in writing or give a response.
   **Done** when every row has a response, and every tripwire a watcher and a threshold.
9. **Review the register with the Human:** the irreversible and high-damage risks, with your
   proposed responses. **Done** when the Human has accepted or changed each of them.
10. **Attach the register** under Risks in the directive and in its saved copy under
    `.seatworks/records/directives/`. Label the reasons as inference from an imagined failure,
    not observation, and leave out seat identities and models; the Lead needs the risks, not
    their source. **Done** when the directive with its register has been sent, as in the
    intent-interview skill.

The rule that matters most: keep the seats sealed from each other and from your view, so that
each list is a separate judgment.
