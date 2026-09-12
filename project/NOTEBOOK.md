# Project notebook

Lessons from this project's work, kept and re-read by the Supervisor each session: the
`Status: open` entries are the live patterns, matched against every new observation first.
Append only novel or materially stronger evidence, grouped by pattern: a repeat raises `Seen`
rather than adding an entry, and a patch waits until `Seen` spans two different days. Once
written, an entry changes only in its `Seen` and `Status` lines.

Entry format:

```
## YYYY-MM-DD — SHORT_TITLE
- Observed: agent ID and what happened, quoting output or timeline
- Suspected mechanism: why the system produced it; "unknown" is a valid answer
- Seen: 2 (2026-09-01, 2026-09-03)
- Smallest correction: the proposal, not yet applied
- Status: open | applied SHA | rejected REASON
```

---
