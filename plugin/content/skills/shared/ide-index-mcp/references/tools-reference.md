# IDE Index MCP - Tools Reference

Parameter reference for the intellij-index tools this team uses. The team's server fills in the working copy for every call.

## Common Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | For project files, path relative to project root (e.g., `src/main/App.java`). Some read-only position-based navigation tools also accept dependency/library paths returned by the plugin as absolute paths or `jar://` URLs; check each tool section because support is tool-specific. |
| `line` | integer | **1-based** line number |
| `column` | integer | **1-based** column number. Place on the symbol name, not whitespace. For dotted expressions like `json.dumps()` or `os.path.join()`, point to the member token (`dumps`, `join`) when targeting the member definition. |
| `language` | string | Language of the symbol (e.g., `"Java"`, `"PHP"`). Required when using `symbol`. |
| `symbol` | string | Fully qualified symbol reference. Java format: `com.example.ClassName`, `com.example.ClassName#memberName`. PHP format: `\\App\\Service\\UserService`, `\\App\\Service\\UserService::method()`, `\\App\\Service\\UserService::CONSTANT`, `\\App\\Service\\UserService::$property`, `\\App\\Service\\StatusEnum::ACTIVE`. PHP properties require the `$property` form; plain `::name` resolves enum cases (on enum types), constants, or methods. Python format: see **Python symbol grammar** below. |

**Handle identity:** Definition and metadata lookups preserve the exact stored PSI target.
Declarations without their own source text use a source-context preview. Deleting and recreating
a file at the same path expires its old handles; rediscover it after `SYMBOL_ID_EXPIRED`.

**Symbol reference:** Some tools accept `language` + `symbol` as an alternative to `file` + `line` + `column`. The two groups are **mutually exclusive**. Supported languages: Java, PHP, JavaScript, TypeScript, Python. Unsupported languages are rejected explicitly; use `file` + `line` + `column` for other languages.

