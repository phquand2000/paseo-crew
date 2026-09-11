# Questionnaire template

Use this template when the Human answers later. Because an async answer may come in one pass,
put the question whose answer changes the most other answers first.

Copy the block below to `.seatworks/records/questionnaires/YYYY-MM-DD-SLUG.md`:

````md
# TITLE

**Decision riding on this:** DECISION
**How your answers are used:** they become the directive for the Lead of PROJECT; anything left
blank stays open, and the Lead doesn't start on it.

## Context

CONTEXT

## How to answer

Write under each `>`. A partial answer, or "not sure", helps more than a skipped question. If
you accept the recommendation, write "ok".

## THEME

### QUESTION

Recommended: RECOMMENDATION, because REASON

_Why this matters: WHY_IT_MATTERS_

>

## Anything else

Is there anything we didn't ask that the Lead should know?

>
````

Replace the following:

- `TITLE`: the outcome under discussion, for example `Scope of the billing export`.
- `DECISION`: the decision these answers settle, in one sentence.
- `PROJECT`: the project whose Lead receives the directive.
- `CONTEXT`: one paragraph with what you already know from the repository and the notebook, so
  the Human doesn't have to answer from memory.
- `THEME`: a group of related questions. Use themes once there are more than five questions, and
  order both the themes and the questions within them most important first.
- `QUESTION`: one idea per question, never two joined by "and".
- `RECOMMENDATION` and `REASON`: your recommended answer and the reason for it.
- `WHY_IT_MATTERS`: include it only where the question could be misread or could invite a
  throwaway answer; otherwise delete the line.
