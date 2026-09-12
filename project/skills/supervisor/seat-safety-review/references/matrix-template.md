# Seat matrix template

Copy the block to `.seatworks/records/safety/seat-matrix.md`, replacing the whole file on each
review; git keeps the history.

```md
# Seat safety matrix

Reviewed: DATE. Sources: SOURCES

## Seats

| Seat | Tools | Credentials (names) | Private data | Untrusted content | Egress | Ungated side effects | Enforcement | Trifecta |
|---|---|---|---|---|---|---|---|---|
| SEAT | TOOLS | CREDENTIALS | PRIVATE_DATA | UNTRUSTED | EGRESS | SIDE_EFFECTS | ENFORCEMENT | TRIFECTA |

## Chains

| From | To | Carries | Legs in the chain | Trifecta |
|---|---|---|---|---|
| FROM | TO | CARRIES | LEGS | TRIFECTA |

## Flags and fixes

| # | Seat or chain | Legs | Worst case | Fix | Leg broken | Surface | Enforced? | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | WHERE | LEGS | WORST_CASE | FIX | LEG | SURFACE | ENFORCED | STATUS |

## Other threats

- THREAT

## Not checked

- NOT_CHECKED
```

Replace the following:

- `DATE`: the review date, `YYYY-MM-DD`.
- `SOURCES`: the files and commands you read, for example
  `~/.paseo/config.json, $SEATWORKS_KIT/seats.json, $SEATWORKS_KIT/harness/HARNESS/harness.json, scripts/inventory.sh`.
- `SEAT`: the provider ID, for example `peer-SLUG` or `lead-SLUG`.
- `TOOLS`: what the seat reaches after its deny list or guard, including Paseo tools, MCP
  servers, and packages.
- `CREDENTIALS`: names only, for example `CLAUDE_CODE_OAUTH_TOKEN, gh (repo scope), ssh agent (2 keys)`.
- `PRIVATE_DATA`: the repositories, transcripts, or files it can read.
- `UNTRUSTED`: the untrusted sources it reads, directly or through another agent.
- `EGRESS`: every path that can send data off the machine.
- `SIDE_EFFECTS`: external effects no Human gate covers, or `none`.
- `ENFORCEMENT`: `deny list`, `peer guard`, `prompt only`, or a combination.
- `TRIFECTA`: `yes` or `no`.
- `FROM`, `TO`: the seats at each end of the edge.
- `CARRIES`: what travels along it, for example `handoff text` or `OWNER DIRECTIVE`.
- `LEGS`: which of private data, untrusted content, and egress it holds.
- `WHERE`: the flagged seat or chain.
- `WORST_CASE`: what could leave, and how.
- `FIX`: the change, as specific as a deny entry or a guard pattern.
- `LEG`: `private data`, `untrusted content`, `egress`, or `none` for a Human gate.
- `SURFACE`: the file or config that changes.
- `ENFORCED`: `yes` if a tool or guard blocks it, `no` if it's prompt text.
- `STATUS`: `proposed`, `applied SHA`, or `accepted by Human DATE`.
- `THREAT`: a threat outside the trifecta, with the seat and path.
- `NOT_CHECKED`: what this review didn't cover, so the next one can start there.
