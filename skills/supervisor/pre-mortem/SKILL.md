---
name: pre-mortem
description: "Runs a sealed pre-mortem on a plan or directive: two or three read-only Peers assume it failed by a stated date and explain why, and their reasons are merged round-robin into a risk register sorted by reversibility and damage, each risk with a mitigation, a tripwire, or a reserved Human decision. Use when a directive or plan carries material risk, or the Human asks what could go wrong."
---

# Pre-mortem

Use this skill to find how a plan fails before a Lead commits to it, and to attach the result to
the directive as a risk register. Imagining that the plan has already failed makes people, and
models, name causes they would hold back when asked "what could go wrong?".

The skill produces a risk register built from
[references/risk-register.md](references/risk-register.md). It goes under Risks in the
directive, and in the directive's copy under `records/directives/` in the kit. Paths to `references/`
are relative to this skill's directory; the other paths are relative to the kit.

## When it applies

Run it when the plan has material risk, meaning it touches any of these:

- authentication, authorization, secrets, or personal data;
- deleting, migrating, or retaining data;
- money, credentials, or external side effects that aren't safe to repeat (email, payments,
  publishing, deploying);
- a public contract that other projects or users consume;
- concurrency, lifecycle, or which component owns runtime state.

Run it also when the Human asks. Skip it for small plans that git can revert, because there the
pre-mortem costs more than the risk.

## Procedure

1. **Freeze the plan and set the horizon.** The plan is either the directive draft or a Lead's
   plan, referenced by path and SHA. The horizon is the date when failure would be visible: the
   end of the appetite, plus the time failure takes to show (for example, a month after
   release). **Done** when you have one fixed plan text and one horizon date.
2. **Choose the seats.** Use two seats for moderate risk, and three when the plan contains an
   irreversible decision. Run `list_models` for `pi-peer`, and use models from different
   families when they're available: seats from one family share blind spots, so their agreement
   is weak evidence. **Done** when each seat has a model.
3. **Write one brief for every seat.** Fill in [references/peer-brief.md](references/peer-brief.md).
   Every seat gets the same text, and no seat gets your opinion or another seat's output,
   because a seat that sees another's reasons anchors on them. Check the brief before sending
   it: it implies no preferred answer; it doesn't mention Paseo, seats, or the Supervisor; and
   its repository root and workspace match where the Peer will run. **Done** when all three
   checks pass.
4. **Create the seats.** Record the repository state first with
   `git -C REPO status --porcelain` and `git -C REPO rev-parse HEAD`. Then, for each seat, call
   `create_agent` with `provider: "pi-peer/<model>"`, `settings.thinkingOptionId: "high"`, no
   `settings.modeId`, and the brief as `initialPrompt`. Run each seat in the project's workspace,
   or in the kit's workspace when the plan has no repository yet. Wait for the finish
   notifications instead of polling. **Done** when every seat has finished. If a seat fails for
   infrastructure reasons, retry it once with the same brief.
5. **Collect the handoffs and check that the seats stayed read-only.** Read each handoff with
   `get_agent_activity`. Then rerun the two git commands from step 4. The Peer prompt only asks
   for read-only work; nothing enforces it. A seat that changed the repository has a compromised
   report: set it aside, and record the episode in the notebook. Archive every seat with
   `archive_agent`. **Done** when you hold every valid reason list and `list_agents` shows none of
   the seats.
6. **Merge the reasons round-robin.** Take reason 1 from each seat, then reason 2 from each, and
   so on, so that the first seat's list doesn't set the agenda. Merge duplicates into one row and
   note how many seats raised the reason. The count isn't a vote: a reason one seat raised with a
   concrete mechanism stays in. **Done** when every reason from every seat is either a row or
   merged into one, with no reason dropped.
7. **Sort the register.** Put irreversible failures first, then order by damage (who is hurt,
   and how badly), then by likelihood. **Done** when the order is irreversible and high-damage
   first.
8. **Give each risk one response.** Choose exactly one:
   - Mitigation: a constraint or outcome the Lead can take on. State it as a constraint rather
     than an implementation, because the Lead still owns the framing.
   - Tripwire: an observable signal, with a threshold and whoever watches it. For example: "more
     than 1% failed calls in the 10 minutes after deploy: stop the rollout". A tripwire turns a
     vague worry into a check someone can run.
   - Reserved decision: an irreversible choice that goes to the Human, added to the directive's
     reserved list.

   A risk nobody wants to answer goes to the Human, to be accepted in writing or given a
   response. **Done** when every row has a response, and every tripwire has a watcher and a
   threshold.
9. **Review the register with the Human.** Show the irreversible risks and the high-damage ones,
   together with your proposed responses. **Done** when the Human has accepted or changed each of
   them.
10. **Attach the register.** Add it to the directive under Risks, and update the saved copy
    under `records/directives/`. Label the reasons as inference: they come from seats that imagined a
    failure, not from observation. Leave out seat identities and models, because the Lead needs
    the risks, not their source. **Done** when the directive with its register has been sent, as
    in the intent-interview skill.

The rule that matters most: keep the seats sealed from each other and from your view, so that
each list is a separate judgment.
