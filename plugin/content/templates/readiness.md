---
name: readiness
owns: the questions that must be answered before something becomes load-bearing
prevents: shipping a thing whose rollback, monitoring and failure behaviour was never thought about
activate: a maturity gate: the first outside consumer, or the first time somebody else depends on it
ceremony: applied to ordinary internal iteration
---

# Readiness: <what is becoming load-bearing>

Not every heading applies. Where one does not, say in a line why, and leave it. An empty heading is ceremony; a heading that says why it is empty is information.

## In scope, and explicitly not

## What this closes off later

<the doors this shuts. The most expensive answers are the ones nobody asked for.>

## Turning it off

<rollback, and what has to be repaired by hand if rolling back is not enough.>

## Watching it

<what would tell us it has gone wrong, and who sees that.>

## Depends on

## Under load

## Known bugs we are accepting

| What | Why it is acceptable |
|---|---|

## Objections

<who was asked to argue against this, and what they said. "Nobody objected" is only meaningful if
somebody was asked.>
