# Repository refresh standard

Open this before a refresh audit; it is the bar every suspect is classified against.

## Current truth

- Current documents describe the current system; Git owns narrative history.
- One contract has one canonical owner, and other documents link to it rather than restating it.
- One documentation index, no index of indexes, and a folder only where it marks a durable ownership boundary holding several current documents.
- No `archive/`, `old/`, `packet/` or `postmortem/` collections, unless a postmortem is still an active operational control or a legal record. The records this project's own guides define (ExecPlans, ADRs and review records under `docs/`) keep the layout their guides give.
- Merge current facts before deleting their containers. A document older than a given date is suspect, not disposable.
- Don't force a folder scheme over an equally coherent existing structure; do remove parallel doctrine, contract or miscellaneous trees whose content has a canonical owner.

## Plans and trackers

- A plan is temporary execution authority. Once its durable decisions reach their owner documents, it is finished.
- An open issue has a current premise, owner, consumer and completion condition; a closed one keeps its identity, dependency fields and a short closeout, without diaries or dead references.
- A generated roadmap is a view, never independent truth.

## Tests and proof

A retained mandatory proof route names: the current risk; the production behavior or machine contract; its current consumer; an observation that fails when the behavior disappears; an oracle independent of the implementation; and why cheaper ordinary testing isn't enough. Machinery missing these is replaced, demoted or deleted, using the routes in `.seatworks/skills/peer/test-proof-debt-audit/references/proof-debt-catalog.md`. Keep a historical compatibility value only while it is still a public, security, wire, storage or migration contract.

## Cleanup rules

- Prefer deletion over deprecation inside a single-owner repository, and update callers rather than leaving forwarding documents.
- Don't create a debt register for debt you can remove now, keep a mechanism only because deleting it fails an old proof, or add an abstraction to preserve a stale interface.
- Empty folders, obsolete taxonomy, dead commands and reproducible reports are cleanup failures, not harmless residue.
- When uncertain, keep unique current truth and delete redundant narrative. A smaller repository counts only when every current product, operational, compatibility, security and contributor contract survives.
