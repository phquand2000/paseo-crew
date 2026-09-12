# Council evidence machinery

Phases 3 to 6, and the auditor setup for Phase 8. Open this when the Round 1 seats have
finished; nothing here is needed while you frame the case or seal the round.

Contents:

- Phase 3: collect, audit, and handle failures
- Failure policy
- Phase 4: decision model
- Phase 5: verification
- Phase 6: cross-examination
- Phase 8: the auditor's packet

## Phase 3: collect, audit, and handle failures

When every Round 1 seat has finished:

1. Read each seat's activity with `get_agent_activity`.
2. Look for file writes or edits, commits, attempts to find or read another seat's output or your
   position file, and commands that start agents.
3. Check the snapshot: `python3 SKILL_DIR/scripts/case.py verify CASE_ID --root REPO_ROOT`.
4. Mark a seat that broke isolation `COMPROMISED`, and leave its report out.
5. Set `council.phase` to `review` on each valid seat with `update_agent`.
6. Then read the reports.

On a reported mismatch, stop the affected part of the case and report it exactly; changes outside
the authorized sources aren't a mismatch. Clean nothing up, and don't blame a seat for a
concurrent change without evidence. Done when every seat is valid or marked, and valid seats are
in `review`.

## Failure policy

- Infrastructure or output-contract failure: at most one retry, with the same brief and snapshot.
- Missing content: ask the same seat once for that piece only; don't chase cosmetic format.
- Infrastructure failure or a compromised seat: create one fresh replacement.
- `lens` issues no verdict without its only seat.
- `debate` and `debate-with-proof` may continue with one core seat missing, labeled `DEGRADED`.
- `high-risk` issues no normal binding verdict without both core seats.
- "Insufficient coverage" never counts as evidence that a claim is false.

## Phase 4: decision model

Reduce the valid reports to the smallest model that keeps every unit the verdict needs: three to
five material propositions for a focused decision, one row per finding for an audit, one row per
gate for a plan review, a timeline and causal model for an incident. Never merge, cap, or drop a
requested finding to shrink the model.

Type each material claim where the type changes the evidence bar, and give it one status:

| Types | Statuses |
|---|---|
| `FACT`, `INFERENCE`, `CAUSAL CLAIM`, `FORECAST`, `VALUE / PREFERENCE`, `AUTHORITATIVE CONSTRAINT` | `verified`, `falsified`, `authoritative`, `supported inference`, `contested inference`, `unresolved`, `insufficient coverage`, `snapshot mismatch` |

Only facts and direct observations can be fact-checked; inferences, forecasts, and values need
arguments, not a fake fact check. If the model grows too large to reason about honestly, split it
by sub-question with an index back to the request's units. Done when every material claim has a
type and a status.

## Phase 5: verification

For each material factual dispute, create one to three Verifiers: same case ID, role `verifier`,
round `verify`, the disposition `routing.md` gives its profile, the seat preamble and epilogue
from `seat-prompt.md`. Give each one proposition, the authorized sources, and one distinct
mandate:

- **support**: search for direct evidence that the proposition holds;
- **disconfirm**: search for counterexamples and evidence against it;
- **coverage**: find the sources the others are likely to miss.

Use only the mandates the proposition needs, and never send identical prompts to count votes. Use
the deep-verifier routing when reading the source takes judgment. The output shape is in
`report-format.md`. A `snapshot mismatch` halts that proposition until the source is refreshed.
Done when every disputed fact has a result.

## Phase 6: cross-examination

For a material disagreement that evidence didn't settle, send the original seat only the disputed
point and the relevant evidence with `send_agent_prompt`, asking for the cross-examination
response in `report-format.md`. Allow one challenge and one response per disputed point, never an
open debate. Skip this phase and Phase 5 when every valid seat agrees and no factual or framing
issue remains.

## Phase 8: the auditor's packet

Create one fresh Auditor: the disposition `routing.md` gives its profile, role `auditor`, round
and phase `audit`, the same preamble and epilogue. Give it only the brief, every valid Round 1
report labeled by role, the decision model, the verified evidence, the draft verdict, and the
material dissent, with no agent IDs or transcripts.

A material claim the model or draft left out counts as a material finding. Resolve every material
finding by revising the draft, removing an unsupported claim, or sending that proposition back to
Phase 5 or 6. Run at most one audit round; the Auditor never replaces the verdict.
