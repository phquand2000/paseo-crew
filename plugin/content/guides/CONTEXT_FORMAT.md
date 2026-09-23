# The project's CONTEXT.md

What this project does, for whom, how it behaves, and the words it is spoken of in, as the Human
settled them. Every Lead reads it as the Human's word, so it holds nothing else.

```md
# <project>

<one or two sentences: what it is and who it is for>

## Language

**<Term>**:
<what it is, in one or two sentences>
_Avoid_: <other words people use for it>

## Behavior

- <how the project behaves in one case that matters, as the Human put it>

## Not doing

- <what the project will not do>
```

- **Only what the Human said or confirmed.** Stack, design, tests, process and sequencing are yours
  to decide and do not go here. An inference the Human has not confirmed is a question, not a line.
- **No implementation.** No files, modules, APIs, schemas or libraries: a Lead finds those in the
  code, and written here they go stale and are still believed. The exception is an interface the
  Human named (a function, a field, a format callers see): that is their word, written as they said.
- **Current, not history.** When the Human changes an answer, replace the line where it stands. The
  old answer is gone because it is no longer true.
- **Tight.** One or two sentences an entry. A term goes in only when it is specific to this project,
  and the best word for it wins, with the others under _Avoid_. Group entries under subheadings once
  clusters appear.
- **Short enough to read whole** at the start of every lane. Past about eighty lines, fold entries
  into the rule they are instances of rather than dropping the oldest.
- **The repository's own comes first.** If it keeps a `CONTEXT.md` or `CONTEXT-MAP.md`, that is the
  Human's too: read it, write here only what it does not say, and when the two disagree ask the Human
  rather than choosing.
- **A repository with `docs/product/` keeps the Human's word there.** Write what the Human settles
  into that directory, in the form its files already use, and keep this file only for what does not
  belong to the repository: which lanes to run, not how the product behaves. The rules above still
  hold for what you write there.
