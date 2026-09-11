# Skill sources

The skills in this directory are written for this kit. Most adapt a mechanism (a procedure, a
gate, or a checklist) from an existing skill, book, or article. None of them copies the source's
text beyond short phrases. This file lists those sources and their licenses, so that each idea
can be traced and credited.

"SLP material" means the reference files in the kit owner's `SLP/` folder: a practitioner's
Codex setup (prompts, skills, and concept notes) that was shared with the kit's owner. No license
is stated for it, and it is adapted here with the owner's agreement.

## Peer skills (`skills/peer/`)

| Skill | Draws on |
|---|---|
| `test-first` | superpowers `test-driven-development`; mattpocock `tdd`; SLP material (test discipline and hard-cut rules) |
| `diagnosing-bugs` | mattpocock `diagnosing-bugs`; superpowers `systematic-debugging` and its root-cause tracing |
| `proof-audit` | SLP material (`test-proof-debt-audit` and its catalog); superpowers `verification-before-completion` |
| `reviewing-a-change` | mattpocock `code-review` (two separate axes); SLP material (`ultra-review` finding schema, structural anti-patterns) |
| `receiving-review` | superpowers `receiving-code-review` |
| `design-options` | mattpocock `codebase-design` (deep modules, designing it twice); SLP material (`architecture-premise-audit` slices, structural anti-patterns) |
| `frontend-change` | SLP material (`frontend-design`); anthropics/skills `webapp-testing` |
| `performance-change` | addyosmani `performance-optimization`; SLP material (avoidable taxes) |
| `security-check` | addyosmani `security-and-hardening`; trailofbits `sharp-edges` (ideas only) |

## Lead skills (`skills/lead/`)

| Skill | Draws on |
|---|---|
| `intake` | SLP material (feature intake lanes, ExecPlans); superpowers `brainstorming` (a lane only moves upward) |
| `decompose` | superpowers `subagent-driven-development` (ledger, rulings, fix-round cap) and `writing-plans` (interfaces, global constraints); mattpocock `to-tickets`; addyosmani `planning-and-task-breakdown`; Anthropic, "How we built our multi-agent research system"; Humanizing Work's guide to splitting user stories |
| `council` | SLP material (`council`, its report format and model routing) |
| `review-orchestration` | SLP material (`ultra-review` and its report script); trailofbits `fp-check` (ideas only) |
| `decision-records` | Michael Nygard, "Documenting Architecture Decisions"; Thoughtworks Radar, lightweight ADRs; mattpocock `domain-modeling`; addyosmani `documentation-and-adrs` |
| `change-rollout` | Danilo Sato, "Parallel Change"; "Patterns of Legacy Displacement" and the strangler fig; Google SRE book and workbook on launches and canarying (ideas only); addyosmani `deprecation-and-migration`; SLP material (hard-cut development policy) |
| `project-state` | Anthropic, "Effective harnesses for long-running agents"; mattpocock `handoff`; Adam Tornhill's churn hotspots (idea) |
| `integration` | superpowers `finishing-a-development-branch`; mattpocock `resolving-merge-conflicts` |
| `repo-refresh` | SLP material (`repo-refresh` and its refresh standard) |
| `review-pack` | SLP material (`review-pack`; `scripts/review_pack.py` and `references/profiles.md` are copied unchanged) |

## Supervisor skills (`skills/supervisor/`)

| Skill | Draws on |
|---|---|
| `intent-interview` | mattpocock `grilling` and `to-questionnaire`; *The Mom Test*; *Shape Up* (appetite, no-gos); Amazon's 2015 shareholder letter (one-way and two-way doors) |
| `workspace-protocol` | mattpocock `grilling`; the kit's templates; the SLP report's account of per-repository protocols |
| `pre-mortem` | Gary Klein's premortem; one-way and two-way doors; SLP material (`council` sealed seats) |
| `retrospective` | Google SRE book, "Postmortem Culture" (ideas only); Retrium's five phases of a retrospective; mattpocock `retro` categories |
| `protocol-patch` | superpowers `writing-skills` (test the change on a fresh seat); mattpocock `writing-for-agents`; SLP material (Supervisor instructions) |
| `seat-safety-review` | Simon Willison, "The lethal trifecta for AI agents"; the Threat Modeling Manifesto's four questions |
| `portfolio-review` | Black Swan Farming, "Cost of Delay Divided by Duration"; SLP material (concern-specialized Supervisors) |
| `cross-workspace-integration` | Ian Robinson, "Consumer-Driven Contracts"; Danilo Sato, "Parallel Change"; SLP material (cross-workspace supervision) |
| `architecture-premise-audit` | SLP material (`architecture-premise-audit`, structural anti-patterns) |
| `strategy-synthesis` | Will Larson, "Good engineering strategy is boring" and "Writing an engineering strategy" |

