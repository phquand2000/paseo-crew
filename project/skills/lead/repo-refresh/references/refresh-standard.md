# Repository refresh standard

This standard defines what "current truth" means for a refreshed repository. The procedure in
`SKILL.md` applies it; the repository's `AGENTS.md` can add stricter rules.

## Current truth

- Current documents describe the current system. Git holds the narrative history, so a
  document that retells history duplicates `git log` and goes stale.
- Each contract has one canonical owner document. Other documents link to it instead of
  restating it, so there is one place to update.
- One documentation index is enough; an index of indexes is a second thing to keep in sync.
- Keep a folder only when it marks a lasting ownership boundary and holds several current
  documents.
- Collections named `archive/`, `completed/`, `review/`, `packet/`, `old/`, or `postmortem/`
  go by default. Keep a postmortem only while it is an active operational control or a record
  the law requires.
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

An existing structure that is equally coherent stays; don't rename folders to match this list.
Parallel trees (doctrine, contracts, observability, agents, miscellaneous) whose content
belongs to one of the owners above get merged into that owner.

## Plans and trackers

- A plan is temporary execution authority, not a permanent record. When its durable decisions
  have reached their owner documents or ADRs, delete it.
- An open issue has a current premise, an owner, a consumer, and a completion condition. An
  open issue missing one of these is a candidate for closing or rewriting.
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

- checks source text, metadata, filenames, or the existence of an artifact as a stand-in for
  runtime behavior;
- pins retired values only to prove they are retired;
- reimplements production logic in a mock, simulator, or validator, and so proves only the
  copy;
- runs a broad, expensive workflow to cover a narrow local risk;
- exists because an old issue demanded evidence, but protects no current contract;
- repeats what the compiler, type system, linter, framework, or an ordinary unit test already
  guarantees;
- would still pass if the claimed behavior were removed;
- produces large retained reports that no current release or operator reads.

Keep historical compatibility vectors only while the old value is still a current public,
security, wire, storage, migration, or machine contract.

## Cleanup rules

- Inside a repository with a single owner, delete rather than deprecate.
- When an internal path is renamed, update its callers instead of leaving a forwarding stub.
- Remove debt that can be removed now instead of writing it into a debt register.
- A mechanism earns its place by protecting something current; an old proof that would fail
  without it isn't a reason to keep it.
- Add no abstraction whose only purpose is to preserve a stale interface.
- Empty folders, obsolete taxonomy, dead commands, and reports that can be regenerated count
  as unfinished cleanup.
- When unsure, keep the unique current information and delete the redundant narrative around
  it.

## Evidence for the refresh

The refresh itself needs only proportionate checks:

- references resolve;
- each canonical owner is unique;
- retained tracker and plan schemas validate;
- tests for changed tooling pass;
- generated files that are intentionally tracked match their producer;
- the official acceptance command still exercises every contract the cleanup touched.

A lower line count is worth reporting, but it doesn't show correctness. The refresh succeeded
only if the repository still carries every current product, operational, compatibility,
security, and contributor contract.
