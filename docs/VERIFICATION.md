# Reproducing the verification

All commands run from the repository root with Node 22 and npm (`npm ci` first). Durations are those measured for this release on one machine and will vary.

| Command | What it checks | Expected result and duration |
|---|---|---|
| `npm run verify` | `tsc --noEmit` (strict), ESLint (including the import-zone rules that encode the module layering), the default Vitest project, and the production build | 115 test files and 1,303 tests, all passing; tests 123.4 s; build 131 modules transformed, a main bundle of 437.94 kB (129.31 kB gzip), a stylesheet of 42.21 kB (8.24 kB gzip) and two worker bundles of 48.59 kB and 24.02 kB, built in 0.91 s |
| `npm run test:slow` | the slow Vitest project (12 files): seeded full-game runs for k = 5, 6, 7, wider Breaker distributions, forced-region boundary stress, promotion path, larger-corpus cell checks, the cell-exhaustive k = 7 gate, Overmars-29 and random 30-point sets | 12 test files and 42 tests, all passing; 2,291.8 s (about 38 minutes) |
| `npm run coverage` | default project with V8 coverage, then `scripts/check-coverage.mjs`: line gates geometry 95%, strategy / game / engine / kstrip 90% | gates: geometry 95.16% (1,042 of 1,095 lines), game 96.18% (151 of 157), strategy 91.80% (1,489 of 1,622), engine 90.35% (843 of 933), kstrip 95.93% (1,699 of 1,771) |
| `npm run audit:replays` | structural walk over `data/replays/*.replay.json`: format and version, transaction-tree linkage, `beforeHash`/`afterHash` continuity, cursor membership | 1 test file with 9 tests, all passing |
| `python -I scripts/audit/gen_fixtures.py` | regenerates `tests/audit/fixtures/*.json` from the independent exact oracle (`scripts/audit/oracle.py`, fixed seed); `tests/audit/oracle.test.ts` then compares the TypeScript kernel against it | instant; rewrites the fixtures deterministically |
| `python -I scripts/audit/kstrip_oracle.py` | regenerates `tests/kstrip/fixtures/strips.json` from the literal-definition k-strip oracle; consumed by `tests/kstrip/oracle.test.ts` | seconds |

Focused runs:

```
npx vitest run --project default tests/kstrip            # k-strip core and specification layer
npx vitest run --project default tests/kstrip/spec       # spec equivalence (57 runs), validator, predicates, replay
npx vitest run --project default tests/strategies        # k = 5, 6, 7, 8 strategies
K7_GATE_EVIDENCE=k7-evidence.jsonl npx vitest run --project slow \
    tests/slow/k7gate-cells.test.ts tests/slow/k7gate-engine.test.ts
```

Fast-tier k = 8 tests (`tests/strategies/k8*.test.ts`): 2 test files with 26 tests, all passing; k-strip specification tests: 6 test files with 165 tests, all passing. The k = 8 exhaustive gate was **not completed** (see `docs/K8_GATE.md`); only the fast-tier tests are part of the automated suites.

The k = 7 gate takes part of the slow tier's 2,291.8 s in total; the two gate files were not timed separately in this run. Its recorded evidence file for the committed results is `docs/k7-gate-evidence.jsonl` (28 hexagons / 141,466 oracle leaves; 10 hexagons / 4,255 engine leaves; 0 failures); see `docs/K7_GATE.md` for scope.

## What the results mean

- Type check, lint and the architecture test establish structure (layering, purity, single sources of truth), not mathematical correctness.
- Default-tier tests combine exact unit tests, differential tests against the Python oracles, property tests (`fast-check`) and interface tests in jsdom.
- Slow-tier games and cell checks are randomized or finite-domain evidence about the encoded strategies; they are not proofs of the published theorems.
- `scripts/audit/overmars_check.py` needs the source paper and two companion data files outside this repository and cannot run from a clean checkout; the Overmars-29 facts are asserted by `tests/slow/overmars29.test.ts` (general position; hull layers 3, 4, 7, 7, 7, 1; 5,335 convex 6-subsets; no empty hexagon; 151 empty pentagons).
- Generated output under `scripts/audit/out/` and `coverage/` is ignored by version control.

Note on run order: the coverage and slow-tier runs were made on the final sources apart from one last change to the stylesheet and to an ARIA label in the Sandbox view, which touches none of the coverage-gated directories; the default tier, type checking, lint and the production build were repeated after that change and are the values reported for `npm run verify`.
