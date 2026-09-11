# Writing guide

These rules apply to everything in this kit: the seat prompts in `claude/`, the templates in
`examples/`, the docs, and the comments in the setup script. The Supervisor follows them when it
patches a prompt. Each rule names its source in brackets; the sources are listed at the end.

## Seat prompts

A seat prompt is loaded into context on every turn, so each line has to be worth its tokens.

1. Test every line: would the agent make a mistake without it? If not, cut it. Leave out what a
   capable model already knows and what it can learn by reading the code. [BP, S]
2. Stay under 200 lines and the 16 KB budget. Adherence drops as files grow, and instructions
   in a long list are dropped silently rather than refused. [M, IFS]
3. Write calm, plain instructions. Current Claude models follow the system prompt closely, and
   capitals or "MUST" make them over-apply a rule. Save emphasis for a single rule you have
   seen skipped. [P, BP]
4. Say what to do rather than what to avoid. [P]
5. Give the reason with each rule; the model generalizes from the reason. [P]
6. Make each rule checkable by naming the command, field, or threshold. "Run `X`" works better
   than "test your changes". [M]
7. Write heuristics, not if/else scripts or vague advice. Be exact only where a mistake is
   costly. [CE, S]
8. Open with one sentence that states the role, then go straight to behavior. [P]
9. Put the most important rules early, and restate the single most important rule briefly at
   the end. [O5, LIM]
10. Use one term per concept, as listed under Terminology. When two layers contradict each
    other, the model may follow either one. [M, S]
11. State scope explicitly. Opus 5 tends to widen tasks, while other models read instructions
    literally. [O5]
12. Name a runnable check instead of writing a generic "verify" or "double-check"; current
    models over-verify when told to. [O5]
13. Enforce hard limits with `disallowedTools` or hooks, because a prompt is guidance, not
    enforcement. [M]
14. Put maintainer notes in HTML comments. Claude Code strips them from `CLAUDE.md` before
    loading, so they cost the seat nothing. [M]
15. Add a rule only after an observed failure, with a reproducible reason and a removal trigger.
    [HL, CUR]

## Delegation briefs and handoffs

1. Every brief states the objective, the output format, where to start looking, and the
   boundaries. Without them, sub-agents misread the task or duplicate each other's work. [MA]
2. Pass along decisions already made and approaches already ruled out, not just the task. [COG]
3. Scale effort to the task, and skip delegation when a few reads would answer the
   question. [MA, O5]
4. Give parallel writers disjoint scopes. [COG]
5. Keep handoffs condensed: put long logs in files and pass the paths. [CE, MA]
6. Ask Reviewers for every finding with severity and confidence, and filter afterwards. Current
   models follow "report only serious issues" literally and hold findings back. [O5]

## Human-facing docs

Classify each document by what its reader is doing, and keep the types apart. [DX]

- The README is a landing page: what the kit is, why it's useful, how to start, and where to
  go next. [GHR]
- SETUP.md is a how-to guide containing only actions.
- REFERENCE.md is reference material: facts to look up, each entry in the same pattern.

When you write a procedure: [G]

- List the prerequisites before the first step.
- Introduce the procedure with a sentence that ends in a colon.
- Put one action in each numbered step, start it with an imperative verb, and put any
  condition before the instruction.
- End each step with a runnable **Done** check and its expected result.
- State branches explicitly ("If X, go back to …"), note which steps are safe to repeat, and
  give a rollback.
- Put commands in fenced code blocks with a language tag.

In general, write in the second person, active voice, and present tense. Use sentence-case
headings without numbers, code font for commands, paths, and values, and link text that
describes its target. [G, MS]

## Templates

- Name placeholders in `UPPER_SNAKE_CASE`, and explain each one under "Replace the
  following". [GP]
- Put copyable template content in a fenced block, so the instructions around it aren't
  copied along with it.

## Script comments

Explain why, not what. Comment workarounds and non-obvious behavior, and delete comments that
have gone stale. [SO]

## Terminology

Use these terms, and only these, for the following concepts:

| Term | Meaning |
|---|---|
| Human | The owner, who makes product decisions and irreversible calls |
| Supervisor | The seat that meets with the Human, relays decisions, observes, and keeps the notebook |
| Lead | The seat that owns one project: framing, delegation, acceptance |
| Peer | The seat that does assigned work and returns evidence |
| seat | A Claude Code profile together with its Paseo provider |
| brief | The Lead's assignment to a Peer |
| handoff | The Peer's six-field report at the end of a task |
| disposition | The role a brief assigns: Engineer, Architect, Reviewer, or Scout |
| owned scope | The paths a Peer may write |
| acceptance | The decision, by the Lead or the Human, that work is done |

`PEER.md` never uses Lead, Supervisor, seat, or Paseo. It calls the sender of a brief "the
assigner".

## Where sources disagree, and what this kit chose

- **Emphasis:** Anthropic's prompting guide discourages it, while the Claude Code best
  practices allow it on a single line. This kit uses none by default.
- **File length:** recommendations range from about 60 lines to 500. This kit uses 16 KB and
  roughly 200 lines.
- **Multi-agent or single thread:** Anthropic parallelizes research, while Cognition prefers a
  single thread. This kit parallelizes reading and review, and keeps each write scope to one
  writer.
- **Numbered headings:** Google's style guide avoids them. SETUP.md follows it and links its
  steps from a numbered list instead.

## Sources

- [P] [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [O5] [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [M] [Claude Code memory](https://code.claude.com/docs/en/memory)
- [BP] [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [CE] [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [S] [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
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
- [SO] [Best practices for writing code comments](https://stackoverflow.blog/2021/12/23/best-practices-for-writing-code-comments/)
