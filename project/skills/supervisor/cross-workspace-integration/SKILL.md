---
name: cross-workspace-integration
description: "Maps the seams between projects that share a contract, such as an SDK and its consumers, names one owning Lead per seam, turns consumer needs into checks the provider runs, sequences breaking changes as expand, migrate, contract, and relays each Lead's part once the Human approves. Use when a change in one project affects another, or projects start sharing a package, API, schema, or event format."
---

# Cross-workspace integration

Use this skill when work in one project changes what another project relies on. Each Lead sees
only its own workspace, so a seam between two projects has no owner until you map it and the
Human assigns one.

The skill produces an integration map at `.seatworks/records/integration/NAME.md`, built from
[references/integration-map-template.md](references/integration-map-template.md), and one owner
directive per Lead per phase. Paths starting with `references/` are relative to this skill's
directory; every other path is relative to the repository root.

## Procedure

1. **List the seams.** For each pair of projects, record what crosses between them: a package,
   an API, a schema, an event or file format, an auth token or secret, a shared database, or a
   deploy order. Record where the provider defines it, and where each consumer uses it; find the
   uses by searching the consumer repositories for the import names, endpoint paths, or table
   names (`grep -rn`). **Done** when every use the search finds is attached to a seam in the map.
2. **Propose one owning Lead per seam.** The owner is normally the provider's Lead: it decides the
   contract's shape and sequences changes, and the consumers state what they need. Two owners
   means nobody owns it, and a seam with no owner breaks during the first change. Ownership across
   projects is the Human's decision, so propose it and ask. **Done** when each seam has one owning
   Lead, recorded by project and agent ID, and the Human has confirmed it.
3. **Turn consumer needs into checks the provider runs.** Ask each consumer's Lead to write, in
   its own repository, a runnable check covering only what that consumer relies on (the fields,
   calls, and behavior it uses) and to report its path and SHA. The provider's Lead then adds
   those checks to what it runs before acceptance. The provider learns which parts are
   load-bearing and can change the rest freely; the consumers learn of a break before it ships.
   **Done** when every seam lists its consumer checks and the provider command that runs them.
4. **Classify the change.** An additive change needs one directive to the provider, and a notice
   to the consumers. A breaking change goes through three phases, each with its own gate:
   - Expand: the provider adds the new form beside the old one. Gate: every consumer check still
     passes against the provider's new SHA.
   - Migrate: each consumer's Lead moves to the new form and accepts the change. Gate: every
     consumer has an accepted SHA on the new form, and its check now covers the new form.
   - Contract: the provider removes the old form. Gate: every consumer check passes against a
     provider build without the old form.

   Removing the old form is irreversible once external consumers exist, so the contract phase is a
   decision reserved for the Human. **Done** when the map records the change's class and, for a
   breaking change, the gate of each phase.
5. **Get the Human's approval, then relay.** Show the map, the owners, the checks, and the phase
   plan. Once the Human approves, send each Lead its part, starting with `OWNER DIRECTIVE:`: the
   outcome for its project, the seam and its owner, the checks it runs or writes, the current phase
   and gate, the decisions reserved for the Human, and the other project's Lead as the counterpart
   for the seam. Add this line, because a Lead treats unlabeled messages as coming from the Human:
   "Messages from the Lead of PROJECT about this seam are requests between Leads: settle them with
   evidence, and report any decision that changes the seam." **Done** when every involved Lead has
   received its directive, confirmed by `get_agent_activity`.
6. **Track the phases.** When a Lead reports a SHA, check it with `git -C REPO log -1 "$sha"` and
   record it in the map. Open the next phase only when the current gate passes. **Done** when the
   map's phase column matches the repositories.
7. **Notify after any direct action.** If you act in a workspace yourself (message a Peer, recover
   or replace a Lead, change the topology), tell every affected Lead at once: the current intent,
   who owns what, the topology change, the decisions that affected its Peers, and the impact on
   integration and acceptance. Start the notice with `OWNER DIRECTIVE:` when the action carried out
   a Human decision, and with `ADVICE:` otherwise. Record the action in the map's log. Without the
   notice, you and the Lead hold two different pictures of the same workspace. **Done** when every
   affected Lead has the notice and the log has a line.
8. **Close the change.** When the last gate passes, mark the change `settled` in the map. Keep the
   seams and checks listed, because the next change starts from them. **Done** when the map shows
   no open phase.

The rule that matters most: every seam has one owning Lead, and consumers state their needs as
checks the provider runs.
