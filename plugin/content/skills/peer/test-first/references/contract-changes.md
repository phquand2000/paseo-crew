# Changing a contract

Open this when the brief changes, replaces or removes a signature, route, schema, field or file format. `BASE` and the contract search are the ones in test-first's "Settle the seam and the contract".

1. **Update every consumer in the same commit.** Find every shipping producer, consumer and generated artifact with the contract search on the old name, regenerate generated files with the repository's generator, and `ask` about any you may not write. One left on the old shape breaks at runtime.
2. **Audit the tests instead of syncing them.** When a small contract change turns many tests red, suspect tests that minted the API. Check each with the contract search: update one that locks the settled contract, delete one that only pinned an invented or retired shape.
3. **After a hard cut, derive negative cases from the present.**
   - List the retired identifiers and values with `git diff "$BASE" -- PATHS`, and `git grep -n -w` each: none may remain in code, tests or fixtures unless that exact value is still a public or security contract.
   - Build invalid inputs from current constants (`WIDTH - 1`, `WIDTH + 1`, one past the current maximum tag), never from the retired value.
   - Delete tests whose only claim is that a retired name is absent, and add no test or lint that lists retired names: the list keeps them alive.
