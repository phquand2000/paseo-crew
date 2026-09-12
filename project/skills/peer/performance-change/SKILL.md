---
name: performance-change
description: "Change performance on evidence: pin the claimed path and the method, baseline its spread, profile before choosing, then keep or revert on the numbers and record every attempt in a ledger. Use when a brief asks to make something faster, smaller, or cheaper, or to investigate a slowdown."
---

# Performance change

Use this skill to change performance on evidence: a baseline on the claimed path, one change at a time, and a keep-or-revert decision made on the numbers. Under a read-only disposition, or when the brief asks only to investigate a slowdown, stop after Find the bottleneck and report the baseline with the profile evidence.

## Pin the claim and the method

1. Name the claimed path: the production entry point and workload the brief cares about (an endpoint, a command, a render, a frame loop, a query), and the metric (median or p95 latency, throughput, allocations, peak memory, bundle size, query count).
2. Choose the method: the exact command (an existing benchmark, a profiler, `hyperfine`, a timing harness, `EXPLAIN ANALYZE`), its inputs, warm-up, sample count, and cache state.
3. Check that the method runs the claimed path. A benchmark over a mock, a fixture, or a neighboring code path measures something else; report that as a finding before optimizing against it.

Done when you can cite the command and the `path:line` of the production path it runs.

## Measure the baseline

Run the method enough times to see its spread: at least five runs, or the benchmark's own statistics. Done when you have recorded the median and the spread. If the brief rules out a port, the test database, or the full suite, measure what you may and list what you couldn't.

## Find the bottleneck

Profile before you choose a change (a CPU or allocation profile, a query log or plan, a trace), and name the one thing that dominates: a function, query, lock, allocation site, or round trip. The Avoidable costs section of `.seatworks/skills/reviewer/reviewing-a-change/references/structural-lenses.md` lists where this cost usually hides.

Done when a profile excerpt or query plan points at the bottleneck. If the bottleneck lies outside your owned scope, send a `DEPENDENCY_REQUEST` with that evidence.

If it is overhead an abstraction in the path introduced, record that under Unknown / risk even when you optimize around it: winning the overhead back treats the symptom, and removing the layer may not be yours to decide.

## Change one thing and re-measure

1. A speed-up that drops required work, such as a validation, a freshness guarantee, or an awaited write, is a regression, so run the brief's tests with every attempt.
2. Measure again with the baseline's command, inputs, sample count, and cache state, and compare the difference with the spread.
3. Decide on the numbers: keep it when it is better by more than the spread with tests green, and put the before and after numbers in the commit message; revert it when it lands within the spread, is worse, or a test failed.

Done when every attempt, kept or reverted, is in the attempt ledger below, so a dead idea isn't tried again.

## Add a guard

If the repository already has a place for one, such as a benchmark suite, a size or performance budget file, or a CI budget step, add a benchmark or budget for the metric you moved, with the same method. If it has none, name the guard you would propose under Unknown / risk instead of building a framework for it.

## What goes in the handoff

Put the attempt ledger under Verification, with the method named for each number:

```text
Change                   Method               Baseline       After         Verdict
batch lookups in load()  bench/load, 10 runs  412 ms +- 9    131 ms +- 6   kept a1b2c3d
cache parsed config      bench/load, 10 runs  412 ms +- 9    405 ms +- 11  reverted, within noise
```

Give the method, inputs, and machine for every number, or it can't be compared. Put abstraction overhead, paths you couldn't measure, and differences between your machine and production under Unknown / risk.
