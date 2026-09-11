# Supervisor notebook

This notebook is append-only, and only the Supervisor writes to it. Every failure becomes an
entry, but not every entry becomes a rule; see "Notebook and prompt patches" in
`claude/SUPERVISOR.md`.

Once an entry is written, change only its `Seen` and `Status` lines.

Use this format for each entry:

```
## YYYY-MM-DD — SHORT_TITLE
- Observed: project, agent ID, and what happened, quoting output or timeline
- Suspected mechanism: why the system produced it; "unknown" is a valid answer
- Seen: 1 (YYYY-MM-DD)
- Smallest correction: the proposal, not yet applied
- Status: open | applied KIT_SHA | rejected REASON
```

---
