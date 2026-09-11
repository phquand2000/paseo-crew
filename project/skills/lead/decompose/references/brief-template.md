# Brief template

A brief is the whole of what a Peer knows about its task, so it carries the fields from the
Lead seat prompt's Delegation section plus three more: Interfaces, Global constraints, and Open
questions. It goes into `create_agent` as `initialPrompt`.

Keep the brief neutral. State the outcome, the boundaries, and the questions that are still
open, and leave the implementation to the Peer. Point to files and SHAs instead of pasting
earlier tasks' history: whatever you paste stays in the Peer's context for the whole task.
Leave Paseo, seats, and other agents' identities out; pass their results as SHAs, paths, and
output.

Copy this block:

```text
Task ID             TASK_ID
Repository root     REPO_ROOT
Workspace           WORKSPACE_DIR
Disposition         DISPOSITION
Objective           OBJECTIVE
Decided / ruled out DECISIONS
Starting points     STARTING_POINTS
Owned scope         OWNED_GLOBS
Excluded scope      EXCLUDED_GLOBS
Authority           Commit locally on BRANCH. Pushing, deploying, external calls, and CI changes are not authorized.
Interfaces
  Consumes          CONSUMED_INTERFACES
  Produces          PRODUCED_INTERFACES
Global constraints  GLOBAL_CONSTRAINTS
Verification        VERIFICATION_COMMANDS
                    Test lane: TEST_LANE
Open questions      OPEN_QUESTIONS
Handoff             The six fields: Outcome, Snapshot, Scope, Verification, Unknown / risk,
                    Ownership. Put any log longer than a screen in a file and give its path.
```

Replace the following:

- `TASK_ID`: the plan slug and slice, for example `invoice-csv-S2`.
- `REPO_ROOT`: the repository root as `git rev-parse --show-toplevel` prints it.
- `WORKSPACE_DIR`: the worktree directory `create_workspace` returned for this slice, or the
  repository root when the Peer works in your checkout.
- `DISPOSITION`: `Engineer`, `Architect`, `Reviewer`, or `Scout`.
- `OBJECTIVE`: the observable outcome of this slice, in one or two sentences.
- `DECISIONS`: settled decisions and rejected approaches that bound the slice, each with its
  ADR number or plan line, for example `ADR 0007: amounts are integer cents; floats ruled out`.
  Write `none` if there are none.
- `STARTING_POINTS`: files, docs, and SHAs worth reading first, including the ExecPlan path.
- `OWNED_GLOBS`: the paths this Peer may write, as concrete globs.
- `EXCLUDED_GLOBS`: nearby paths it may read but not write, such as another slice's scope.
- `BRANCH`: the slice branch, for example `task/invoice-csv-S2`.
- `CONSUMED_INTERFACES`: the exact signatures, types, routes, schemas, or file formats this
  slice uses, each with the SHA or path it comes from.
- `PRODUCED_INTERFACES`: the exact names, parameters, and return types later slices will rely
  on. A Peer sees only its own brief, so this block is how neighboring slices agree on names.
  Tests in the slice may call only what exists at the base SHA or what Consumes and Produces
  name; a test that needs anything else would invent the contract.
- `GLOBAL_CONSTRAINTS`: requirements that bind every slice, copied word for word from the
  spec, the owner directive, or `AGENTS.md`: exact values, formats, limits, and version floors.
  A paraphrase loses the exact value.
- `VERIFICATION_COMMANDS`: the exact commands to run, one per line.
- `TEST_LANE`: whether this Peer may run the full suite, hold a port, or use the test
  database, for example `targeted tests only; no port; no test database`.
- `OPEN_QUESTIONS`: what you don't know and want the Peer's judgment on, or `none`. Ask each
  one open, not as a choice between answers you picked: a Peer offered A or B returns A or B.

## Example

```text
Task ID             invoice-csv-S2
Repository root     /Users/me/code/billing
Workspace           /Users/me/code/billing-wt/invoice-csv-S2
Disposition         Engineer
Objective           GET /invoices/export?format=csv returns the filtered invoice list as CSV.
Decided / ruled out ADR 0007: amounts are integer cents; floats ruled out.
                    Streaming the response is ruled out for now (plan line 14): lists cap at 5,000 rows.
Starting points     docs/exec-plans/active/invoice-csv.md, src/invoices/query.ts, 4c1d9e2 (S1 skeleton)
Owned scope         src/invoices/export/**, test/invoices/export/**
Excluded scope      src/invoices/query.ts (S3 owns it)
Authority           Commit locally on task/invoice-csv-S2. Pushing, deploying, external calls, and CI changes are not authorized.
Interfaces
  Consumes          listInvoices(filter: InvoiceFilter): Promise<Invoice[]>  (src/invoices/query.ts at 4c1d9e2)
  Produces          toCsv(invoices: Invoice[]): string
Global constraints  "Amounts are formatted with exactly two decimal places and no thousands separator."
                    "Column order: number, customer, issued_at, amount, status."
Verification        npm test -- test/invoices/export
                    npm run typecheck
                    Test lane: targeted tests only; no port; no test database
Open questions      How should an empty result behave? Recommend one behavior with evidence.
Handoff             The six fields: Outcome, Snapshot, Scope, Verification, Unknown / risk,
                    Ownership. Put any log longer than a screen in a file and give its path.
```
