# Changing a contract

Open this when the brief changes a signature, route, schema, field, or file format, or removes
or replaces one. Ordinary behavior changes don't need it.

`BASE` and the step numbers are the ones in the test-first skill.

## Update every consumer in the same change

Update every shipping producer, consumer, and generated artifact of the contract in the same
change; one left on the old shape breaks at runtime. Find them with the step 2 search on the old
name, regenerate generated files with the repository's generator, and send a
`DEPENDENCY_REQUEST` for any outside your owned scope.

## Audit the tests instead of syncing them

Audit tests and fixtures instead of syncing them mechanically. When a small contract change turns
many tests red, suspect tests that minted the API: check each as in step 3 of Before the first
test, update one that locks the settled contract, and delete one that only pinned an invented or
retired shape.

## Negative cases after a hard cut

When the brief removes or replaces a schema field, protocol tag, width, or version:

1. List the retired identifiers and values with `git diff "$BASE" -- PATHS`.
2. Search current code, tests, and fixtures for each with `git grep -n -w`. Done when none names
   a retired value, unless that exact representation is still a public or security contract.
3. Derive invalid inputs from current constants and boundaries (`WIDTH - 1`, `WIDTH + 1`, a tag
   one past the current maximum). A test pinned to a retired value proves only history and keeps
   the dead contract alive.
4. Delete tests whose only claim is that a retired name is rejected or absent, and add no test or
   lint rule that lists retired names: the list keeps them alive.
