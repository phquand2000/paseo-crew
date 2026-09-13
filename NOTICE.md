# Skill sources

The ten skills in `project/skills/` fall into three groups, and the difference matters for
credit. Seven are **SLP files** installed here with targeted edits — model names, Windows paths,
Codex-only tooling, and the launch shapes replaced with this kit's — and their text is the SLP
author's. Four are **written for this kit**, adapting a mechanism (a procedure, a gate, or a
checklist) from an existing skill, book, or article without copying its text beyond short
phrases. Two are **written for this kit from published research**, credited with their sources
below. Two vendored Python scripts keep their upstream form, comments included, so they can be
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
| `lead/council` | SLP `council/` with `references/report-format.md` | `$ARGUMENTS` and the Codex room-role guard removed; the Lead-only guard dropped, since only the Lead's seat carries the skill, and the Lead opens a council on its own judgment; launch mechanics the orchestrator handles removed, and the brief given inline field hints; `model-routing.md` cut to a thinking-level table in the skill, without the preferences file, and each position's model and thinking level read from the workspace protocol's Routing; and a same-family Challenger named in the verdict's limitations; the audit for reviewers reading each other's work dropped, since the Reviewer's settings give it no view of other agents |
| `lead/ultra-review` | SLP `ultra-review/` and `review-pack/` | merged into one skill with a hunt and a pack mode, where Open Code Review's delegation and scan previews select the files and group them by rule; the scouts' model and thinking level read from the workspace protocol's Routing, with the machine pass skipped; the author's absolute Windows paths, PowerShell continuations, Codex framing and `codex-chatgpt-control` upload section removed; the `$ultra-review-receive` handoff replaced with a rulings table and an Engineer brief |
| `lead/repo-refresh` | SLP `repo-refresh/` | the apply mode's deletions sent out as Engineer briefs, since the Lead writes only `docs/` and its records; the `$repo-refresh` invocation dropped, so the Lead opens it on its own judgment |
| `peer/test-proof-debt-audit` | SLP `test-proof-debt-audit-SKILL.md` and `catalog.md` | the user as requester replaced by the brief; the catalog installed as `references/proof-debt-catalog.md`, cut to its search families and routes |
| `supervisor/architecture-premise-audit` | SLP `SKILL.md` | its explicit-request gate dropped, so the Supervisor opens it on its own judgment |
| `.seatworks/guides/STRUCTURAL_LENSES.md` | SLP `structural-antipatterns.md` | condensed; every lens, the domain examples and the exoneration verdicts kept |
| `.seatworks/guides/FEATURE_INTAKE.md`, `.seatworks/guides/PLANS.md` | SLP `FEATURE_INTAKE.md`, `PLANS.md` | the compatibility hard-cut made conditional on the project's `AGENTS.md`; the intake-result and plan paths pointed at `.seatworks/`; the Design Gate's record pointed at an ADR; `PLANS.md` since rewritten, listed below |

Both scripts, `lead/ultra-review/scripts/review_pack.py` and
`lead/ultra-review/scripts/create_ultra_review_report.py`, come from SLP. The report script now
builds a coverage ledger and a scout assignment from Open Code Review's JSON and ends in a rulings
table; the pack script was cut to packing what that JSON selects, with the change's diff and a fixed
reviewer prompt, dropping its language profiles, line excerpts, review kinds and Rust impact report. Their comments
and docstrings were removed, as the kit's scripts carry none.

On 2026-09-14 every skill was cut to the job and how to do it, drawing on Anthropic's skill
authoring best practices and agentskills.io (what the agent would get wrong without it, one reason
per rule, formats and thresholds kept in the body), SkillsBench (compact skills beat comprehensive
ones) and SkillReducer (most skill text is background, not action). The refresh standard now leaves
the records this kit's guides define in their guides' layout.

## Written for this kit

