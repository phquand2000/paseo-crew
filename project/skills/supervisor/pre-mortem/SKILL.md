---
name: pre-mortem
description: "Frames a plan as already failed, briefs two or three sealed read-only Peers on it, and merges their reasons into a risk register that gives each risk one mitigation, tripwire, or reserved decision. Use when a directive or plan carries material risk, or the Human asks what could go wrong."
---

# Pre-mortem

Use this skill to find how a plan fails before a Lead commits to it. Told the plan has already
failed, models name causes they hold back when asked "what could go wrong?".

What it adds is the question and the register; the sealed seats are the council mechanism.
Resolve each seat's profile, thinking, and family split from
`.seatworks/skills/lead/council/references/routing.md` instead of a second copy here. The
register comes from
[references/risk-register.md](references/risk-register.md) and goes under Risks in the directive
and in the directive's copy under `.seatworks/records/directives/`. `references/` paths are
relative to this skill's directory; the rest to the repository root.

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
   appetite plus the time failure takes to show, for example a month after release. **Done** when
   you have one fixed plan text and one horizon date.
2. **Route the seats.** Take two seats for moderate risk, and three when the plan holds an
   irreversible decision and routing offers a second model family; routing also says when one
   family makes agreement weak evidence, and then `one model family` goes on the register's
   horizon line. If a Lead is already running a council on this plan, send that Lead the
   pre-mortem question as `ADVICE:` to run as one more seat, and take its answer instead of
   starting your own. **Done** when every seat has a profile and a thinking level, or the council
   has the question.
3. **Write one brief per seat** from [references/peer-brief.md](references/peer-brief.md). Every
   seat gets the same text, with neither your opinion nor another seat's output, because a seat
   anchors on reasons it sees. Check that the brief implies no preferred answer, doesn't mention
   Paseo, seats, or the Supervisor, and that its repository root matches where the Peer will run.
   **Done** when all three checks pass.
4. **Run the seats and collect the reports.** Create each one in the project's workspace with its
   brief as the first prompt, wait for the finish notifications instead of polling, and read each
   handoff with `get_agent_activity`; retry a seat that failed for infrastructure reasons once,
   with the same brief. Your seat prompt holds the rest: the read-only profile, owned scope
   `none`, archiving at handoff. That profile blocks file edits but not every shell write, so
   bracket the run with `git -C REPO status --porcelain` and `rev-parse HEAD`: set aside the
   report of a seat that changed the repository, and record the episode in the notebook. **Done**
   when you hold every valid reason list and `list_agents` shows none of the seats.
5. **Merge the reasons round-robin.** Take reason 1 from each seat, then reason 2 from each, so
   the first list doesn't set the agenda. Merge duplicates into one row, noting how many seats
   raised it; the count isn't a vote, and a reason one seat raised with a concrete mechanism
   stays. **Done** when every reason is a row or merged into one, none dropped.
6. **Sort the register:** irreversible failures first, then by damage (who is hurt, and how
   badly), then by likelihood. **Done** when irreversible and high-damage rows come first.
7. **Give each risk exactly one response:**
   - Mitigation: a constraint or outcome the Lead takes on, stated as a constraint rather than an
     implementation, because the Lead owns the framing.
   - Tripwire: an observable signal with a threshold and whoever watches it, for example "more
     than 1% failed calls in the 10 minutes after deploy: stop the rollout".
   - Reserved decision: an irreversible choice for the Human, added to the directive's reserved
     list.

   A risk nobody wants to answer goes to the Human, to accept in writing or give a response.
   **Done** when every row has a response, and every tripwire a watcher and a threshold.
8. **Review the register with the Human:** the irreversible and high-damage risks, with your
   proposed responses. **Done** when the Human has accepted or changed each of them.
9. **Attach the register** under Risks in the directive and in its saved copy under
   `.seatworks/records/directives/`. Label the reasons as inference from an imagined failure, not
   observation, and leave out seat identities and models; the Lead needs the risks, not their
   source. **Done** when the directive with its register has been sent, as in the intent-interview
   skill.

The rule that matters most: every seat judges the same frozen plan alone, so each list of reasons
is a separate judgment.
