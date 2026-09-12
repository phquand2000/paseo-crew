# Fix rounds and pushback

Read this when a handoff comes back with open findings, or when a Peer answers with
`REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, or `BLOCKED`.

## Fix-round cap

A fix round is one request for fixes plus your check of the result: rerunning the verification,
reading the new diff, or a scoped re-review. Count rounds per slice in Progress, within this cap:

- **Before every round**: ask whether the open findings share one missing mechanism or a wrong
  foundation. If they do, another patch only adds layers: take the reopen route under "After
  round 4" now.
- **Rounds 1 to 3**: send the open findings word for word to the same Peer with
  `send_agent_prompt`, asking for the fix in a new commit so rounds can be compared; its context
  still holds the task and its own choices.
- **Round 4**: a loop that survives three rounds usually means the Peer can't see its own
  problem, so create a fresh Peer one thinking level higher (for example `medium` to `high`).
  Give it the brief, the open findings, the previous handoff saved outside the repository (run
  `echo "${TMPDIR:-/tmp}"` and write `SLUG-S2-handoff-r3.md` under the path it prints), and one
  line: "An earlier attempt went three rounds; read its handoff and its commits up to SHA before
  you start." Set its `round` label to `"4"`, and archive the old Peer once the new one has
  started.
- **After round 4**: stop sending fixes and adjudicate each open finding:
  - wrong or contestable: record a ruling, and accept with the finding listed;
  - real, but nothing depends on it: record a ruling, list it as open, and accept;
  - real and load-bearing, because a later slice builds on it or it exposes a flaw in the plan:
    reopen, by ruling on the smallest change that unblocks the dependent slices or by raising
    the lane and going back to intake's design gate, and pause the dependent slices.

Write each ruling as `S2: ruling F003: DECISION. Reason: REASON. Cost if wrong: COST`, and carry
every ruling into the acceptance summary, where the Human sees it. Adjudicate at the cap, not
before: ruling early to end a loop pre-judges the finding.

## Pushback from Peers

`REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, and `BLOCKED` aren't fix rounds. Answer each with a
concrete ruling in the same turn, record it in Progress, and update the graph:

- `DEPENDENCY_REQUEST`: widen this slice's owned scope if no one else owns the path, or add a
  slice for the other owner and make this one depend on it.
- `REOPEN_REQUEST` on the foundation, API, or ownership layer: pause the dependent slices and
  settle the premise as in step 1 of the skill.
- `BLOCKED`: supply the missing prerequisite, or take the decision to whoever holds it.