| Skill | Draws on |
|---|---|
| `peer/test-first` | superpowers `test-driven-development`; a Codex `test-driven-development` adaptation (evidence first, proof surfaces, the relevant-test gate, the wrapper and bridge rule); mattpocock `tdd`; SLP material (test discipline and hard-cut rules); the SLP author's talk (minted APIs, a short anti-pattern list) |
| `peer/diagnosing-bugs` | mattpocock `diagnosing-bugs`; superpowers `systematic-debugging` and its root-cause tracing |
| `peer/security-check` | addyosmani `security-and-hardening`; trailofbits `sharp-edges` (ideas only) |
| `.seatworks/prompts/REVIEWER.md` (the review procedure, from the retired `reviewing-a-change` skill) | mattpocock `code-review` (two separate axes); SLP material (`ultra-review` finding schema, structural anti-patterns); alibaba/open-code-review (its `delegate` contract: scope, exclusion reasons, and rules resolved per file pattern); OpenAI Codex's review rubric (a strict bar for what counts, then every qualifying finding with priority and confidence); Anthropic's Claude Code code-review command (validate each finding before reporting, quote the rule it breaks); Atlassian's review-agent ablation and BitsAI-CR (standing rules as the strongest lever, a verification pass for precision); the PR-description bias study (read the change before its description) |
| `supervisor/pre-mortem` | Gary Klein, "Performing a Project Premortem" (prospective hindsight, and the shift from what could go wrong to what did); SLP material (`council` sealed seats, one lens per seat) |
| `supervisor/retrospective` | Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (the three failure classes, and organizational design over model capability); the SLP author's talk (a weekly review that distills the period into rules) |
| `.seatworks/guides/PLANS.md` (rewritten), `ADR.md`, `REVIEW.md` | Nygard's ADR and MADR (sections, statuses, superseding); Zdun et al.'s Y-statement (the decision sentence); AWS and Azure ADR guidance (an accepted record is not edited; when a decision earns one); HumanLayer's plans and GitHub Spec Kit (the plan as current state, acceptance per unit of work); Rust tracking issues and stabilization reports, and Kubernetes KEPs (progress, review and deviations kept out of the design); OpenAI's ExecPlans (restartable from the plan alone); Anthropic's prompting guidance and BMAD's templates (sizes in the headings, destinations instead of prohibitions, field hints inside the template, the same news written right and wrong); OpenAI's harness-engineering lints and Factory's lint-driven agents (a check that informs with the fix instead of refusing) |
| `examples/WORKSPACE_PROTOCOL.md` and `project/records/NOTEBOOK.md` (rewritten) | the SLP author's workspace protocol and supervisor notebook (two sections of routing and gates; one row per pattern with where its fix lives); ITIL problem management and Google's SRE workbook (a problem, not an incident, is the unit, with an owner and a verifiable end state); ACE, Mem0 and Xiong et al. (match before adding, no whole-file rewrites, delete what stops being useful); Gloaguen et al. and OpenAI's harness engineering (only what the agent cannot discover, as a short map) |

## Sources and licenses

| Source | Where | License |
|---|---|---|
| alibaba/open-code-review | https://github.com/alibaba/open-code-review | Apache-2.0, © 2026 Alibaba; the Reviewer runs its `delegate` subcommand, no text copied |
| obra/superpowers (Jesse Vincent) | https://github.com/obra/superpowers | MIT, © 2025 Jesse Vincent |
| mattpocock/skills (Matt Pocock) | https://github.com/mattpocock/skills | MIT, © 2026 Matt Pocock |
| addyosmani/agent-skills (Addy Osmani) | https://github.com/addyosmani/agent-skills | MIT, © 2025 Addy Osmani |
| trailofbits/skills, `sharp-edges` | https://github.com/trailofbits/skills | CC-BY-SA-4.0; ideas only, no text |
| Gary Klein, "Performing a Project Premortem" | https://hbr.org/2007/09/performing-a-project-premortem | © Harvard Business Review; ideas only |
| Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" | https://arxiv.org/abs/2503.13657 | ideas only; the taxonomy's three classes, not its text |
| Michael Nygard, "Documenting Architecture Decisions" | https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions | ideas only |
| MADR | https://adr.github.io/madr/ | ideas only; section names |
| Y-statement form (Zdun et al.) | https://socadk.github.io/design-practice-repository/artifact-templates/DPR-ArchitecturalDecisionRecordYForm.html | ideas only; the sentence form |
| AWS Prescriptive Guidance, ADR process | https://docs.aws.amazon.com/prescriptive-guidance/latest/architectural-decision-records/adr-process.html | ideas only |
| HumanLayer, advanced context engineering for coding agents | https://github.com/humanlayer/advanced-context-engineering-for-coding-agents | ideas only |
| GitHub Spec Kit | https://github.com/github/spec-kit | ideas only |
| OpenAI Cookbook, ExecPlans | https://developers.openai.com/cookbook/articles/codex_exec_plans | ideas only |
| Rust RFCs and stabilization guide | https://rustc-dev-guide.rust-lang.org/stabilization-guide.html | ideas only |
| Anthropic, Claude prompting best practices | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | ideas only |
| BMAD-METHOD | https://github.com/bmad-code-org/BMAD-METHOD | ideas only; per-section size budgets |
| Factory, "Using linters to direct agents" | https://factory.ai/news/using-linters-to-direct-agents | ideas only |
| ITIL problem management | https://wiki.en.it-processmaps.com/index.php/Problem_Management | ideas only |
| Google SRE workbook, postmortem culture | https://sre.google/workbook/postmortem-culture/ | ideas only |
| Gloaguen et al., evaluating repository context files | https://arxiv.org/abs/2602.11988 | ideas only |
| Xiong et al., memory management for LLM agents | https://arxiv.org/abs/2505.16067 | ideas only |
| SLP material | the kit owner's `SLP/` folder | no license stated; used and adapted with the owner's agreement |

Sources that only the retired skills drew on are listed with those skills in git history, not
here.
