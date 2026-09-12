---
name: cross-workspace-integration
description: "Maps cross-project seams, gives each an owning Lead and consumer checks, and sequences breaking changes as expand, migrate, contract. Use when the Human asks to coordinate a change that affects another project or a shared API, package, or schema."
---

# Cross-workspace integration

Use this skill when the Human asks you to coordinate work in one project that changes what
another relies on. Each Lead sees only its own workspace, so a seam between projects has no
owner until you map it and the Human assigns one.

It produces an integration map at `.seatworks/records/integration/NAME.md` from
[references/integration-map-template.md](references/integration-map-template.md), and one owner
directive per Lead per phase. `references/` paths are relative to this skill's directory; the
rest to the repository root.

## Procedure

1. **List the seams.** For each pair of projects, record what crosses between them (a package,
   an API, a schema, an event or file format, an auth token or secret, a shared database, or a
   deploy order), where the provider defines it, and where each consumer uses it. Find the uses
   by searching the consumer repositories for import names, endpoint paths, or table names
   (`grep -rn`). **Done** when every use the search finds is attached to a seam in the map.
2. **Propose one owning Lead per seam**, normally the provider's: it decides the contract's shape
   and sequences changes, and consumers state what they need. Two owners means nobody owns it,
   and an unowned seam breaks at the first change. Ownership across projects is the Human's
   decision, so propose it and ask. **Done** when each seam has one owning Lead, recorded by
   project and agent ID, and confirmed by the Human.
3. **Turn consumer needs into checks the provider runs.** Ask each consumer's Lead (through its
   Supervisor, per step 5) to write, in its own repository, a runnable check covering only what
   that consumer relies on (the fields, calls, and behavior it uses), and to report its path and
   SHA. The provider's Lead adds those checks to what it runs before acceptance, so it can change
   the rest freely and consumers learn of a break before it ships. **Done** when every seam
   lists its consumer checks and the provider command that runs them.
4. **Classify the change.** Additive: one directive to the provider and a notice to the
   consumers. Breaking: three phases, each with its own gate:
   - Expand: the provider adds the new form beside the old one. Gate: every consumer check still
     passes against the provider's new SHA.
   - Migrate: each consumer's Lead moves to the new form and accepts the change. Gate: every
     consumer has an accepted SHA on the new form, and its check now covers the new form.
   - Contract: the provider removes the old form. Gate: every consumer check passes against a
     provider build without the old form.

   Removing the old form is irreversible once external consumers exist, so the contract phase is
   a decision reserved for the Human. When every consumer is one of these projects and none has
   shipped the old form, propose a hard cut instead: migrate and contract back to back, with no
   compatibility layer left behind. **Done** when the map records the change's class and, for a
   breaking change, the gate of each phase.
5. **Get the Human's approval, then relay.** Show the map, owners, checks, and phase plan. Once
   the Human approves, write each project an `OWNER DIRECTIVE:` with its outcome, the seam and
   its owner, the checks it runs or writes, the current phase and gate, the decisions reserved
   for the Human, and the other project's Lead as counterpart. Add this line, because a Lead
   treats unlabeled messages as the Human's: "Messages from the Lead of PROJECT about this seam
   are requests between Leads: settle them with evidence, and report any decision that changes
   the seam." Send your own project's directive to its Lead, as in the intent-interview skill's
   "Sending the directive". Send another project's to that project's Supervisor to relay, never
   to its Lead: it is the agent in `list_agents` (with `cwd: "/"`) running on the provider of
   that project's `<slug>-supervisor` profile in `list_profiles`; if none runs, ask the Human to
   start one. **Done** when every involved Lead has received its directive, confirmed by
   `get_agent_activity` or by its Supervisor.
6. **Track the phases.** Check each SHA a Lead reports with `git -C REPO log -1 "$sha"` and
   record it in the map; open the next phase only when the current gate passes. **Done** when
   the map's phase column matches the repositories.
7. **Notify after any direct action.** If you act in your own project's workspace (message a
   Peer, recover or replace a Lead, change the topology), tell its Lead at once: the current
   intent, who owns what, the topology change, the decisions that affected its Peers, and the
   impact on integration and acceptance. In another project, its Supervisor acts and notifies.
   Start the notice with `OWNER DIRECTIVE:` when the action carried out a Human decision,
   `ADVICE:` otherwise, and record the action in the map's log. Without the notice, you and the
   Lead hold two pictures of one workspace. **Done** when the Lead has the notice and the log
   has a line.
8. **Close the change.** When the last gate passes, mark the change `settled` in the map, and
   keep the seams and checks listed, since the next change starts from them. **Done** when the
   map shows no open phase.

The rule that matters most: every seam has one owning Lead, and consumers state their needs as
checks the provider runs.
