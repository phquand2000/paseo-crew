---
name: review-orchestration
description: "Chooses and runs the review a change needs: your own diff reading by default, sealed Reviewer Peers on separate axes for a material question, or a high-recall sweep of overlapping scout Peers, then adjudicates each finding with a disconfirming check and routes fixes. Use when a slice or branch awaits acceptance and its lane or a review condition calls for more than your own reading."
---

# Review orchestration

Use this skill to give a change the review its risk calls for, and no more, and to turn what
the reviewers report into rulings you can defend.

For the sealed-axes lane it produces a ruling in your acceptance summary. For a sweep it
produces one report at `docs/reviews/DATE-NAME-round-N.md` in the target repository. Either way,
every finding ends with a verdict and a route.

## Choose the lane

| Lane | When | Who reviews |
|---|---|---|
| Read it yourself | the default, for tiny and normal work with no review condition | you, reading the diff: `git diff "$base" "$head"` |
| Sealed axes | a condition under "Independent review" in your seat prompt applies, or intake set Reviewers above zero | two or three Reviewer Peers, one axis each, same SHA and same question |
| Sweep | high-risk work with weak proof, a large or unfamiliar surface, or a pre-merge audit where recall matters more than noise | four to ten scout Peers on overlapping concerns |

The repository's `.seatworks/WORKSPACE_PROTOCOL.md` overrides these counts where it sets strictness or a
review lane count. Done when you have named the lane and the reason.

## Sealed axes

1. **Fix the target and the question.** One commit or range, and one question, identical for
   every Reviewer, for example "Is `SHA` ready to accept as the implementation of the S2
   brief?". Done when both are written into the Reviewer brief.

2. **Give each Reviewer one axis**, so their reports overlap little and their blind spots
   differ:

   - spec conformance: everything the brief and the global constraints ask, and nothing beyond;
   - standards: the rules in `AGENTS.md`, the repository's conventions, and proof that would
     fail if its behavior disappeared;
   - structural: boundaries, ownership, coupling, lifecycle, failure handling, and damage to
     interfaces or data that later work depends on.

   With two Reviewers, use spec conformance and structural. If the protocol adds a lane on a
   different model, give it the same brief; it adds a different set of blind spots, not a vote.
   Give the Open Code Review pass (`Machine pass: run`) to the standards Reviewer, or to the
   structural one when there are two, and `skip` to the others: one run per round is enough.
   Done when each Reviewer has one axis and exactly one runs the machine pass.