**Python symbol grammar:** Symbols must be module-qualified (dotted path with ≥2 segments):
- `pkg.mod.ClassName` — class
- `pkg.mod.function_name` — module-level function
- `pkg.mod.ClassName.method_name` — method (resolved via the function index; a method's qualified name is `pkg.mod.ClassName.method`)
- `pkg.mod.ClassName#member_name` — method (inherited), class/instance attribute, or `@property` of the named class

Parameter lists are not supported (Python has no overload-by-signature); bare unqualified names are rejected — use `file` + `line` + `column` for those.

**JavaScript/TypeScript symbol grammar (v1):** Symbols must be module-qualified in one of these forms:
- `modulePath#exportName` — named export (e.g., `src/utils#formatDate`)
- `modulePath#default` — default export (e.g., `src/index#default`)
- `modulePath#ClassName.memberName` — class member (e.g., `src/models#User.validate`)

**Deterministic outcomes for JS/TS symbol resolution:**
- `unsupported_grammar` — symbol does not match accepted forms
- `not_found` — module path resolved but symbol not found in exports/members
- `ambiguous_match` — multiple matching exports/members across candidate files

**Fallback TypeScript cases:** Use `file` + `line` + `column` for local non-exported symbols, local import aliases, npm/package symbols, unresolved barrel/re-export chains, or any target that cannot be represented as a stable module-qualified export.

**Example fallback:**
```json
{
  "file": "src/utils/math.ts",
  "line": 18,
  "column": 12
}
```

**Note:** Module-qualified lookup remains v1 grammar and bounded; unsupported cases should fall back to `file` + `line` + `column`.

## Response Format

All tools return: `{ "content": [{"type": "text", "text": "<JSON>"}], "isError": false|true }`

Parse the `text` field as JSON for structured data.

---

## Navigation Tools

### ide_find_references
Find all usages of a symbol (semantic, not text search).

**Target (mutually exclusive):** `file`+`line`+`column` OR `language`+`symbol`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column. Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. Required for symbol-based lookup. |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `includeGenerated` | boolean | no | Include references in generated sources (KSP/Dagger/annotation-processor output). **Default true** — keeps valid runtime references (Dagger/MapStruct/gRPC/serializers). Set false to drop generated call sites when they dominate results on injected symbols. |
| `paths` | array | no | Project-relative path globs restricting results, e.g. `["src/main/**", "!**/generated/**"]`. `*` matches within a segment, `**` crosses directories, a plain directory includes everything beneath it, `!` excludes. Composes with `scope`. An include glob whose literal prefix does not exist (or resolves under a different relative name) errors instead of returning zero results. Include globs also drop library/jar hits under `project_and_libraries`; `\` separators are normalized to `/` |
| `maxResults` | integer | no | Deprecated alias for `pageSize`. Default 100, max 500 |
| `cursor` | string | no | Pagination cursor from a previous response. When provided, search parameters are ignored; `pageSize` may still be provided. |
| `pageSize` | integer | no | Results per page. Default 100, max 500 |

**Returns**: `{ usages: [{ file, line, column, context, type, astPath }], totalCount, totalIsExact, resolvedSymbol, truncated, nextCursor?, hasMore, totalCollected, offset, pageSize, stale }`
**Pagination note**: `truncated` mirrors `hasMore`; when `hasMore` is `true`, pass `nextCursor` to fetch the next page.
**Resolution note**: `resolvedSymbol` echoes the declaration that was actually searched — positions on comments or whitespace snap to the nearest enclosing named element, so check it matches the symbol you intended. When `totalIsExact` is `false`, `totalCount` is a lower bound.
**type values**: `METHOD_CALL`, `FIELD_ACCESS`, `IMPORT`, `PARAMETER`, `VARIABLE`, `REFERENCE`

### ide_find_definition
Go to where a symbol is defined.

**Target (mutually exclusive):** top-level `symbolId` OR `file`+`line`+`column` OR `language`+`symbol`; this tool also accepts the equivalent nested `target`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | conditional | Exactly one of `symbolId`, `position` (`file`, `line`, `column`), or `qualifiedName` + `language`. Do not combine with top-level selectors. |
| `symbolId` | string | conditional | Opaque handle returned by this tool or `ide_symbol_info`. Pass it alone to resolve the exact target after edits or rename. |
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column. Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. Required for symbol-based lookup. |
| `fullElementPreview` | boolean | no | Return full element code (default false) |
| `maxPreviewLines` | integer | no | Max lines for full preview (default 50, max 500) |

**Returns**: `{ symbolId, file, line, column, preview, symbolName, astPath }`
Handles: packages, compiled classes, library sources (jar: URLs).

### ide_symbol_info
Resolved signature and documentation of the symbol at a position — the declaration facts
`ide_find_definition` cannot give, because its preview is source text with unresolved short type
names and no doc comment.

**Target (mutually exclusive):** top-level `symbolId` OR `file`+`line`+`column` OR `language`+`symbol`; this tool also accepts the equivalent nested `target`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | conditional | Exactly one of `symbolId`, `position` (`file`, `line`, `column`), or `qualifiedName` + `language`. Do not combine with top-level selectors. |
| `symbolId` | string | conditional | Opaque handle returned by this tool or `ide_find_definition`. Pass it alone to resolve the exact target after edits or rename. |
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column. Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. Required for symbol-based lookup. |
| `includeDoc` | boolean | no | Include the rendered doc comment. Default true |
| `maxDocLength` | integer | no | Truncate documentation beyond this many characters. Default 4000, max 20000 |

**Returns**: `{ symbolId, name, kind, qualifiedName, signature, signatureSource, parameters: [{name, type}], returnType, typeParameters, thrownTypes, modifiers, visibility, containingDeclaration, documentation, documentationTruncated, file, line, column, language }`

**Handles**: `symbolId` values expire on server restart, project close, deletion, one hour of inactivity, or LRU eviction;
self-navigating synthetic targets also expire after their backing source file changes. Rediscover
after `SYMBOL_ID_EXPIRED`. Handles are non-canonical and must not be compared for equality.

**Type resolution**: `signatureSource` says how far the types were resolved.
- `java_psi` — Java declarations. Parameter and return types are fully qualified
  (`java.util.List<com.example.Request>`), and `parameters` / `returnType` are populated.
- `quick_navigation` — any language with a documentation provider (Kotlin, Python, JS/TS, Go, PHP,
  Rust). The signature is what that language's Quick Documentation renders; type names may be short
  and the structured fields are absent.
- `element_text` — no documentation provider answered; the declaration's own source line.

**Overloads**: address them by position — each overload's own `line`/`column` selects it.

**Chaining**: on the `java_psi` path `qualifiedName` is in this plugin's `symbol` format and can be
passed straight to `ide_find_references`, `ide_call_hierarchy`, or `ide_find_implementations` as
`symbol`. A callable includes its resolved parameter list (`com.example.Service#handle(com.example.Request)`),
because the bare name is rejected as ambiguous once a method is overloaded. On the
`quick_navigation` / `element_text` paths the container is a best-effort dotted AST path, not a
resolved FQN, so it is descriptive rather than round-trippable — address those by position.

### ide_find_file
Search for files by name using IDE's file index. Equivalent to Ctrl+Shift+N / Cmd+Shift+O.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | File name pattern |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `includeGenerated` | boolean | no | Include files under generated sources (KSP/Dagger/annotation-processor output). Default false |
| `limit` | integer | no | Deprecated alias for `pageSize`. Default 25, max 500 |
| `cursor` | string | no | Pagination cursor from a previous response. When provided, search parameters are ignored; `pageSize` may still be provided. |
| `pageSize` | integer | no | Results per page. Default 25, max 500 |

**Returns**: `{ files: [{name, path, directory}], totalCount, query }`
**Path note**: Project results use relative paths. Dependency/library results may use absolute paths or `jar://` URLs.

### ide_search_text
Search for text using IntelliJ Find in Files. Plain-text queries do substring matching (e.g. `a_word` finds `a_word_and_another_word`); regex queries use regular expression matching.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | conditional | Text to search for; substring match unless `regex` is true. Required for fresh search, ignored when `cursor` is provided |
| `regex` | boolean | no | Treat `query` as a regular expression. Default false |
| `context` | enum | no | `all` (default), `code`, `comments`, `strings` |
| `caseSensitive` | boolean | no | Default true |
| `wholeWord` | boolean | no | Match whole words only. Default false (substring match) |
| `filePattern` | string | no | IntelliJ file mask, e.g. `*.kt`, `*.java,!*Test.java` |
| `paths` | array | no | Project-relative path globs restricting the search, e.g. `["src/main/kotlin/**/handlers/**", "!**/*Test.kt"]`. `*` matches within a segment, `**` crosses directories, a plain directory includes everything beneath it, `!` excludes. Composes with `filePattern`. An include glob whose literal prefix does not exist (or resolves under a different relative name) errors instead of returning zero matches. Include globs also drop library/jar hits under `project_and_libraries`; `\` separators are normalized to `/` |
| `limit` | integer | no | Deprecated alias for `pageSize`. Default 100, max 500 |
| `cursor` | string | no | Pagination cursor from a previous response. When provided, search parameters are ignored; `pageSize` may still be provided. |
| `pageSize` | integer | no | Results per page. Default 100, max 500 |

**Returns**: `{ matches: [{file, line, column, context}], totalCount, query, nextCursor?, hasMore, totalCollected, offset, pageSize, stale }`
**Pagination note**: when `hasMore` is `true`, pass `nextCursor` to fetch the next page.

### ide_find_implementations
Find implementations of interfaces, abstract classes, or abstract methods.

**Target (mutually exclusive):** `file`+`line`+`column` OR `language`+`symbol`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column. Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. For JS/TS, use module-qualified forms: `modulePath#exportName`, `modulePath#default`, or `modulePath#ClassName.memberName`. Required for symbol-based lookup. |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `includeGenerated` | boolean | no | Include implementations in generated sources (KSP/Dagger/annotation-processor output). Default false |
| `cursor` | string | no | Pagination cursor from a previous response. When provided, search parameters are ignored; `pageSize` may still be provided. |
| `pageSize` | integer | no | Results per page. Default 100, max 500 |

**Returns**: `{ implementations: [{name, file, line, column, kind, language}], totalCount, nextCursor?, hasMore, totalCollected, offset, pageSize, stale }`
**Languages**: Java, Kotlin, Python, JS/TS, PHP, Rust (not Go).

### ide_find_symbol
Search for any code symbol (classes, methods, fields, functions) by name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Symbol name pattern. Matching follows IntelliJ's Go to Symbol popup, including qualified queries like `BasicSolver.run`. |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `language` | string | no | Filter by language |
| `includeGenerated` | boolean | no | Include symbols from generated sources (KSP/Dagger/annotation-processor output). Default false |
| `limit` | integer | no | Deprecated alias for `pageSize`. Default 25, max 500 |
| `cursor` | string | no | Pagination cursor from a previous response. When provided, search parameters are ignored; `pageSize` may still be provided. |
| `pageSize` | integer | no | Results per page. Default 25, max 500 |

**Returns**: `{ symbols: [{name, qualifiedName, file, line, kind, language}], totalCount, query }`
**Languages**: Java, Kotlin, Python, JS/TS, Go, PHP, Rust, plus other IDE-supplied symbol contributors where available.
**Path note**: Project results use relative paths. Dependency/library results may use absolute paths or `jar://` URLs.

### ide_find_super_methods
Find parent methods that a given method overrides or implements.

**Target (mutually exclusive):** `file`+`line`+`column` OR `language`+`symbol`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column (anywhere in method body works). Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. For JS/TS, use module-qualified forms: `modulePath#exportName`, `modulePath#default`, or `modulePath#ClassName.memberName`. Required for symbol-based lookup. |

**Returns**: `{ method: {name, class, file, line}, hierarchy: [{name, class, file, line, isInterface}], totalCount }`
**Languages**: Java, Kotlin, Python, JS/TS, PHP (NOT Go, Rust).

### ide_type_hierarchy
Get complete type inheritance hierarchy (supertypes and subtypes).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `className` | string | no | FQN (preferred, faster). E.g., `com.example.MyClass` |
| `file` | string | no | Alternative: project-relative file path. Unlike other read-only navigation tools, `ide_type_hierarchy` file mode does not resolve dependency/library absolute paths or `jar://` URLs. |
| `line` | integer | no | Required with file |
| `column` | integer | no | Required with file |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `includeGenerated` | boolean | no | Include supertypes/subtypes in generated sources (KSP/Dagger/annotation-processor output). Default true — keeps generated types in the hierarchy |

**Provide either** `className` **or** `file`+`line`+`column`.
**Returns**: `{ element: {name, file, kind, language, supertypes?}, supertypes: [{name, file, kind, language, supertypes?}], subtypes: [{name, file, kind, language, supertypes?}] }`
**Languages**: Java, Kotlin, Python, JS/TS, PHP, Rust.

### ide_call_hierarchy
Build call tree showing who calls a method or what a method calls.

**Target (mutually exclusive):** `file`+`line`+`column` OR `language`+`symbol`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | conditional | Project-relative file path, or a dependency/library absolute path or `jar://` URL previously returned by the plugin. Required for position-based lookup. |
| `line` | integer | conditional | 1-based line. Required for position-based lookup. |
| `column` | integer | conditional | 1-based column. Required for position-based lookup. |
| `language` | string | conditional | Symbol language (e.g., `"Java"`). Required for symbol-based lookup. |
| `symbol` | string | conditional | Fully qualified symbol reference. For JS/TS, use module-qualified forms: `modulePath#exportName`, `modulePath#default`, or `modulePath#ClassName.memberName`. Required for symbol-based lookup. |
| `direction` | enum | yes | `callers` or `callees` |
| `depth` | integer | no | Recursion depth (default 3, max 5) |
| `scope` | enum | no | One of `project_files` (default), `project_and_libraries`, `project_production_files`, `project_test_files` |
| `includeGenerated` | boolean | no | Include callers/callees in generated sources (KSP/Dagger/annotation-processor output). Default true |

**Returns**: `{ element: {name, file, line, column, language}, calls: [{name, file, line, column, language, children: [...]}] }`

## Intelligence Tools

### ide_diagnostics

Get code diagnostics from multiple sources: one `file` or a small `files` batch, build output from the last build, and test results from open test run tabs. At least one source must be active: provide exactly one of `file`/`files` for code analysis, `includeBuildErrors` for build output, or `includeTestResults` for test results. Sources can be combined.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | no | One project-relative or in-project absolute path. Mutually exclusive with `files` |
| `files` | string[] | no | Up to 100 supplied relative or in-project absolute paths under one shared timeout budget. Aliases/duplicates are tolerated and analyzed once. Mutually exclusive with `file` |
| `line` | integer | no | For intention lookup (default 1, single `file` only) |
| `column` | integer | no | For intention lookup (default 1, single `file` only) |
| `startLine` | integer | no | Filter problems to range (single `file` only) |
| `endLine` | integer | no | Filter problems to range (single `file` only) |
| `includeBuildErrors` | boolean | no | Include errors/warnings from the last build. Default false |
| `includeTestResults` | boolean | no | Include test results from open test run tabs. Default false |
| `severity` | enum | no | Filter by severity across all sources: `all` (default), `errors`, `warnings` |
| `maxProblems` | integer | no | Max code problems returned across the file(s). Default 100, max 500 |
| `testResultFilter` | enum | no | Filter test results: `failed` (default) or `all` |
| `maxBuildErrors` | integer | no | Max build errors to return. Default 100, max 500 |
| `maxTestResults` | integer | no | Max test results to return. Default 100, max 500 |

**Returns**: `{ problems: [{message, severity, file, line, column, endLine?, endColumn?}], intentions?, problemCount, problemsTruncated?, intentionCount?, analysisFresh?, analysisTimedOut?, analysisMessage?, analysisMode?, fileAnalyses?: [{file, state, reason?, mode?, problemCount, problemsTruncated}], buildErrors?, buildErrorCount?, buildWarningCount?, buildErrorsTruncated?, buildTimestamp?, testResults?, testResultsTruncated?, testSummary? }`
**Output cap**: At most `maxProblems` code problems across the response. Aggregate/per-file `problemsTruncated` flags known omissions; per-file `problemCount` counts only returned problems. Re-query a truncated path with `file`, narrowing `startLine`/`endLine` if needed.
**Notes**: File paths preserve literal leading/trailing whitespace. Single-file mode keeps legacy top-level metadata and supports intentions/range filters. Multi-file entries use `analyzed`, `timed_out`, `failed`, `skipped` (not eligible), `not_analyzed` (not started before the shared deadline), or `not_found`; path resolution consumes the shared deadline, and aliases/duplicates are resolved once. Open files use fresh daemon highlights; closed files use public batch analysis. The complete single-file operation is timeout-bounded too, including refresh, PSI setup, and analysis-lock waits. A daemon that reports it did not run can fall back to batch analysis within the remaining budget; a daemon that consumes the timeout does not start a second batch budget.
**Severity levels**: `ERROR`, `WARNING`, `WEAK_WARNING`

## Refactoring Tools

### ide_refactor_rename

Rename a symbol or file and update ALL references (semantic rename, not find-replace). Works across ALL languages.

**Target:** `file` + `targetType="file"` for file rename; for symbol rename use `symbolId`, or `file` + `targetType="symbol"` + `line` + `column`. Without `targetType`, legacy `null/null => file` and `line`+`column => symbol` behavior remains.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | conditional | Structured symbol selector containing exactly one of `symbolId`, `position: {file, line, column}`, or `qualifiedName` + `language`. Mutually exclusive with legacy top-level selectors. |
| `symbolId` | string | conditional | Exact symbol handle. Mutually exclusive with `file`/coordinates. |
| `file` | string | conditional | Relative file path. Required for position-based lookup. |
| `language` | string | conditional | Legacy qualified-name selector language; requires `symbol`. |
| `symbol` | string | conditional | Legacy qualified symbol name; requires `language`. |
| `targetType` | string | no | `symbol` or `file`. When `file`, placeholder `line`/`column` values are ignored. |
| `line` | integer | no | 1-based line for symbol rename. |
| `column` | integer | no | 1-based column for symbol rename. |
| `newName` | string | yes | New name for the symbol |
| `overrideStrategy` | enum | no | `rename_base` (default), `rename_only_current`, `ask` |
| `relatedRenamingStrategy` | enum | no | Controls automatic renaming of related symbols (same-named properties, getters/setters, test classes, variables): `all` (default) renames all related symbols, `none` renames only the targeted symbol, `accessors_and_tests` renames only getters/setters and test classes/methods, `ask` shows the IDE dialog for each related rename |
| `dryRun` | boolean | no | Resolve/validate and discover usages/conflicts without writing or saving files. Default false |

**Returns**: `{ success, affectedFiles: [paths], changesCount, message, updatedSymbol? }`
**Returns with `dryRun: true`**: common preview shape; rename `plannedChange` contains `{operation: "rename", targetType, from, to, overrideStrategy, relatedRenamingStrategy}`. Constructors resolve to the containing class for preview and apply. Destination conflicts include implicit Java file renames and existing directories.
**Auto-renames**: getters/setters, overriding methods, constructor params <-> fields, test classes.
**Supports IDE undo** (Ctrl+Z).

### ide_move_file
Move a file to a new directory. Applies language-aware reference, import, and package/namespace updates only when the IDE provides a semantic move backend for that file type.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | yes | Relative path of file to move |
| `destination` | string | yes | Target directory (relative to project root, created if needed) |

**Returns**: `{ success, affectedFiles: [paths], changesCount, message }`
**Supports IDE undo** (Ctrl+Z).

### ide_refactor_safe_delete (Java, Kotlin)

Delete a symbol or file, checking for usages first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | conditional | Structured symbol selector containing exactly one of `symbolId`, `position: {file, line, column}`, or `qualifiedName` + `language`. Mutually exclusive with legacy top-level selectors. |
| `symbolId` | string | conditional | Exact symbol handle for `target_type="symbol"`. Mutually exclusive with coordinates. |
| `file` | string | conditional | Relative file path. Required for position-based symbol deletion and file deletion. |
| `language` | string | conditional | Legacy qualified-name selector language; requires `symbol`. |
| `symbol` | string | conditional | Legacy qualified symbol name; requires `language`. |
| `line` | integer | conditional | Required with `file` for position-based symbol deletion |
| `column` | integer | conditional | Required with `file` and `line` for position-based symbol deletion |
| `target_type` | enum | no | `symbol` (default) or `file` |
| `force` | boolean | no | Force delete even with usages (default false). Leave it false; fix or remove the usages instead |
| `dryRun` | boolean | no | Resolve target and discover usages/blockers without deleting or saving. Default false |

**Returns (success)**: `{ success, affectedFiles, changesCount, message, invalidatedSymbolId? }`
**Returns (blocked)**: `{ canDelete: false, elementName, usageCount, blockingUsages: [...], message }`
**Returns with `dryRun: true`**: common preview shape; `plannedChange` contains `{operation: "safeDelete", targetType, name, force}`. Usages contribute to `conflictCount`; without `force`, they make `canApply` false. A failed usage search is inapplicable unless `force` explicitly overrides it. Files with no discovered top-level declaration retain their existing apply eligibility and report an incomplete-discovery warning. Preview leaves `symbolId` valid. Generated Kotlin JVM methods without a matching standalone source declaration are rejected in preview and apply, including with `force`; select the intended source declaration explicitly.
**Only available in**: IntelliJ IDEA, Android Studio (requires Java plugin).

### ide_change_signature

Change method signature (name, return type, visibility, parameters) with automatic caller updates.

**Languages:** Java methods and Kotlin JVM functions. Select Kotlin functions by source position or
`symbolId`; override changes start at the base declaration and update implementations and callers.
Preview reports the base target without rebinding the original override's handle. After apply,
`updatedSymbol` preserves that handle's declaration when it remains available.

Preview and apply refuse conflicts, incomplete discovery, read-only scope, and missing defaults
for new required caller/delegate arguments. Return-type changes with overriders are conservatively
refused, including cases where narrower overriding types could safely remain unchanged.
Java override targets do not redirect to the base; select the base explicitly for hierarchy-wide
changes to avoid breaking the override contract.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | object | conditional | Structured method selector containing exactly one of `symbolId`, `position: {file, line, column}`, or `qualifiedName` + `language`. Mutually exclusive with legacy top-level selectors. |
| `symbolId` | string | conditional | Exact method handle. Mutually exclusive with coordinates. |
| `file` | string | conditional | Relative file path containing the method. Required without `symbolId`. |
| `line` | integer | conditional | 1-based line of the method. Required without `symbolId`. |
| `column` | integer | conditional | 1-based column on the method name. Required without `symbolId`. |
| `language` | string | conditional | Legacy qualified-name selector language; requires `symbol`. |
| `symbol` | string | conditional | Legacy qualified method name; requires `language`. |
| `newName` | string | no | New method name (unchanged if omitted) |
| `newReturnType` | string | no | New return type (unchanged if omitted) |
| `newVisibility` | string | no | `public`, `protected`, `private`, or `package-private` (`package-local` is a legacy alias; unchanged if omitted) |
| `newParameters` | array | no | Array of `{ oldIndex, name, type, defaultValue }`. Use `oldIndex: -1` for new params |
| `generateDelegate` | boolean | no | Keeps a method with the old signature that delegates to the new one. Leave it false: nothing here has shipped, so an old signature is a compatibility layer to delete, not keep. New required parameters need explicit non-blank defaults even with no existing callers |
| `dryRun` | boolean | no | Resolve/validate and discover callers/conflicts without writing or saving files. Default false |

**Returns**: `{ success, file, message, affectedFiles, changesCount, updatedSymbol? }`
**Returns with `dryRun: true`**: common preview shape; `plannedChange` contains `{operation: "changeSignature", before: {...}, requested: {...}}`.
