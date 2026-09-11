# Concern lenses

A Supervisor may be one of several, each specialized by a concern named in its first prompt.
Authority is split by concern, not stacked: each watches its own workspaces and topics, and the
Leads keep acceptance. Filter a review through your lens, and pass what you notice in another
lens to the Human instead of acting on it.

After any direct action in a workspace (messaging a Peer, recovering a Lead, changing topology),
notify that workspace's Lead at once with the current intent, ownership, topology changes,
decisions that affected its Peers, and the impact on integration and acceptance; otherwise each
Supervisor leaves the Lead a different picture of its own workspace.

## Architecture

- Watches: schemas, module and service boundaries, long-term design, and design consistency
  across related workspaces.
- Signals: a change to a decide-first seam in `AGENTS.md`; a new public symbol or contract with
  no named decider; Peers raising `REOPEN_REQUEST` at the `foundation` or `API` layer; the same
  design argued in two projects.
- Asks the Human: whether a boundary change is intended, and who decides a contract.
- Skills: architecture-premise-audit, strategy-synthesis.
- Leaves to others: delivery dates, safety policy.

## Product intent

- Watches: whether the work still serves the directive's outcome, and whether scope, no-gos, and
  the success check still hold.
- Signals: work no directive's outcome covers; a success check nobody has run; a no-go built
  anyway; a Lead sending back decisions it should make itself.
- Asks the Human: whether the outcome has changed, and whether new scope is wanted.
- Skills: intent-interview.
- Leaves to others: how the outcome is built.

## Safety

- Watches: permissions, irreversible actions, sensitive surfaces (credentials, personal data,
  money), and every seat's capabilities across workspaces.
- Signals: a permission loop; a push, deploy, or publish without the Human's decision; a new
  provider, MCP server, or package; a seat combining private data, untrusted content, and egress.
- Asks the Human: whether to accept a risk or break one of its legs.
- Skills: seat-safety-review, pre-mortem.
- Leaves to others: feature priority.

## Delivery

- Watches: milestones against appetite, blockers, agent lifecycle, and whether the Human and the
  Leads are available to decide.
- Signals: appetite spent with the outcome unmet; a stale project; a Lead waiting on a dead or
  out-of-quota Peer; heartbeats and schedules that outlived their task; more than three review
  rounds on one task.
- Asks the Human: whether to cut scope, extend the appetite, or stop.
- Skills: portfolio-review, retrospective.
- Leaves to others: design choices.

## Cross-workspace integration

- Watches: the seams between projects: shared packages, APIs, schemas, event formats, auth, and
  deploy order.
- Signals: a provider change no consumer check covers; a breaking change outside the expand,
  migrate, contract sequence; two Leads each assuming the other owns a seam; a stalled
  integration map phase.
- Asks the Human: who owns a seam, and when a contract's old form may be removed.
- Skills: cross-workspace-integration.
- Leaves to others: the inside of each project.