3. **Brief and launch.** Create each Reviewer from the project's Reviewer profile
   (`list_profiles`), which is read-only and runs Open Code Review, with the axis Reviewer brief
   in `references/briefs.md` (relative to this skill's directory): disposition Reviewer, thinking
   `high`, the slice brief and handoff as files, and the global constraints word for word. Put every `DECISION: … (ambiguous)` ruling
   the change implements under Rulings to check, as a question, because a Reviewer who isn't
   asked reads the code against your reading and not against the directive's words. Seal each
   Reviewer: no other Reviewer's
   findings, none of your opinions, and no instruction to leave a particular issue unflagged.
   Create each with `create_agent`, labeled `review.name`, `review.round`, and `review.axis`, and
   wait for the notifications. Done when every Reviewer has reported.

4. **Adjudicate and rule.** Adjudicate every finding as described below, then issue one ruling
   that says which findings you accept, which you reject, and why. When two reports conflict on
   a decision point, ask each Reviewer once about that point only, with `send_agent_prompt`, then
   rule; if it stays open and is hard to reverse, take it to the council skill or the Human.

## Sweep

1. **Write the review brief to a file** that survives a restart and stays out of the repository,
   such as `~/.local/state/lead-reviews/REPO/NAME-round-N-brief.md`. It holds the scope (paths
   and commit range), the change intent, the applicable contracts, the prior-round warnings, the
   concerns, and the allocation from step 2. Hash it with `shasum -a 256 FILE`. Done when the
   file exists and you have its hash.

2. **Define and allocate the concerns.** Directives in the request become mandatory concerns
   `D01`, `D02`, and so on. Without directives, derive concerns `G01`, `G02`, and so on from the
   scope, contracts, call paths, lifecycle, data flow, and blast radius. Useful lenses include:
   state-machine and semantic correctness; ownership against lifecycle events; API, schema, and
   data-format contracts; concurrency, ordering, cancellation, cleanup, and resource lifetime;
   error masking, fallbacks, retries, and partial failure; authorization, trust boundaries, and
   hostile input; hot-path cost; generated files, fixtures, snapshots, and docs; proof that would
   pass without its behavior; duplicate state and wrappers that compensate for a broken
   foundation; and alternative end-to-end traces. Choose N from 4 to 10 so that every concern
   goes to at least two scouts and no scout carries more than three concerns. Make the overlap
   real: scouts sharing a concern take different traces, lifecycle phases, owners, hostile
   cases, or disconfirming angles, never copies of one prompt. Name them `scout-01` onwards.
   Done when the allocation table shows at least two scouts per concern.

3. **Brief and launch the scouts.** Use the scout brief in `references/briefs.md`. Create scouts
   from the Reviewer profile with the Reviewer disposition, because the Scout disposition returns
   a map without findings and a sweep needs findings with evidence; set `medium` thinking.
   Scouts run no tests, builds, or package managers, because they share your checkout and the
   test lane, and they skip the Open Code Review pass: add one more Reviewer with the axis
   Reviewer brief and the `machine pass` axis to run it once over the whole scope. Create each with `create_agent`, labeled
   `review.name`, `review.round`, `review.scout`, and `review.concerns`, and wait for the
   notifications. Done when N agent IDs have come back.

4. **Recover from a restart without relaunching.** If your session restarts or compacts, or
   agents stop mid-sweep, the roster in the brief file stays fixed. Call `list_agents` and match
   the `review.*` labels to the logical scouts. Collect the reports of finished scouts with
   `get_agent_activity`. Relaunch only the logical scouts that are missing or failed, with their
   original assignment and the same `review.scout` label; never add a scout beyond the roster or
   rerun one that finished. Archive scouts only after the report is written, because until then
   their reports exist only in their timelines. Done when every logical scout on the roster has
   exactly one report.

5. **Create the report**, once, after every scout has reported. Resolve
   `scripts/create_review_report.py` against this skill's directory:

   ```bash
   python3 SKILL_DIR/scripts/create_review_report.py --workspace REPO_ROOT \
     --review-name NAME --scope "SCOPE" --review-brief-sha256 HASH \
     --scout-count N --directive-count D
   ```

   It numbers rounds itself, refuses to overwrite a report, and prints `report_path`; use that
   path. Done when the file exists.

6. **Consolidate the candidates.** Group every candidate by root cause into findings `F001`,
   `F002`, and so on, and keep every unique or speculative one; filtering happens in
   adjudication, not here. Fill each finding's fields, list every finding with its read-only
   check in the Verification queue, and write the strongest reason not to merge yet. If no scout
   reported anything, write `No candidates reported.` under Findings. Done when only the
   Adjudication section still has `TODO` entries.

7. **Guard later rounds.** Before round 2 or later, read the earlier reports with the same name
   and give the scouts short notes on confirmed fixes, false positives with their evidence,
   unresolved routes, and regression risks. The notes are context, not a filter: a scout may
   revive a rejected finding, and the report keeps it.

## Adjudicate every finding

Work through each finding from either lane:

1. **Restate the claim** in your own words: what fails, where, under which input or timing, and
   which contract it breaks. If you can't, ask the reporting Peer once for the missing piece. A
   large share of false positives fall apart at this step.
2. **Run its disconfirming check.** Read the path from the input to the failure, including every
   validation upstream; confirm who controls the input; run a targeted test if the test lane
   allows, or brief a Peer to write a failing one.
3. **Argue the other side once.** Are you dismissing it because the failure path is long, or
   crediting a protection you haven't actually seen in the code?
4. **Record the verdict**: true positive, false positive, or unresolved, with the evidence (the
   command and its output, or file:line). In a sweep, it goes in the report's Adjudication
   table; otherwise, in the acceptance summary.
5. **Look for chains.** When every verdict is in, check whether findings you rejected or rated
   low combine into a real failure, such as an unvalidated input reaching a path whose check was
   dismissed as unreachable. Record each chain, or `none`.
6. **Route the result.** Send true positives back as fix rounds to the slice's owner, under the
   fix-round cap in the decompose skill; make a real finding outside every slice into a new
   slice; give an unresolved one a verification slice or a line in the acceptance summary. False
   positives stay in the record with their evidence, so the next round's notes carry them.

Done when every finding has a verdict and a route, and `grep -c TODO REPORT_PATH` prints `0`.
Then commit the report on its own (`git add REPORT_PATH && git commit -m "review: NAME round
N"`) and archive the scouts.

After a fix round, check the fixes with the scoped re-review brief in `references/briefs.md`:
each finding is `ADDRESSED` or `NOT ADDRESSED`, and only new breakage inside the fix diff counts.
Run a fresh sweep round only when the fixes were broad or the lane is high-risk.

The rule that matters most: every finding gets a disconfirming check and a recorded verdict,
and the ruling is yours alone.
