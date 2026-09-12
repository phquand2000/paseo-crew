# Project notebook

Lessons from this project's work, kept by the Supervisor. Append only novel or materially
stronger evidence, grouped by pattern; a repeat raises `Seen` instead of adding an entry. Not
every entry becomes a rule: a patch waits until `Seen` spans two different days. A pattern also
seen in another project's notebook goes to the Human as a kit diff.

Once an entry is written, change only its `Seen` and `Status` lines.

Use this format for each entry:

```
## YYYY-MM-DD — SHORT_TITLE
- Observed: agent ID and what happened, quoting output or timeline
- Suspected mechanism: why the system produced it; "unknown" is a valid answer
- Seen: 2 (2026-09-01, 2026-09-03)
- Smallest correction: the proposal, not yet applied
- Status: open | applied SHA | rejected REASON
```

---
