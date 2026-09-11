# Repository refresh standard

This standard defines what "current truth" means for a refreshed repository. `SKILL.md` applies
it; the repository's `AGENTS.md` can add stricter rules.

## Current truth

- Current documents describe the current system. Git holds the narrative history, so a document
  that retells history duplicates `git log` and goes stale.
- Each contract has one canonical owner document. Other documents link to it instead of
  restating it.
- One documentation index is enough; don't keep an index of indexes.
- Keep a folder only when it marks a lasting ownership boundary and holds several current
  documents.
- Collections named `archive/`, `completed/`, `review/`, `packet/`, `old/`, or `postmortem/` go
  by default. Keep a postmortem only while it is an active operational control or a record the
  law requires.
- Move current facts into their owner before deleting the stale container that held them.
- A document older than a date the Human names is a suspect to examine, not a file to delete.

## Documentation shape

Prefer the smallest subset of these that fits the repository:

- `docs/architecture/`: stable system owners and boundaries;
- `docs/adr/`: architecture decision records;
- `docs/product/`: externally observable product contracts;
- `docs/process/`: current development, evidence, release, and operating rules;
- `docs/exec-plans/active/`: ExecPlans for work in progress, and nothing finished;
- `docs/issues/`: the local tracker, if the repository uses one;
- `docs/templates/`: templates a current tool or workflow consumes.

An equally coherent existing structure stays; don't rename folders to match this list. Merge
parallel trees (doctrine, contracts, observability, agents, miscellaneous) into the owner above
that their content belongs to.

## Plans and trackers

- A plan is temporary execution authority, not a permanent record. Delete it once its durable
  decisions have reached their owner documents or ADRs.
- An open issue has a current premise, an owner, a consumer, and a completion condition. An open
  issue missing one of these is a candidate for closing or rewriting.
- A closed issue keeps its identity, its dependency fields, and a short closeout or
  not-pursuing reason. Diaries, review transcripts, stale artifact paths, and links to deleted
  plans go.
- A generated roadmap is a view of the tracker, never a second source of truth.

## Tests and proof

A mandatory proof route stays only when it names all six of these:

1. the current risk it protects against;
2. the production behavior or machine contract it checks;
3. the current consumer of that behavior;
4. an observation that would fail if the behavior disappeared;
5. an oracle independent enough not to reproduce the implementation;
6. the reason an ordinary, cheaper test isn't enough.

Delete, replace, or demote proof machinery that:

- checks source text, metadata, filenames, or an artifact's existence as a stand-in for runtime
  behavior;
- pins retired values only to prove they are retired;
- reimplements production logic in a mock, simulator, or validator, and so proves only the copy;
- runs a broad, expensive workflow to cover a narrow local risk;
- exists because an old issue demanded evidence, but protects no current contract;
- repeats what the compiler, type system, linter, framework, or an ordinary unit test already
  guarantees;
- would still pass if the claimed behavior were removed;
- produces large retained reports that no current release or operator reads.

Keep historical compatibility vectors only while the old value is still a current public,
security, wire, storage, migration, or machine contract.

## Cleanup rules

- In a repository with a single owner, delete rather than deprecate.
- When an internal path is renamed, update its callers instead of leaving a forwarding stub.
- Remove debt that can be removed now instead of writing it into a debt register.
- A mechanism earns its place by protecting something current; an old proof that would fail
  without it isn't a reason to keep it.
- Add no abstraction whose only purpose is to preserve a stale interface.
- Empty folders, obsolete taxonomy, dead commands, and reports that can be regenerated count as
  unfinished cleanup.
- When unsure, keep the unique current information and delete the redundant narrative around
  it.

## Evidence for the refresh

The refresh itself needs only the proportionate checks in step 6 of `SKILL.md`, plus a check
that each canonical owner is unique. A lower line count is worth reporting, but it doesn't show
correctness: the refresh succeeded only if the repository still carries every current product,
operational, compatibility, security, and contributor contract.
