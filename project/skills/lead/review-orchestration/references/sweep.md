# Sweep lane

Read this when the lane table in the skill sends you here: high-risk work with weak proof, a
large or unfamiliar surface, or a pre-merge audit where recall beats noise. The sweep ends in one
report at `docs/reviews/DATE-NAME-round-N.md`, which stays until its findings are routed and
fixed. Adjudicate its findings with "Adjudicate every finding" in the skill.

1. **Write the review brief to a file** outside the repository that survives a restart, such as
   `~/.local/state/lead-reviews/REPO/NAME-round-N-brief.md`: scope (paths, commit range), change
   intent, applicable contracts, prior-round warnings, concerns, and step 2's allocation. Hash
   it with `shasum -a 256 FILE`. Done when the file exists and you have its hash.

2. **Define and allocate the concerns.** Directives in the request become mandatory concerns
   `D01`, `D02`, …; otherwise derive `G01`, `G02`, … from scope, contracts, call paths,
   lifecycle, data flow, and blast radius, using the concern lenses in `references/briefs.md`.
   Pick N from 4 to 10 so each directive `D0x` has at least three scouts, each derived concern
   `G0x` at least two, and no scout more than three concerns. Scouts sharing a concern take
   different traces, lifecycle phases, owners, hostile cases, or disconfirming angles, never one
   copied prompt. Name them `scout-01` onwards. Done when the allocation table meets those
   counts.

3. **Brief and launch the scouts** with the scout brief in `references/briefs.md`, from the
   Reviewer profile, disposition Reviewer (the Scout disposition returns a map without
   findings), thinking `medium`. Scouts share your checkout and test lane, so they run no tests,
   builds, or package managers, and skip Open Code Review: add one more Reviewer with the axis
   Reviewer brief and the `machine pass` axis to run it once over the whole scope. Use
   `create_agent` with labels `review.name`, `review.round`, `review.scout`, `review.concerns`,
   and wait for the notifications. Done when N agent IDs have come back.

4. **Recover from a restart without relaunching.** After a restart, a compaction, or agents
   stopping mid-sweep, the roster in the brief file stays fixed: match `review.*` labels from
   `list_agents` to logical scouts, and collect finished reports with `get_agent_activity`.
   Relaunch only missing or failed scouts, with their original assignment and `review.scout`
   label; never add a scout or rerun a finished one. Archive scouts only after the report is
   written; until then their reports live only in their timelines. Done when every logical
   scout has exactly one report.

5. **Create the report** once, after every scout has reported, with
   `scripts/create_review_report.py` resolved against this skill's directory:

   ```bash
   python3 SKILL_DIR/scripts/create_review_report.py --workspace REPO_ROOT \
     --review-name NAME --scope "SCOPE" --review-brief-sha256 HASH \
     --scout-count N --directive-count D
   ```

   It numbers rounds, refuses to overwrite, and prints `report_path`; use that path. Done when
   the file exists.

6. **Consolidate the candidates** by root cause into findings `F001`, `F002`, …, keeping every
   unique or speculative one (filtering happens in adjudication). Fill each finding's fields,
   put each with its read-only check in the Verification queue, and write the strongest reason
   not to merge yet. With no candidates, write `No candidates reported.` under Findings. Done
   when only the Adjudication section still has `TODO` entries.

7. **Guard later rounds.** Before round 2 or later, read the earlier reports with the same name
   and give the scouts short notes on confirmed fixes, false positives with evidence, unresolved
   routes, and regression risks. The notes are context, not a filter: a scout may revive a
   rejected finding, and the report keeps it.
