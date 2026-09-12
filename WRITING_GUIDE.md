# Writing guide

These rules apply to everything in this kit: the seat prompts in `project/`, the templates in
`examples/`, and the docs. Scripts, hooks, and the guard extensions carry no comments or
docstrings (except the one `create_review_report.py` prints as its `--help`), so their reasons
live in REFERENCE.md, or in `harness/<id>/NOTES.md` when the reason is one coding agent's
behavior rather than the kit's. The Supervisor follows these rules when it patches a prompt. Each rule
names its source in brackets; the sources are listed at the end.

## Seat prompts

A seat prompt is loaded into context on every turn, so each line has to be worth its tokens.

1. Test every line: would the agent make a mistake without it? If not, cut it. Leave out what a
   capable model already knows and what it can learn by reading the code. [BP, S]
2. Stay under 200 lines and the 16 KB budget. Adherence drops as files grow, and instructions
   in a long list are dropped silently rather than refused. [M, IFS]
3. Write calm, plain instructions. A capable model follows the system prompt closely, and
   capitals or "MUST" make it over-apply a rule. Save emphasis for a single rule you have
   seen skipped. A prompt is read by whichever model its role's harness runs, so tune it to
   the weakest one you intend to use, not the strongest. [P, BP]
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
11. State scope explicitly. A strong model tends to widen a task, while a cheaper one reads the
    instruction literally; a prompt that names its scope survives both. [O5]
12. Name a runnable check instead of writing a generic "verify" or "double-check"; current
    models over-verify when told to. [O5]
13. Enforce hard limits outside the prompt, because a prompt is guidance, not enforcement: name
    the capability as an intent in `seats.json`, and let each harness map it to its own tool
    names under `deny.intents` or declare a guard that holds it under `deny.enforcedByGuard`.
    A limit no harness enforces is reported on every run rather than assumed, so write the
    prompt rule as if it were the only thing holding, because on some harnesses it is. Stronger
    limits go in a shared guard under `harness/common/guards/` (`lead-guard.sh`,
    `profile-guard.sh`, `watcher-guard.sh`, `skill-guard.sh`) or in a harness's guard extension
    (`peer-guard.ts`, `skill-gate.ts`). [M]
14. Write every `.md` to load unchanged on every harness: no HTML comments anywhere, and no
    harness's tool names. A maintainer note goes under "What each demo prompt expects you to
    add" in this guide, and a rule about a tool names what the tool does ("your read tool"), not
    what one harness calls it. The setup script refuses `<!--` in any prompt or skill and refuses
    `$ARGUMENTS` and `${CLAUDE_SKILL_DIR}`. Only a seat's profile is allowed to differ per
    harness. [M]
15. Add a rule only after an observed failure, with a reproducible reason and a removal trigger.
    [HL, CUR]
16. Name a skill a seat must not skip in `seats.json`'s `skillGates`, not only in the prompt,
    and only after a run skipped it. A gate refuses the call the skill owns until the skill is
    loaded and shows its `because` text, so write that text as the reason the step exists. It
    holds only on a harness whose `skillLoad.transcriptMatch` is set. [M]
17. Name no coding agent in a seat prompt, a skill, or a doc other than `harness/<id>/NOTES.md`.
    A role can move to another harness, and a prompt that names one goes stale silently. Where
    the behavior genuinely differs, cite the manifest field instead.

## What each demo prompt expects you to add

No `.md` here carries an HTML comment, by rule 14, so the notes that used to sit at the top of
each prompt live here instead. Every seat prompt is a demo file: the structure is real, the rules
are generic, and the value is your own. `setup-seats.fish` holds each to `promptBudget` in
`seats.json`; exceeding it is an error, and the fix is to cut, not to raise the budget.

| Prompt | What to extend, by section |
|---|---|
| `PEER.md` | Boundaries, the handoff's six fields, the evidence standard |
| `REVIEWER.md` | Findings, the axes a review covers, the handoff shape |
| `LEAD.md` | "Decisions that belong to the Human", with the ones your project reserves; the numbered Reviewer conditions, with the seams your `AGENTS.md` marks decide-first; acceptance conditions |
| `SUPERVISOR.md` | The signals worth a look, intervention rights, when a prompt patch is allowed |
| `WATCHER.md` | The trigger table. It runs on a small model and is re-read on every sweep, so keep it short: a small model loses rules faster than a large one as a prompt grows. The Supervisor changes the table only through its `protocol-patch` skill. |

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

## Skills

Skills live in `project/skills/<role>/`, and must work unchanged on every harness a role might
run on. Each role's set matches its altitude: strategy for the Supervisor, macro for the Lead,
micro for the Peer, and review for the Reviewer. [S, SK, PI]

1. Use only `name` (equal to the directory name: lowercase letters, digits, hyphens) and
   `description` in the frontmatter, plus `disable-model-invocation: true` for skills that run
   only when asked. Harnesses disagree on whether the command follows the directory or `name`,
   so the two must match.
2. Write the description as one double-quoted line of 200 to 400 characters, in the third
   person: what the skill does, then "Use when …", naming concrete triggers. It is the only
   part always in context, so every "when to use" belongs there and not in the body; every
   harness triggers on it, and none reads `when_to_use`. [S]
