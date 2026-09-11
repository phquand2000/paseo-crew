# Integration map template

One map per group of projects that share contracts. Copy the block below to
`.seatworks/records/integration/NAME.md`, and keep it current as the SHAs land.

```md
# Integration map: NAME

Projects: PROJECT_LIST
Updated: DATE

## Seams

| Seam | Crosses | Provider (defined at) | Consumers (used at) | Owning Lead | Consumer checks | Provider runs |
|---|---|---|---|---|---|---|
| SEAM | CROSSES | PROVIDER | CONSUMERS | OWNER | CHECKS | PROVIDER_COMMAND |

## Changes

| Change | Seam | Class | Phase | Gate | Evidence | Reserved for the Human |
|---|---|---|---|---|---|---|
| CHANGE | SEAM | CLASS | PHASE | GATE | EVIDENCE | RESERVED |

## Log

- DATE: LOG_ENTRY
```

Replace the following:

- `NAME`: a short name for the group, for example `voice-sdk`.
- `PROJECT_LIST`: each project, with its repository path.
- `DATE`: `YYYY-MM-DD`.
- `SEAM`: a short name, for example `sdk public API` or `call-event webhook`.
- `CROSSES`: what crosses: a package, an API, a schema, an event format, a token, a shared
  database, or a deploy order.
- `PROVIDER`: the providing project and the path that defines the contract.
- `CONSUMERS`: each consuming project and the path where it uses the contract.
- `OWNER`: the owning Lead's project and agent ID, confirmed by the Human.
- `CHECKS`: each consumer's check, as `project:path@SHA`.
- `PROVIDER_COMMAND`: the command the provider runs before acceptance that includes the checks.
- `CHANGE`: the change in a few words, for example `rename startCall to dial`.
- `CLASS`: `additive` or `breaking`.
- `PHASE`: `expand`, `migrate`, `contract`, or `settled`; for an additive change, `open` or
  `settled`.
- `GATE`: the condition that opens the next phase.
- `EVIDENCE`: the SHAs and check results that passed the gate.
- `RESERVED`: the decisions reserved for the Human, for example `removing the old form`.
- `LOG_ENTRY`: a direct action you took, and which Leads you notified and how.
