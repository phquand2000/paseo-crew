# Writing guide

Rules for the seat prompts, skills, templates and docs in this kit. Scripts carry no comments
(except the vendored ones NOTICE.md names), so their reasons live in REFERENCE.md, or in
`harness/<id>/NOTES.md` for one coding agent's behavior. Bracketed tags name sources, listed at the
end.

## Seat prompts

A prompt is in context on every turn, so each line must earn its place.

1. Cut any line whose absence wouldn't cause a mistake, and what the model knows or can read in
   the code. [BP, S]
2. Stay under 200 lines and 16 KB: adherence drops silently as files grow. [M, IFS]
3. Write calm, plain instructions; capitals and "MUST" make a model over-apply a rule. Tune for
   the weakest model the role runs on. [P, BP]
4. Say what to do, not what to avoid. [P]
5. Give each rule its reason; the model generalizes from it. [P]
6. Make rules checkable by naming the command, field or threshold. [M]
7. Write heuristics, exact only where a mistake is costly. [CE, S]
8. Open with one sentence stating the role, then behavior. [P]
9. Put the most important rules first, and restate the top one at the end. [O5, LIM]
10. Use one term per concept, from Terminology. [M, S]
11. State scope: strong models widen a task, cheaper ones read it literally. [O5]
12. Name a runnable check instead of "verify"; current models over-verify. [O5]
13. Enforce hard limits outside the prompt: a harness tool in the role's settings under
    `harness/<id>/`, a Paseo tool in `paseoTools`, a launch or message rule in `plugin/`. Don't
    restate an enforced limit; what no setting can say stays as part of the job. [M]
14. Write every `.md` to load unchanged on every harness: no HTML comments, no harness tool names
    ("your read tool"), no `$ARGUMENTS` or `${CLAUDE_SKILL_DIR}`. Setup refuses them. [M]
15. Add a rule only after an observed failure, with its reason and a removal trigger. [HL, CUR]
16. Put every-session behavior in the prompt and situational behavior in a skill; the Lead names a
    Peer's skills in the brief, because seats rarely open one unprompted. [M]
17. Name no coding agent outside `harness/<id>/NOTES.md`; cite the manifest field instead.
18. Keep a prompt static for a session: it sits in the cached prefix, and nothing dated or counted
    belongs in it. [TP, PC]

What each demo prompt expects you to extend:

| Prompt | Extend |
|---|---|
| `PEER.md` | Boundaries, the handoff fields, the evidence standard |
| `REVIEWER.md` | Findings, review axes, the handoff shape |
| `LEAD.md` | Decisions reserved for the Human, Reviewer conditions, acceptance checks |
| `SUPERVISOR.md` | Attention signals, intervention rights, when a kit change is proposed |
| `WATCHER.md` | The trigger table; keep it short, since a small model rereads it every sweep |

## Briefs and handoffs

1. A brief states objective, output format, where to start and boundaries. [MA]
2. Pass along decisions made and approaches ruled out. [COG]
3. Scale effort to the task; skip delegation when a few reads answer it. [MA, O5]
4. Give parallel writers disjoint scopes. [COG]
5. Keep handoffs condensed; long logs go in files. [CE, MA]
6. Ask Reviewers for every finding with severity and confidence, and filter afterwards. [O5]

## Docs

Keep document types apart by what the reader is doing. [DX] The README says what the kit is, how
to start and where to go next [GHR]; SETUP.md holds only actions; REFERENCE.md holds facts in one
entry pattern.

In a procedure [G]: list prerequisites first, put one imperative action per numbered step with any
condition first, end each step with a runnable **Done** check, state branches, repeatable steps and
rollback, and fence commands with a language tag. Write in second person, active voice and present
tense, with sentence-case headings. [G, MS]

## Templates

Describe each field as a short `<hint>` inside the template, add an example only where output
drifted, and fence copyable content. [GP]

## Skills

Skills live in `project/skills/<role>/` at the role's altitude: strategy for the Supervisor, macro
for the Lead, micro for the Peer. [S, SK, OMP]

1. Frontmatter holds only `name`, equal to the directory name, and `description`. No skill is gated
   behind permission; a role uses its skills on its own judgment.
2. The description is one quoted third-person line: what the skill does, then "Use when…" with
   concrete triggers, at most 400 characters, with "Not for…" where a sibling covers nearby ground.
   Every trigger belongs there, not in the body. [S, SR, RF]