## Sources and licenses

| Source | Where | License |
|---|---|---|
| obra/superpowers (Jesse Vincent) | https://github.com/obra/superpowers | MIT, © 2025 Jesse Vincent |
| mattpocock/skills (Matt Pocock) | https://github.com/mattpocock/skills | MIT, © 2026 Matt Pocock |
| addyosmani/agent-skills (Addy Osmani) | https://github.com/addyosmani/agent-skills | MIT, © 2025 Addy Osmani |
| anthropics/skills, `webapp-testing` | https://github.com/anthropics/skills | Apache-2.0 (per-skill `LICENSE.txt`) |
| trailofbits/skills, `sharp-edges` and `fp-check` | https://github.com/trailofbits/skills | CC-BY-SA-4.0; ideas only, no text |
| Anthropic, "How we built our multi-agent research system" | https://www.anthropic.com/engineering/multi-agent-research-system | © Anthropic; ideas only |
| Anthropic, "Effective harnesses for long-running agents" | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | © Anthropic; ideas only |
| Humanizing Work, "The Humanizing Work Guide to Splitting User Stories" | https://www.humanizingwork.com/the-humanizing-work-guide-to-splitting-user-stories/ | © Humanizing Work; ideas only |
| Michael Nygard, "Documenting Architecture Decisions" | https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions | ideas only |
| Thoughtworks Radar, "Lightweight Architecture Decision Records" | https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records | © Thoughtworks; ideas only |
| Cartwright, Horn, and Lewis, "Patterns of Legacy Displacement"; Martin Fowler, "StranglerFigApplication" | https://martinfowler.com/articles/patterns-legacy-displacement/ and https://martinfowler.com/bliki/StranglerFigApplication.html | ideas only |
| Google SRE book, "Reliable Product Launches at Scale"; SRE workbook, "Canarying Releases" | https://sre.google/sre-book/reliable-product-launches/ and https://sre.google/workbook/canarying-releases/ | CC BY-NC-ND 4.0; ideas only |
| Adam Tornhill, *Your Code as a Crime Scene* | book | ideas only |
| Rob Fitzpatrick, *The Mom Test* | https://www.momtestbook.com/ | book; ideas only |
| Ryan Singer, *Shape Up* | https://basecamp.com/shapeup | © 37signals; ideas only |
| Amazon 2015 shareholder letter | https://s2.q4cdn.com/299287126/files/doc_financials/annual/2015-Letter-to-Shareholders.PDF | © Amazon; idea only |
| Gary Klein, "Performing a Project Premortem" | https://www.gary-klein.com/premortem | ideas only |
| Google SRE book, "Postmortem Culture" | https://sre.google/sre-book/postmortem-culture/ | CC BY-NC-ND 4.0; ideas only |
| Retrium, "The Five Phases of a Successful Retrospective" | https://www.retrium.com/ultimate-guide-to-agile-retrospectives/five-phases-of-a-successful-retrospective | ideas only |
| Simon Willison, "The lethal trifecta for AI agents" | https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/ | ideas only |
| Threat Modeling Manifesto | https://www.threatmodelingmanifesto.org/ | CC BY 4.0 (attribution given here) |
| Ian Robinson, "Consumer-Driven Contracts" | https://martinfowler.com/articles/consumerDrivenContracts.html | ideas only |
| Danilo Sato, "Parallel Change" | https://martinfowler.com/bliki/ParallelChange.html | ideas only |
| Black Swan Farming, "Cost of Delay Divided by Duration" | https://blackswanfarming.com/cost-of-delay-divided-by-duration/ | ideas only |
| Will Larson, lethain.com | https://lethain.com/good-engineering-strategy-is-boring/ and https://lethain.com/eng-strategies/ | ideas only |
| SLP material | the kit owner's `SLP/` folder | no license stated; adapted with the owner's agreement |
