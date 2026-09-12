# Review briefs

Briefs for the two multi-Peer review lanes and the scoped re-review after fixes, and the lenses
a sweep draws its concerns from. Each brief goes into `create_agent` as `initialPrompt`.

Contents:

- Axis Reviewer
- Concern lenses
- Scout
- Scoped re-review

## Axis Reviewer

```text
Task ID             REVIEW_NAME-rROUND-AXIS
Repository root     REPO_ROOT
Disposition         Reviewer
Objective           Answer this question about SHA_OR_RANGE: QUESTION
Axis                AXIS_TEXT
Machine pass        MACHINE_PASS
Starting points     the slice brief at BRIEF_PATH, the handoff at HANDOFF_PATH,
                    `git diff BASE_SHA HEAD_SHA`, AGENTS.md
Global constraints  GLOBAL_CONSTRAINTS
Rulings to check    RULINGS_TO_CHECK
Owned scope         none; read-only
Verification        none required; cite file:line and any command you ran with its output
Report              Every finding, minor and uncertain ones included (the Lead filters), each
                    with evidence (file:line), consequence, smallest fix, severity (P0 to P3),
                    confidence (high, medium, low), and whether it is material. An empty
                    review is a valid result.
Handoff             The six fields; leave Snapshot empty, since you write nothing.
```

Replace the following:

- `REVIEW_NAME`, `ROUND`, `AXIS`: identifiers, for example `invoice-csv-r1-spec`.
- `SHA_OR_RANGE`, `BASE_SHA`, `HEAD_SHA`, `QUESTION`: the target and the question, identical for
  every Reviewer of the round; for example `Is it ready to accept as the implementation of the
  brief?`
- `AXIS_TEXT`: one of these:
  - spec conformance: does the change do everything the brief and the global constraints ask,
    and nothing beyond it? Map each requirement to code and to a check.
  - standards: does it follow `AGENTS.md` and the repository's conventions, and would each test
    fail if the behavior it claims to prove disappeared?
  - structural: are boundaries, ownership, coupling, lifecycle, and failure handling sound, and
    does the change weaken an interface, data model, or stateful system later work depends on?
  - machine pass, for a sweep: run Open Code Review over the whole scope and report its
    confirmed findings; skip the other axes.
- `MACHINE_PASS`: `run` for exactly one Reviewer per round, `skip` for the others.
- `BRIEF_PATH`, `HANDOFF_PATH`: files holding the slice's brief and the Peer's handoff.
- `GLOBAL_CONSTRAINTS`: the slice brief's constraints, word for word.
- `RULINGS_TO_CHECK`: each `(ambiguous)` ruling the change implements, as a question quoting
  the directive's words, such as `The directive says "export every invoice"; is skipping drafts
  a valid reading?`, or `none`.

## Concern lenses

One `G0x` concern per lens the scope touches:

- semantic and state-machine correctness;
- ownership against lifecycle events;
- API, schema, and data-format contracts;
- concurrency, ordering, cancellation, cleanup, and resource lifetime;
- error masking, fallbacks, retries, and partial failure;
- authorization, trust boundaries, and hostile input;
- hot-path cost;
- generated files, fixtures, snapshots, and docs;
- proof that passes without its behavior;
- duplicate state and wrappers compensating for a broken foundation;
- alternative end-to-end traces.

## Scout

```text
Task ID             REVIEW_NAME-rROUND-SCOUT_ID
Repository root     REPO_ROOT
Disposition         Reviewer
Objective           Find as many real bugs as you can in SCOPE, at SHA_OR_RANGE.
Change intent       CHANGE_INTENT
Contracts           CONTRACTS
Assigned concerns   CONCERNS_WITH_ANGLES
Prior-round notes   PRIOR_ROUND_NOTES
Method              Read-only static inspection. Read the whole relevant production surface,
                    not only the diff: callers, callees, lifecycle, data flow. Run no tests,
                    builds, package managers, or generators; other agents share this checkout.
Machine pass        skip; it runs separately for this sweep
Report              Every candidate in scope, speculative, low-confidence, and incidental
                    ones included, each with severity (P0 to P3), confidence, file:line,
                    evidence observed, the contract or expected behavior it violates, the
                    plausible failure mode, a durable fix hypothesis, and a read-only check
                    that would prove it false. An incomplete candidate beats a suppressed one.
Handoff             The six fields; leave Snapshot empty, since you write nothing.
```

Replace the following:

- `SCOUT_ID`: the logical scout, `scout-01` to `scout-10`.
- `SCOPE`, `SHA_OR_RANGE`: the paths and commits under review, identical for every scout.
- `CHANGE_INTENT`: what the change is meant to do, in two or three sentences.
- `CONTRACTS`: the applicable repository contracts, ADRs, and `AGENTS.md` rules, as paths.
- `CONCERNS_WITH_ANGLES`: each assigned concern ID with this scout's angle, for example `G03
  cancellation: trace from the HTTP handler inward, looking for work that outlives the request`.
- `PRIOR_ROUND_NOTES`: the notes from sweep step 7 in `SKILL.md`, or `none` in round 1.

## Scoped re-review

Checks the fixes, not the whole slice:

```text
Task ID             REVIEW_NAME-rROUND-recheck
Repository root     REPO_ROOT
Disposition         Reviewer
Objective           For each finding below, say ADDRESSED or NOT ADDRESSED at HEAD_SHA, with
                    file:line evidence. Then report any new breakage inside the fix diff only.
Findings            FINDINGS
Machine pass        run, over FIX_BASE..HEAD_SHA only
Starting points     `git diff FIX_BASE HEAD_SHA`, the fix handoff at HANDOFF_PATH
Handoff             The six fields; leave Snapshot empty, since you write nothing.
```

Replace `FINDINGS` with the open findings word for word, `FIX_BASE` with the commit the previous
review saw, and the rest as above. Observations about code outside the fix diff go into the
acceptance summary as open items; they don't extend the loop.
