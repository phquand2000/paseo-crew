---
name: intent-interview
description: "Turns a Human request into a settled owner directive by numbered questions with recommended answers: outcome, appetite, no-gos, success check, reserved decisions. Use when the Human brings new work or changes an outcome, live or by questionnaire."
---

# Intent interview

Use this skill to turn the request given with this skill into an owner directive, filled in from
[references/directive-template.md](references/directive-template.md), that a Lead can act on
without coming back to the Human. Paths in this skill are relative to this skill's directory,
except paths starting with `.seatworks/`, which are relative to the repository root.

## Before the first question

1. **Look up the facts yourself.** Facts are your job and decisions are the Human's, so ask the
   Human only for what they alone can decide. Read the target repository's `AGENTS.md` and
   `.seatworks/WORKSPACE_PROTOCOL.md`, run `git -C REPO log --oneline -20`, and read any notebook
   entries and earlier directives for this project. If the Human already worked the problem
   through, with you or elsewhere, take its settled points as answers and the options it
   rejected as no-gos, each with its reason, and keep the open parts as questions. **Done** when
   every fact the interview needs is either known or listed as an open fact.
2. **Hand a slow fact to a Peer.** If an open fact needs more than a few reads, hand it to a
   read-only Peer and keep interviewing on the questions that don't depend on it. Create it with
   `create_agent` from the read-only Peer profile (`<slug>-peer-ro` in `list_profiles`), passing
   the provider/model and settings the profile lists. Pass as `initialPrompt` a brief from
   `.seatworks/skills/lead/decompose/references/brief-template.md`, with disposition Scout and
   owned scope `none`, leaving out Paseo, seats, and the Supervisor, because a Peer knows only
   the Lead that assigns its work. Run `git -C REPO status --porcelain` before and after: the
   profile blocks file edits, not every shell write. **Done** when the handoff has arrived, the
   repository is unchanged, and you have archived the Peer with `archive_agent`.
3. **Choose the mode.** If the Human is here, interview live. If the Human is away, or asks to
   answer later, go to Async mode. **Done** when the mode is chosen.

## Live interview

1. **Get the problem story.** Ask about the most recent real occurrence: when it last happened,
   who was affected, what they did about it, and what it cost. Ask "the last time this happened"
   rather than "would you want", because hypotheticals get optimistic, polite answers. **Done**
   when the story names a concrete episode with a date or a cost, or the Human says there is
   none yet (new work).
2. **Separate the outcome from any pre-chosen solution.** When the request names a solution
   ("add a cache", "rewrite in Go"), ask what it would give the Human once it works, and record
   that as the outcome. Keep the solution only as a constraint, and only if the Human says it's
   fixed and why, because a solution written into the directive takes framing away from the Lead
   and its Peers. **Done** when the outcome describes an observable change without naming an
   implementation, or the Human has fixed the solution and stated the reason.
3. **Map the open decisions as a tree.** List every decision the directive depends on, and note
   which depend on others. The frontier is every decision whose prerequisites are settled. The
   tree always contains appetite, no-gos, known hard parts, the success check, the reserved
   decisions, and what the Lead does when the design settles. **Done** when every field of the
   template maps to a node, or is already filled.
4. **Ask the whole frontier in one round.** Number the questions, give your recommended answer
   with each, and add a one-line reason. A question that depends on another question in the same
   round waits for the next round. Use this format:

   ```text
   Q1. TITLE: the question, with the options if there are any
   Recommended: ANSWER, because REASON
   ```

   **Done** when the Human has answered or accepted every question in the round. Then recompute
   the frontier and ask the next round.
5. **Read the directive back.** Fill in the template, show the Human all of it, and mark each
   field that holds your recommendation rather than the Human's words. **Done** when the Human
   confirms it, and every field holds content or a "none" that the Human said.

Stop asking once every field is filled and the Human has confirmed the readback. Questions after
that point are yours to look up or the Lead's to settle.

### What each field needs

- **Appetite:** ask what the outcome is worth, meaning the time or cost the Human will spend
  before stopping or rethinking, not how long the work will take. A budget lets the Lead cut
  scope to fit; an estimate lets scope grow to fill it.
- **No-gos:** what is explicitly out, even where it looks cheap to include. Without them, a Lead
  widens scope in good faith.
- **Known hard parts:** traps the Human already suspects. Name them so the Lead looks at them
  early; leave solving them to the Lead.
- **Reversibility:** mark each decision reversible or irreversible. Irreversible means expensive
  or impossible to undo: deleting data, changing a public API or a contract other projects
  consume, migrations, spending money, external commitments, and anything that leaves this
  machine. Reversible decisions go to the Lead. Irreversible ones are reserved for the Human,
  each with the point at which the Lead comes back. Heavy process on reversible decisions only
  slows the Lead; light process on irreversible ones produces outcomes the Human can't undo.
- **Success check:** something a person can run or observe: a command and its expected output, a
  metric with a threshold, or a named screen someone looks at. "It works well" is not a check.

## Async mode

1. Write a questionnaire to `.seatworks/records/questionnaires/YYYY-MM-DD-SLUG.md`, using
   [references/questionnaire-template.md](references/questionnaire-template.md). Put the question
   whose answer changes the most other answers first, because the Human may answer only the
   first few. Ask one idea per question, give your recommended answer, and leave an empty answer
   stub. **Done** when every frontier question and every empty template field has a question in
   the file.
2. Give the Human the file's path in one line.
3. When the Human has answered, read the file, fold in the answers, and continue with live rounds
   for whatever is left. An unanswered question stays unsettled, and unsettled questions don't go
   to a Lead. **Done** when every field is filled and the Human has confirmed the readback.

## Sending the directive

1. If the directive carries material risk, as defined in the pre-mortem skill, run the pre-mortem
   first and add its risk register. **Done** when the register is attached, or you have noted why
   there is no material risk.
2. Save the directive to `.seatworks/records/directives/YYYY-MM-DD-SLUG.md`, because a
   retrospective later needs the exact text the Lead received and the Lead's transcript goes away
   when the Lead is archived. **Done** when the file exists.
3. Send it. Re-read the agent IDs with `list_agents` first.
   - If the project has no Lead, create one with `create_agent` in the project's workspace from
     the Lead profile (`<slug>-lead` in `list_profiles`), passing the provider/model, `modeId`,
     and `thinkingOptionId` the profile lists. The directive is its first prompt.
   - If the project has a Lead, send the directive with `send_agent_prompt`.

   The text starts with `OWNER DIRECTIVE:`. Then give the watcher every active Lead ID, per step
   2 of "Keep a watcher running" in the `attention-watch` skill. **Done** when
   `get_agent_activity` shows that the Lead received it and a watcher is running.
4. If the Lead points out an ownership collision or an irreversible risk, take it to the Human
   and send the decision as a follow-up `OWNER DIRECTIVE:`. **Done** when every point the Lead
   raised has an answer.

The rule that matters most: a Lead receives only what the Human has settled, and your own
recommendations reach it only after the Human has accepted them.
