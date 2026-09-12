# Hard-cut route

The route for a repository whose `AGENTS.md` sets a hard-cut policy: one live contract, no
backward compatibility before the first release. The policy exists to prevent a second live
path, so this route replaces the expand-and-contract machinery.

1. **Replace the contract in place.** If the policy fixes the version number until the first
   release, keep the number and replace the content. Done when the repository exposes one
   contract.
2. **Sync every consumer in the same change.** Every producer, consumer, and generated artifact
   that ships or that the toolchain loads moves in the same change, so no accepted state has
   two contracts live. In decompose, make this one slice, or slices merged before acceptance.
   Done when the acceptance command passes on the combined result.
3. **Fail fast on old data.** Reject data that doesn't match the current contract with a clear
   error; a failed path doesn't switch to other semantics. Leave out dual reads and writes,
   version branches, shims, adapters for old shapes, legacy parsers, and read-time upgrades.
   Done when a test feeds invalid data and sees the error.
4. **Reset development state instead of migrating it.** A reset deletes data, so name the
   command and get the Human's go-ahead before it runs. Done when the Human has agreed and the
   reset ran.
5. **Audit tests and fixtures rather than updating them mechanically.** Keep or update those
   that exercise the current contract. Derive negative cases from current constants and
   boundaries (`WIDTH - 1`, `WIDTH + 1`) instead of naming deleted fields or values. Delete
   tests whose only claim is that a retired contract is rejected. Done when each changed test
   answers "what current behavior does this protect?".
6. **Remove every trace of the old names.** List the removed identifiers and literals from the
   diff, then search for each one:

   ```bash
   git diff "$base" HEAD -U0 -- CONTRACT_PATHS | grep '^-[^-]'
   git grep -n -w REMOVED_NAME
   ```

   Done when each search is empty in code, tests, and fixtures. Put the list of searches in the
   handoff, not in the repository: a committed blacklist, tombstone list, or source-substring
   test keeps the dead name alive.
7. **Prove the rollback once**: `git revert` of the whole cut plus a rebuild of development
   state, run locally before the Human pushes. Done when the reverted tree passes the
   acceptance command.

A hard cut has no contract step to schedule, but step 4 of "Before any rollout step" in
`SKILL.md` holds: every step that leaves this machine goes to the Human with the rollout sheet.
