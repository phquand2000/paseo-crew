# Writing rules for a patch

The rules a patch has to satisfy, so a change to a prompt, a protocol, or a skill reads the way
the rest of the project does. These are the project's copy; the kit's `WRITING_GUIDE.md` holds
the same rules for whoever maintains the kit, with the sources they came from.

## Contents

- [Every file](#every-file)
- [A seat prompt](#a-seat-prompt)
- [A skill](#a-skill)
- [A procedure](#a-procedure)

## Every file

1. Test every line: would an agent get this wrong without it? If not, cut it. Leave out what a
   capable model already knows and what it can learn by reading the code.
2. No comment of any kind. An agent whose harness shows comments reads a maintainer note as a
   rule, and setup refuses one in any prompt or skill.
3. Name no coding agent and no one agent's tool. A rule about a tool names what the tool does
   ("your read tool", "your shell"), never what one product calls it. Only a seat's profile is
   allowed to differ per agent.
4. One term per concept, from the project's vocabulary. When two files disagree, an agent may
   follow either.
5. Say what to do rather than what to avoid, and give the reason with the rule: a model
   generalizes from the reason. Where a limit has to be a prohibition, pair it with the action
   to take instead.
6. Make each rule checkable by naming the command, the field, or the threshold. "Run `X`" beats
   "test your changes"; a named check beats "verify".
7. Write heuristics, not if/else scripts. Be exact only where a mistake is costly.
8. State scope. A strong model widens a task and a cheap one reads literally; a rule that names
   its scope survives both.
9. Add a rule only after an observed failure, with its reason and what would retire it.

## A seat prompt

10. Open with one sentence that states the role, then go straight to behavior.
11. Stay under 200 lines and the byte budget `seats.json` sets. Adherence drops as a file grows,
    and a rule in a long list is skipped rather than refused.
12. Put the most important rules early, and restate the single most important one at the end.
13. Write calm, plain instructions. Capitals and "MUST" make a model over-apply a rule; save
    emphasis for one rule you have watched being skipped. Tune the wording to the weakest model
    the role runs on, not the strongest.
14. A prompt is guidance, not enforcement. Anything that must hold goes in the deny intents, a
    guard, or a skill gate, and the prompt rule is written as if it were the only thing holding,
    because on some agents it is.

## A skill

15. Frontmatter carries only `name`, equal to the directory name, and `description`, plus
    `disable-model-invocation: true` for a skill that runs only when asked.
16. The description is one double-quoted line of 200 to 400 characters, in the third person,
    saying what the skill does and then when to use it. It is the only part always in context,
    so it carries the whole routing decision; a generic phrase is never selected.
17. Keep the body under 500 lines, and move a long catalog or template into `references/`,
    linked by a relative path with the condition for reading it. Keep references one level deep.
18. A reference file longer than 100 lines opens with a table of contents.
19. Refer to input as "the request given with this skill": not every agent substitutes a
    placeholder, and the file has to load unchanged everywhere.
20. Add a procedure the seat prompt doesn't already carry, and name the artifact the skill
    produces and where it goes.

## A procedure

21. List the prerequisites before the first step, and introduce the steps with a sentence
    ending in a colon.
22. One action per numbered step, starting with an imperative verb, with any condition before
    the instruction.
23. End each step with a runnable **Done** check and its expected result.
24. State branches explicitly, say which steps are safe to repeat, and give a rollback.
25. Put commands in fenced blocks with a language tag, and write placeholders in
    `UPPER_SNAKE_CASE` with a line explaining each.
