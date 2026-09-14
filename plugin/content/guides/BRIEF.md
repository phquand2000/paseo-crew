# Brief template

A brief is everything a Peer or Reviewer knows about its task. Use this template exactly, and fill
every field or write `none`.

Keep it neutral: the outcome, the limits and the open questions, not the implementation, because a
Peer that only retypes your answer adds no second judgment. Point to files and SHAs rather than
pasting history: whatever you paste stays in its context for the whole task.

```text
Task ID             <plan slug and slice, e.g. invoice-csv-S2>
Repository root     <as git rev-parse --show-toplevel prints it>
Disposition         <Engineer | Architect | Scout | Reviewer>
Objective           <the observable outcome, in one or two sentences>
Skills              <the skills whose subject this task touches, by name, or none>
Decided / ruled out <settled decisions and rejected routes, each with its ADR number or plan heading>
Starting points     <files, docs, SHAs and URLs to read first; name every outside source, since it cannot search>
Owned scope         <globs it may write, or none>
Excluded scope      <nearby globs it may read but not write>
Authority           Commit locally on <branch>. Pushing, deploying, external calls and CI changes are not authorized.
Interfaces
  Consumes          <exact signatures, routes or schemas it uses, each with its SHA or path>
  Produces          <exact names later slices rely on, each citing where it was settled>
Global constraints  <values, formats and limits copied word for word from an ADR, the directive or AGENTS.md>
Verification        <exact commands, one per line, starting from the slice's Acceptance cell>
                    Test lane: <whether it may run the full suite, hold a port, or use the test database>
Open questions      <what you want its judgment on, each asked open, not as A or B>
Handoff             The six fields: Outcome, Snapshot, Scope, Verification, Unknown / risk, Ownership.
                    Put any log longer than a screen in a file and give its path.
```

A Reviewer's brief adds these four fields after Objective:

```text
Target SHA          <the exact commit or range under review>
Axes                <spec, standards, structure: the ones this review covers>
Machine pass        <run, or skip and why>
Rulings to check    <each (ambiguous) DECISION: line, quoted, or none>
```

Three fields need care, because an agent sees only its own brief:

- **Authority** for an Architect, Scout or Reviewer is `Read-only: change nothing and commit
  nothing.`, with Owned scope `none`.
- **Owned scope**: first list the files the change reaches outside it, then bring each inside or
  re-cut the slice. A Peer that meets a file it cannot write can only stop.
- **Produces** names only what is already settled (the skeleton slice's SHA, an Architect's
  handoff, an ADR). A test may call only what exists at the base SHA or what Interfaces names, or
  it invents the contract.
