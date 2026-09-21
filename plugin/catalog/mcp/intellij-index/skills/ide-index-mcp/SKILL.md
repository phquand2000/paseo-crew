---
name: ide-index-mcp
description: How to navigate and refactor code with the intellij-index MCP tools. Use before a code search, a rename, a move, a delete or a signature change, and whenever an ide_ tool returns something unexpected.
---

# IntelliJ index tools

The intellij-index tools give semantic answers from the IDE's index: they understand types, imports,
overrides and references, where grep and find only see text. Each call already targets your own
working copy: the IDE opens it, waits for indexing and picks up files changed outside the IDE, so
never pass a project path and never wait or sync yourself.

## Which tool

| Task | Use | Text tools |
|------|-----|------------|
| Find a class, method, field or function by name | `ide_find_symbol` | Only when the tool says the IDE can't serve the working copy |
| Find a file by name | `ide_find_file` | Fine for a simple glob |
| Find text in code | `ide_search_text` | Fine outside indexed code: configs, logs, data |
| All usages of a symbol | `ide_find_references` | Never: grep misses aliased imports and overrides and matches comments |
| Who calls a method, and what it calls | `ide_call_hierarchy` | Never |
| Jump to a declaration | `ide_find_definition` | Never |
| A resolved signature or doc comment, library symbols included | `ide_symbol_info` | Never |
| Inheritance of a class | `ide_type_hierarchy` | Never |
| Implementations of an interface or abstract method | `ide_find_implementations` | Never |
| What a method overrides | `ide_find_super_methods` | Never |
| Errors and warnings in a file | `ide_diagnostics` | Never |
| Rename a symbol or file everywhere | `ide_refactor_rename` | Never: sed and hand edits break references |
| Move a file and fix its imports | `ide_move_file` | Never: mv and git mv bypass the IDE |
| Delete a symbol or file after checking usages | `ide_refactor_safe_delete` | Never |
| Change a Java or Kotlin method signature and its callers | `ide_change_signature` | Never |
| Read a file | your own read tool | |

A role gets only the tools its work needs, so some rows may not apply to you.

## Parameters

1. Line and column are 1-based.
2. Project files are relative to the working copy root, such as `src/main/java/App.java`. When a tool
   returns a library path or a `jar://` URL, pass it back unchanged.
3. The column must land on the symbol name, not on whitespace or punctuation. For `json.dumps()`,
   point at `dumps` to reach the member.
4. `ide_find_definition` and `ide_symbol_info` return a `symbolId`; pass it alone to either tool, or to a
   refactoring, instead of repeating file, line and column. After `SYMBOL_ID_EXPIRED`, look it up again.
5. `scope` narrows searches: `project_files` (default), `project_and_libraries`,
   `project_production_files` or `project_test_files`.
6. `paths` narrows `ide_search_text` and `ide_find_references` to globs, with `!` to exclude, such as
   `["src/main/**", "!**/*Test.kt"]`. One scoped call beats filtering a project-wide result yourself.
7. `ide_search_text` is a plain substring search unless you pass `"regex": true`.

## Refactoring

1. Preview first: `ide_refactor_rename`, `ide_refactor_safe_delete` and `ide_change_signature` take
   `dryRun: true`. Check `canApply`, `affectedFiles`, usages, conflicts and warnings.
2. Apply with a second call only when the preview is what you want.
3. Run `ide_diagnostics` on the affected files, then the project's checks.

Never pass `generateDelegate: true` to `ide_change_signature`: a method kept with the old signature is
a compatibility layer, and nothing here has shipped. Never pass `force: true` to
`ide_refactor_safe_delete`; fix or remove the usages it reports instead.

`ide_refactor_safe_delete` and `ide_change_signature` are reliable for Java and Kotlin; for other
languages preview them and read the result before applying.

## When a result looks wrong

- An error saying the IDE is still indexing, can't open the working copy or isn't reachable: take its
  advice. Retrying the same call later is fine; don't guess from grep that a symbol has no usages.
- Empty or partial results right after editing files: call the tool again once; the index catches up
  on the next call.
- An error naming a switched-off tool: use another tool from the table.

For every parameter and return field of a tool, read `references/tools-reference.md`.
