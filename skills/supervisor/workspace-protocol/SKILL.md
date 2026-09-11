---
name: workspace-protocol
description: "Interviews the Human and drafts a repository's WORKSPACE_PROTOCOL.md, plus AGENTS.md and a one-line CLAUDE.md when they are missing, from the kit templates. Strictness comes from evidence about users, data, and reversibility, and every mandatory rule has a reason and a removal trigger. Use when the Human asks for a workspace protocol, or when a Lead runs a repository on defaults that don't fit it."
---

# Workspace protocol

Use this skill to draft how one repository is coordinated and to hand the approved files to its
Lead. You draft in the kit, and the Lead commits in the repository, because you don't write into
project repositories.

The skill produces drafts under `records/drafts/REPO_NAME/` in the kit (`WORKSPACE_PROTOCOL.md`, plus
`AGENTS.md` and `CLAUDE.md` when the repository lacks them), and then an owner directive that
hands them to the Lead. Once the Lead's commit lands, you delete the drafts, so that the
repository holds the only copy.

Prerequisites: the repository path, and the kit templates `examples/WORKSPACE_PROTOCOL.md` and
`examples/AGENTS_MD_SNIPPET.md`. All paths in this skill are relative to the kit.

## Procedure

1. **Read the repository before asking.** Find out whether `AGENTS.md`, `CLAUDE.md`, and
   `WORKSPACE_PROTOCOL.md` exist, and whether `CLAUDE.md` imports `AGENTS.md`. Take the test and
   build commands from the package manifest, the Makefile, or the CI config. Note the deploy,
   publish, and migration paths, and look in `git -C REPO log --oneline -200` for reverts and
   hotfixes. Read the notebook entries that name this repository. **Done** when you have a fact
   sheet that marks each template placeholder as known or unknown.
2. **Collect evidence for the strictness level.** Answer three questions from the fact sheet, and
   ask the Human only for what you couldn't find:
   - Users: who is hurt when a bug ships? Only the Human, a team, or external users?
   - Data: does the code touch production data, personal data, money, or credentials?
   - Reversibility: does reverting a commit undo every change, or are there migrations, published
     packages, public APIs, or deploys that others depend on?

   Recommend `loose` when only the Human is affected and git undoes every change, `strict` when
   there are external users or irreversible data paths, and `standard` otherwise. Strictness costs
   Lead time on every task, so match it to the damage a mistake can do. **Done** when the
   recommended level and its evidence are written in `records/drafts/REPO_NAME/NOTES.md`.
3. **Interview the Human about the unknowns.** Ask in rounds: every question you can ask now, each
   numbered and with a recommended answer, as in the intent-interview skill. Build the questions
   from the placeholders that are still unknown. For the Peer model, run `list_models` for
   `pi-peer` and recommend one. The protocol has to name it, because `pi-peer` offers every model
   the Pi login reaches. When the Human proposes a rule, ask for the episode it would have
   prevented. A rule without an episode is ceremony, and ceremony only ever tightens. **Done**
   when every placeholder you keep has an answer.
4. **Draft `WORKSPACE_PROTOCOL.md`.** Copy the template block, fill in the placeholders, and
   delete every section whose content matches the Lead's defaults in `claude/LEAD.md`: the Lead
   reads the file on every session, and a repeated default costs tokens and says nothing. Give
   each mandatory rule a `Reason:` line (a dated, reproducible episode) and a `Remove when:` line
   (the evidence that would retire it). **Done** when all of these checks pass:

   ```sh
   grep -c 'Reason:' records/drafts/REPO_NAME/WORKSPACE_PROTOCOL.md
   grep -c 'Remove when:' records/drafts/REPO_NAME/WORKSPACE_PROTOCOL.md
   grep -nE '\b[A-Z]{2,}(_[A-Z]+)+\b' records/drafts/REPO_NAME/WORKSPACE_PROTOCOL.md
   grep -n 'pi-peer/' records/drafts/REPO_NAME/WORKSPACE_PROTOCOL.md
   ```

   The first two counts equal the number of mandatory rules, the third prints no leftover
   placeholder, and the fourth shows the spawn recipe with a real model.
5. **Draft `AGENTS.md` and `CLAUDE.md` if they're missing.** Fill in `AGENTS.md` from the
   snippet, by the same rules as step 4. `CLAUDE.md` is the one-line import shown in
   `examples/AGENTS_MD_SNIPPET.md`; without it, the Lead reads nothing and the Peer reads
   `AGENTS.md`, so the two follow different rules. If `AGENTS.md` already exists, leave it as it
   is, and list the additions you propose for the Lead to consider in the directive. **Done**
   when every file the repository lacks has a draft.
6. **Split the content between the files.** For each line, ask whether a Peer would make a
   mistake without it. If it would, the line goes in `AGENTS.md`; if only the Lead needs it, it
   goes in `WORKSPACE_PROTOCOL.md`. A line that belongs in both goes in `AGENTS.md`. Peers don't
   read the protocol, and coordination detail in `AGENTS.md` distracts them on every turn.
   **Done** when no technical constraint remains only in the protocol.
7. **Get the Human's approval.** Show the drafts, the strictness evidence from `NOTES.md`, and
   the rules you dropped for lack of an episode. **Done** when the Human approves, or has asked
   for changes that you applied and the Human approved.
8. **Hand the files to the Lead.** Re-read the agent IDs with `list_agents`, then send the
   directive below with `send_agent_prompt`. If the project has no Lead, create one on
   `claude-lead` with `settings.modeId: "bypassPermissions"` and a `thinkingOptionId`, and make
   this directive its first prompt. **Done** when the Lead confirms that it received the files.

   ```text
   OWNER DIRECTIVE: Adopt a workspace protocol for this repository.

   Outcome: the files below are committed at the repository root with the content shown, and
   you coordinate by them from now on.
   Files: FILE_LIST (absolute paths to copy from)
   Constraints: commit them as they are. If a rule conflicts with the repository's current
   state, say which rule and why before you commit, rather than editing it.
   Reserved for the Human: any change to the rules in these files.
   After committing: read WORKSPACE_PROTOCOL.md again now, because you read it at session start.
   ```

   Replace `FILE_LIST` with the absolute paths of the drafts in the kit.
9. **Verify the commit and remove the drafts.** Run:

   ```sh
   sha=$(git -C REPO log -1 --format=%H -- WORKSPACE_PROTOCOL.md)
   git -C REPO show "$sha":WORKSPACE_PROTOCOL.md | diff - records/drafts/REPO_NAME/WORKSPACE_PROTOCOL.md
   ```

   Run the same `diff` for each other file you drafted. **Done** when `$sha` is not empty, every
   `diff` prints nothing (or the Lead explained each difference and the Human accepted it), and
   you have deleted `records/drafts/REPO_NAME/`.

If the Lead raises a conflict in step 8, take it to the Human, update the draft, and repeat from
step 7.

The rule that matters most: keep only what differs from the defaults, and give every mandatory
rule the episode behind it and the evidence that would remove it.
