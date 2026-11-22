# Experiment replay (k-strip explorer and Parameter Lab)

Schema: `src/replay/experiment.ts` (pure, structural). Re-execution: `src/ui/experiment-io.ts`
(needs `kstrip/` and `lab/`, which `replay/` may not import). Core game replays
(`replay/format.ts`, v2/v3) are a different format and are untouched; the two are told apart by
`format`.

## File

```
{ "format": "playing-the-proof/experiment", "version": 1, "kind": "kstrip" | "lab", "meta": {...},
  "kstrip": { variant, k, t, s, policy, seed, script, moves[], expect } | "lab": { config, status, simulation } }
```

* **kstrip**: parameters, Breaker policy, seed, optional `script` (the user's Breaker points of
  "Break the Proof", base coordinates, exact rationals) and the full move log (`pt`, `ptFrame`,
  `frameC`, phase, level, player, kind). `expect` holds status, rounds, point and claim counts.
  Replay = (1) `replayLog` legality of the recorded log without any policy, (2) the parameters
  must be runnable here, (3) deterministic re-execution and a move-by-move comparison.
  A session waiting for a Breaker point is stored with `expect.status = "awaiting-breaker-move"`.
* **lab**: configuration, recorded status, and optionally one simulation (seed, policies, round and
  operation budgets, the recorded observation and transcript). Replay re-runs `classify()` (status
  must match) and `runSimulation` with the same seed; an interrupted run is reproduced by
  interrupting at the same placement.

## Caps and strictness

2 MB of text (checked before `JSON.parse`), rationals canonical `n/d` with magnitudes <= 10^100,
at most 1000 moves, 200 scripted points, 200 transcript lines, k <= 12 (k-strip). Unknown keys
are rejected (except inside `meta`), enums are closed.

## Versions

Version 1 is current. `migrateExperiment` is the single place for future bumps; older or newer
versions are refused with `bad-version` (no earlier version exists, so no real migration is
implemented or tested beyond that refusal).
