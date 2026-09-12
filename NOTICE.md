# Skill sources

The eleven skills in `project/skills/` fall into two groups, and the difference matters for
credit. Six are **SLP files** installed here with targeted edits — model names, Windows paths,
Codex-only tooling, and the launch shapes replaced with this kit's — and their text is the SLP
author's. Five are **written for this kit**, adapting a mechanism (a procedure, a gate, or a
checklist) from an existing skill, book, or article without copying its text beyond short
phrases. Two vendored Python scripts keep their upstream form, comments included, so they can be
re-synced.

"SLP material" means the reference files in the kit owner's `SLP/` folder: a practitioner's
Codex setup (prompts, skills, and concept notes) that was shared with the kit's owner. No license
is stated for it, and it is used here with the owner's agreement. "The SLP author's talk" is a
recorded community session in which that practitioner explained how their Supervisor directs
attention (`meeting.txt` in the same folder); the kit borrows its mechanisms, not its words.

Twenty-one skill directories the kit used to ship were retired on 2026-09-12 — three of them
replaced by their SLP originals under the SLP names. They and the sources they drew on are in git
history at `db20bff^`.

## Installed from SLP, with edits

| Skill | Source file | What changed here |
|---|---|---|
| `lead/council` | SLP `council/` with `references/report-format.md` | `$ARGUMENTS` and the Codex room-role guard removed; the Lead-only guard rewritten as "only when the Human asked"; launch block, routing, and isolation claims rewritten for this kit's one read-only profile; `references/routing.md` rewritten from `model-routing.md` |
| `lead/ultra-review` | SLP `ultra-review/` | fixed model names replaced with the Reviewer profile; the author's absolute Windows script path replaced; the `$ultra-review-receive` handoff replaced with the Lead's ruling and an Engineer brief; the Human-invoked gate added |
| `lead/review-pack` | SLP `review-pack/` | the `codex-chatgpt-control` upload section removed; Windows paths, PowerShell continuations, and the description's Codex framing converted |
| `lead/repo-refresh` | SLP `repo-refresh/` | unchanged |
| `peer/frontend-design` | SLP `frontend-design-SKILL.md` | unchanged |
| `peer/test-proof-debt-audit` | SLP `test-proof-debt-audit-SKILL.md` and `catalog.md` | unchanged; the catalog installed as `references/proof-debt-catalog.md` |
| `supervisor/architecture-premise-audit` | SLP `SKILL.md` | unchanged |
| `reviewer/reviewing-a-change/references/structural-lenses.md` | SLP `structural-antipatterns.md` | unchanged |
| `.seatworks/guides/FEATURE_INTAKE.md`, `.seatworks/guides/PLANS.md` | SLP `FEATURE_INTAKE.md`, `PLANS.md` | the compatibility hard-cut made conditional on the project's `AGENTS.md`; the intake-result and plan paths pointed at `.seatworks/` |

Both vendored scripts, `lead/review-pack/scripts/review_pack.py` and
`lead/ultra-review/scripts/create_ultra_review_report.py`, are SLP files kept byte-for-byte.

## Written for this kit

| Skill | Draws on |
|---|---|
| `peer/test-first` | superpowers `test-driven-development`; a Codex `test-driven-development` adaptation (evidence first, proof surfaces, the relevant-test gate, the wrapper and bridge rule); mattpocock `tdd`; SLP material (test discipline and hard-cut rules); the SLP author's talk (minted APIs, a short anti-pattern list) |
| `peer/diagnosing-bugs` | mattpocock `diagnosing-bugs`; superpowers `systematic-debugging` and its root-cause tracing |
| `peer/security-check` | addyosmani `security-and-hardening`; trailofbits `sharp-edges` (ideas only) |
| `reviewer/reviewing-a-change` | mattpocock `code-review` (two separate axes); SLP material (`ultra-review` finding schema, structural anti-patterns) |
| `maintenance/seat-safety-review` | Simon Willison, "The lethal trifecta for AI agents"; the Threat Modeling Manifesto's four questions |

## Sources and licenses

| Source | Where | License |
|---|---|---|
| alibaba/open-code-review | https://github.com/alibaba/open-code-review | Apache-2.0, © 2026 Alibaba; the Reviewer runs its CLI, no text copied |
| obra/superpowers (Jesse Vincent) | https://github.com/obra/superpowers | MIT, © 2025 Jesse Vincent |
| mattpocock/skills (Matt Pocock) | https://github.com/mattpocock/skills | MIT, © 2026 Matt Pocock |
| addyosmani/agent-skills (Addy Osmani) | https://github.com/addyosmani/agent-skills | MIT, © 2025 Addy Osmani |
| trailofbits/skills, `sharp-edges` | https://github.com/trailofbits/skills | CC-BY-SA-4.0; ideas only, no text |
| Simon Willison, "The lethal trifecta for AI agents" | https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ | ideas only |
| Threat Modeling Manifesto | https://www.threatmodelingmanifesto.org/ | CC BY 4.0 (attribution given here) |
| SLP material | the kit owner's `SLP/` folder | no license stated; used and adapted with the owner's agreement |

Sources that only the retired skills drew on are listed with those skills in git history, not
here.
