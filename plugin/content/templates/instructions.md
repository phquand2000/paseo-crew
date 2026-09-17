---
name: instructions
owns: what an agent cannot work out by reading the repository
prevents: the same correction retyped every session, and expensive operations repeated
activate: always, and start it empty
ceremony: it holds an architecture overview, a directory tree or anything restating the README
---

Start this file EMPTY and add a line only the second time something is got wrong. Measured: context files that restate the repository do not improve results and raise cost by over a fifth; what helps is a specific instruction the code does not already carry.

# AGENTS.md

Not every heading applies. Where one does not, say in a line why, and leave it. An empty heading is ceremony; a heading that says why it is empty is information.

## Commands

<the ones that are not guessable: the test command, the build, anything with a flag that matters.>

## Conventions that differ from the defaults

<only where this repository does something other than what the tool would do on its own.>

## Expensive or irreversible

<what costs real time or money, and what cannot be undone.>

## Not shipped

<what has no consumer yet, so nothing has to stay compatible with it. Say "everything" when that is true.>