3. Keep `SKILL.md` under 500 lines; move catalogs and templates one level down into `references/`,
   each opening with a line saying what it holds and when to read it. [S, SR]
4. Refer to input as "the request given with this skill". [S]
5. Add only procedure the prompt lacks, and end in a named artifact, so the turns that carried the
   skill can be compacted away. Two open procedures is a seat's working limit. [CR, CE, IFS]
6. Put what a seat reaches in a later turn in `references/`; keep rules, decisions and thresholds
   in the body and drop background. [S, CE, SR]
7. Put deterministic work in `scripts/`, named as `SKILL_DIR/scripts/NAME`. [S]
8. Keep disclosure flat: no index layer above the skills. A seat prompt's trigger table may name a
   situation and a skill, never its procedure. [PD, S]
9. Carry none of the role's `hidesWords`, and borrow mechanisms, not prose, crediting the source in
   NOTICE.md.

## Terminology

| Term | Meaning |
|---|---|
| Human | The owner, who decides the project's concept: what it does and how it behaves |
| Supervisor | Decides everything short of the concept for the Human, relays, observes, keeps the notebook |
| Lead | Owns one project: framing, delegation, acceptance |
| Peer | Does assigned work and returns evidence |
| Reviewer | The read-only seat: reviews and every read-only lane a skill opens |
| watcher | The small-model seat that sweeps activity when the plugin wakes it |
| seat | A harness profile with its Paseo provider, named for its role |
| harness | The coding agent hosting a role, described by `harness/<id>/harness.json` |
| brief / handoff | The Lead's assignment to a Peer / the Peer's report at the end |
| disposition | Engineer, Architect, Reviewer or Scout; Architect and Scout have `Owned scope none` |
| owned scope | The paths a Peer may write |
| acceptance | The Lead's or Human's decision that work is done |
| ExecPlan, ADR, review record | Records under `docs/`, shaped by `PLANS.md`, `ADR.md`, `REVIEW.md` |
| owner directive, advice, check | Messages to a Lead labeled `OWNER DIRECTIVE:`, `ADVICE:`, `CHECK:` |
| attention event | An `ATTENTION:` message the plugin brings the Supervisor |

`hidesWords` in `seats.json` keeps Supervisor, watcher, seat and Paseo out of the Peer's and
Reviewer's files, and the Supervisor out of the Lead's; setup checks it.

## Where sources disagree

- **Prompt or setting:** guides treat instructions as the mechanism; this kit puts what must hold
  in settings or the plugin, after Leads skipped prompted steps.
- **File length:** advice ranges from 60 to 500 lines; this kit uses 200 lines and 16 KB.
- **Disclosure depth:** one level, since a deep routing layer measured worse. [PD]
- **Multi-agent:** [MA] parallelizes, [COG] prefers one thread; this kit parallelizes reading and
  review and keeps one writer per scope.

## Sources

- [P] [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [O5] [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [M] [Claude Code memory](https://code.claude.com/docs/en/memory)
- [BP] [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [CE] [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [S] [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [SK] [Claude Code skills](https://code.claude.com/docs/en/skills)
- [OMP] [omp skills](https://omp.sh/docs/skills)
- [MA] [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [COG] [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents)
- [HL] [Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)
- [CUR] [Cursor rules](https://cursor.com/docs/context/rules)
- [IFS] [How many instructions can LLMs follow at once?](https://arxiv.org/abs/2507.11538)
- [LIM] [Lost in the middle](https://arxiv.org/abs/2307.03172)
- [DX] [Diátaxis](https://diataxis.fr/)
- [G] [Google developer documentation style guide: procedures](https://developers.google.com/style/procedures)
- [GP] [Google developer documentation style guide: placeholders](https://developers.google.com/style/placeholders)
- [GHR] [GitHub: About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [MS] [Microsoft Writing Style Guide: top 10 tips](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)
- [CR] [Context rot](https://www.trychroma.com/research/context-rot)
- [SR] [SkillReducer](https://arxiv.org/abs/2603.29919)
- [PD] [Is progressive disclosure all you need for long-context agents?](https://arxiv.org/abs/2607.17598)
- [RF] [Right family, wrong skill](https://arxiv.org/abs/2606.10388)
- [TP] [TokenPilot](https://arxiv.org/abs/2606.17016)
- [PC] [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