3. Keep `SKILL.md` under 500 lines, and move long catalogs and templates into `references/`,
   linked by a relative path that says when to read it. Keep references one level deep, because
   a harness may only preview a file reached from another; open one over 100 lines with a
   contents list. [S]
4. Refer to input as "the request given with this skill". Not every harness substitutes
   `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `` !`command` ``, or `@file`, and the setup script
   refuses the first two.
5. Add a procedure the seat prompt doesn't already carry, and name the artifact the skill
   produces and where it goes.
6. A skill carries none of the words its role's `hidesWords` lists in `seats.json`. The
   no-comment rule is not theirs alone: it applies to every skill.
7. Borrow mechanisms, not prose, from third-party skills, and record the source and its
   license in `NOTICE.md`.
8. Keep a seat's working context under about 50K tokens. Recall falls as input grows, well
   before a window is full: a model with a 200K window already degrades measurably around 50K,
   and it degrades on every model tested, so a long session invents rather than reports. A
   loaded skill never leaves the context, so the budget is the sum of every skill a seat loads
   plus the code it reads, not any one file. [CR, CE]
9. Put a section a seat reaches in a later turn in `references/`, not in `SKILL.md`: a fix-round
   cap read only when findings come back, a lane the seat picks against, a report format used
   after subagents report. It costs the same when reached, and nothing when it isn't, and it
   arrives after the planning turns can be compacted away. Keep the decision that chooses it,
   and the rule that matters most, in `SKILL.md`. [S, CE]
10. Put deterministic work in `scripts/`, not in prose: a script is run, not read, so only its
    output reaches the context, and it can't be paraphrased into a different procedure. Name the
    path as `SKILL_DIR/scripts/NAME`, say to run it, and keep its reasons in `REFERENCE.md`
    by the no-comment rule. `review_pack.py`, `create_review_report.py`, and `case.py` are the
    kit's own. [S]

## Terminology

Use these terms, and only these, for the following concepts:

| Term | Meaning |
|---|---|
| Human | The owner, who makes product decisions and irreversible calls |
| Supervisor | The seat that meets with the Human, relays decisions, observes, and keeps the notebook |
| Lead | The seat that owns one project: framing, delegation, acceptance |
| Peer | The seat that does assigned work and returns evidence |
| read-only Peer | The `peer-ro` seat: the Peer prompt and skills with edits blocked, for Architect, Scout, and council work |
| Reviewer | The read-only seat that reviews changes with Open Code Review; a brief's Reviewer disposition goes to it |
| seat | A harness profile together with its Paseo provider, named for its role |
| brief | The Lead's assignment to a Peer |
| handoff | The Peer's six-field report at the end of a task |
| disposition | The role a brief assigns: Engineer, Architect, Reviewer, or Scout |
| owned scope | The paths a Peer may write |
| acceptance | The decision, by the Lead or the Human, that work is done |
| owner directive | A message to a Lead, labeled `OWNER DIRECTIVE:`, that carries a Human decision |
| advice | A message to a Lead, labeled `ADVICE:`, that the Lead may dispute once with evidence |
| check | A neutral question, labeled `CHECK:`, that asks a Lead, or a Peer through its Lead, to look again at its work against a named source |
| attention event | A watcher's message to the Supervisor, labeled `ATTENTION:`, reporting a trigger in Lead or Peer activity |
| watcher | The `watcher` seat, on a small model, which sweeps Lead and Peer activity on a heartbeat and raises attention events |
| harness | The coding agent that hosts a role, described by `harness/<id>/harness.json` |
| skill gate | An entry in `seats.json`'s `skillGates` that refuses the call a skill owns until that skill is loaded |

`seats.json`'s `hidesWords` says which words each seat never sees, and the setup script checks
every prompt and skill against it: `.seatworks/PEER.md` and `.seatworks/REVIEWER.md` never use
Supervisor, watcher, seat, or Paseo, and `.seatworks/LEAD.md` never names the Supervisor.
`hidesPaths` adds the repository paths those seats may not read.

## Where sources disagree, and what this kit chose

- **Emphasis:** one guide discourages it, another allows it on a single line. None by default.
- **Prompt or guard:** the prompting guides treat instructions as the whole mechanism. This kit
  treats a prompt as guidance and puts anything that must hold in a deny list, a guard, or a
  skill gate, after two evaluation runs where a Lead skipped a skill its prompt named.
- **File length:** recommendations range from about 60 lines to 500. This kit uses 16 KB and
  roughly 200 lines.
- **Multi-agent or single thread:** [MA] parallelizes research, [COG] prefers a single thread.
  This kit parallelizes reading and review, and keeps each write scope to one writer.
- **Numbered headings:** [G] avoids them; SETUP.md links its steps from a numbered list instead.

## Sources

- [P] [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [O5] [Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
- [M] [Claude Code memory](https://code.claude.com/docs/en/memory)
- [BP] [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [CE] [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [S] [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [SK] [Claude Code skills](https://code.claude.com/docs/en/skills)
- [PI] [Pi skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)
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
- [CR] [Context rot: how increasing input tokens impacts LLM performance](https://www.trychroma.com/research/context-rot)
