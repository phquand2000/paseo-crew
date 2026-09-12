---
name: decompose
description: "Turns an outcome into owned slices and Peer briefs: walking skeleton first, vertical slices sized to one Peer, a dependency graph, a Progress ledger, a fix-round cap. Use after intake when work needs several Peers or sessions, or a fix loop."
---

# Decompose

Use this skill to turn one outcome into slices that each fit one Peer, each with an owner, a
brief, and a place in a dependency graph, and to run them to acceptance without losing track.

It produces the slice table and Progress ledger in the ExecPlan
(`docs/exec-plans/active/SLUG.md`), one brief per slice from `references/brief-template.md`
(relative to this skill's directory), and the Peers created from those briefs.

Before you start, have the intake result, the ExecPlan if intake opened one, the decide-first
seams in `AGENTS.md`, and the writer limit and spawn recipes in
`.seatworks/WORKSPACE_PROTOCOL.md`. If a few reads show the whole outcome fits one slice, skip
the graph and brief one Engineer; the integration skill still merges it.

## Procedure

1. **Find the core complexity and the leverage points.** Name what makes the outcome hard (often
   a new integration, a data model, or a preference only the Human can state), and list the
   leverage points it touches: interfaces other slices consume, stateful systems, data models,
   and the decide-first seams in `AGENTS.md`. Mark each decided, citing the ADR or plan line, or
   open, and settle an open one before any slice crosses it: yourself from a few reads, with an
   Architect Peer, with the council skill, or with the Human for a product call. A Peer that
   meets an unsettled boundary either stops with `BLOCKED` or invents the contract, and later
   slices build on the guess. Done when no open leverage point sits inside an Engineer's slice.

2. **Cut a walking skeleton first.** Make slice S1 the thinnest end-to-end path through every
   layer the outcome needs, running under the acceptance command even if its behavior is
   trivial; it fixes the interfaces other slices plug into and surfaces integration problems
   while they are cheap. A prefactoring slice that makes the change easy may come before it.
   Done when S1's acceptance names a command that exercises the whole path.

3. **Slice the rest vertically.** Each slice adds behavior a caller or user can observe, through
   all the layers it needs, and can be verified on its own. Try these splits, roughly in order:

   - by workflow step: the simple start-to-end path first, middle steps and special cases later;
   - by operation: create, read, update, and delete as separate slices;
   - by rule or data variation: one business rule or kind of data per slice, simplest first;
   - by interface: a plain interface first, a richer one later;
   - simple before complex: each edge case becomes its own slice;
   - correctness before performance: make it work, then make it fast;
   - a spike for an unknown: a time-boxed, read-only slice (Scout or Architect, one Peer
     session) whose acceptance is the list of questions it must answer; slice again once
     they're answered.

   Prefer the split that exposes low-value work you can defer or drop, then the one that gives
   slices of similar size. Fold setup, configuration, and docs into the slice whose deliverable
   needs them, and split only where you could reject one part while accepting the other. Done
   when every slice has an observable outcome and a check.

4. **Size each slice to one Peer context.** Keep a slice's peak context under about 120K tokens.
   Split a slice that touches more than about eight files, needs more than three acceptance
   criteria, spans independent subsystems, or needs an "and" in its name. Merge small edits of
   the same shape (one fix repeated across files) into one slice rather than one Peer each.
   Done when every slice passes these checks, or has a written reason why it can't.

5. **Draw the dependency graph.** For each slice, list the slices whose interfaces it consumes or
   whose state it needs. The frontier is every slice whose dependencies are accepted. Two
   frontier slices run in parallel only when their owned scopes share no file and neither
   consumes an interface the other is still producing. Check each pair of scopes; this prints
   the shared files, and nothing when they are disjoint:

   ```bash
   comm -12 <(git ls-files -- 'GLOB_A' | sort) <(git ls-files -- 'GLOB_B' | sort)
   ```

   Keep migrations and changes to shared state sequential, put a shared API contract into the
   skeleton or a decide-first slice before its consumers start, and run no more parallel
   writers than the protocol allows. Done when the slice table's "Depends on" column is filled
   for every slice.

6. **Scale the Peer count to the work.** Staff by slices, not by a role template: one Engineer
   per slice, disjoint frontier slices get one each up to the writer limit, and the rest wait
   for the next wave. Add an Architect only where a leverage point is open, and Reviewers only
   through the review-orchestration skill. A Peer starts cold, so it pays off only when its
   slice needs its own context and doesn't depend on a slice in flight. Done when every
   frontier slice has exactly one owner.

7. **Write one brief per slice** from the template; its Interfaces, Global constraints, and
   Open questions fields carry their own rules there. Done when every field has a value or
   `none`, and no Interfaces entry names something that no slice or existing code produces.

8. **Keep the ledger.** Fill in the ExecPlan's slice table, and add a Progress line for each
   event in the same turn it happens: briefed, handoff received, fix round, reopen, ruling,
   accepted, in the formats of the intake skill's ExecPlan template. After a compaction, trust
   Progress, `git log`, and `list_agents` over your memory, and never re-brief a slice Progress
   shows as accepted. Done when Progress matches the live state.

9. **Launch the frontier.** For each parallel writer, create its worktree workspace first:

   ```text
   create_workspace
     isolation:    "worktree"
     path:         REPO_ROOT
     mode:         "branch-off"
     baseBranch:   BASE
     branchName:   "task/SLUG-S2"
     worktreeSlug: "SLUG-S2"
     title:        "SLUG S2"
   ```

   Then create the Peer from the profile for its disposition (`list_profiles`): an Engineer
   from the Peer profile (`peer`), an Architect or Scout from the read-only Peer profile
   (`peer-ro`). Pass a writer the new workspace's ID, and name its directory in the brief's
   Workspace field:

   ```text
   create_agent
     title:         "S2 Engineer: invoice CSV serializer"
     provider:      "peer/PEER_MODEL"
     settings:      { modeId: "PEER_MODE_ID", thinkingOptionId: "medium" }
     workspaceId:   WORKSPACE_ID
     labels:        { plan: "SLUG", task: "S2", disposition: "engineer", round: "0" }
     initialPrompt: THE_BRIEF
   ```

   Copy `PEER_MODEL` and `PEER_MODE_ID` from what `list_profiles` shows for that profile, spelled
   exactly as it shows them: the profile guard refuses a launch whose model or mode differs from
   its profile, and an omitted `modeId` counts as differing. A profile that lists no `modeId`
   belongs to a harness with no modes, so pass none there.

   Leave out `workspaceId` for a Peer that works in your checkout (a single writer, or
   read-only work). `title` is required, at most 60 characters. Leave `notifyOnFinish` at its
   default, so the Peer's completion reaches you. The labels let `list_agents` map agents back
   to slices after a compaction. Confirm each Peer started, then wait for its notification.
   Done when every frontier slice has a running Peer and a Progress line.

10. **Accept or loop.** When a handoff arrives, run your acceptance checklist, and the
    review-orchestration skill where a review applies. On acceptance, record
    `S2: accepted at SHA`, archive the Peer, and move the frontier forward. Otherwise read
    `references/fix-rounds.md`, which holds the fix-round cap and the answers to
    `REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, and `BLOCKED`, and follow it. Done when every slice
    is accepted or dropped with a ruling; then load the integration skill before anything merges
    into the base branch.

The rule that matters most: one writer per scope, and the ledger, not your memory, says what
is done.
