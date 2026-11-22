# Reproducing the verification

All commands run from the repository root with Node 22 and npm (`npm ci` first). Measured values are those of commit {{M_SHA}} on one machine and will vary.

| Command | What it checks | Expected result and duration |
|---|---|---|
| `npm run verify` | `tsc --noEmit` (strict), ESLint (including the import-zone rules that encode the module layering), the default Vitest project, and the production build | {{M_STATIC}}; {{M_VERIFY}} in {{M_VERIFY_TIME}}; build {{M_BUILD}} |
| `npm run test:slow` | the slow Vitest project: seeded full-game runs for k = 5, 6, 7, wider Breaker distributions, forced-region boundary stress, promotion path, larger-corpus cell checks, the cell-exhaustive k = 7 gate, the k = 8 A1 sweep over five heptagons, Overmars-29 and random 30-point sets | {{M_SLOW}} in {{M_SLOW_TIME}} |
| `npm run coverage` | default project with V8 coverage, then `scripts/check-coverage.mjs`: line gates geometry 95%, strategy / game / engine / kstrip 90% | {{M_COVERAGE}}; geometry {{M_COV_GEOMETRY}}, game {{M_COV_GAME}}, strategy {{M_COV_STRATEGY}}, engine {{M_COV_ENGINE}}, kstrip {{M_COV_KSTRIP}} |
| `npm run audit:replays` | structural walk over `data/replays/*.replay.json`: format and version, transaction-tree linkage, `beforeHash`/`afterHash` continuity, cursor membership | {{M_AUDIT}} |
| `python -I scripts/audit/gen_fixtures.py` | regenerates `tests/audit/fixtures/*.json` from the independent exact oracle (`scripts/audit/oracle.py`, fixed seed); `tests/audit/oracle.test.ts` then compares the TypeScript kernel against it | rewrites the fixtures deterministically; the comparison test reports {{M_ORACLE}} |
| `python -I scripts/audit/kstrip_oracle.py` | regenerates `tests/kstrip/fixtures/strips.json` from the literal-definition k-strip oracle; consumed by `tests/kstrip/oracle.test.ts` | seconds; the k-strip oracle test reports {{M_KSTRIP_ORACLE}} |

Focused runs:

```
npx vitest run --project default tests/kstrip            # k-strip core and specification layer
npx vitest run --project default tests/kstrip/spec       # spec equivalence (57 runs), validator, predicates, replay
npx vitest run --project default tests/strategies        # k = 5, 6, 7, 8 strategies
K7_GATE_EVIDENCE=k7-evidence.jsonl npx vitest run --project slow \
    tests/slow/k7gate-cells.test.ts tests/slow/k7gate-engine.test.ts
```

Fast-tier k = 8 tests (`tests/strategies/k8*.test.ts`): {{M_K8FAST}}; k-strip specification tests: {{M_SPEC}}. The k = 8 exhaustive gate was **not completed** (see `docs/K8_GATE.md`): the A1 step was swept over every B0 cell of five heptagons by a slow-tier test, while the deeper steps (A3, the B3 dichotomy, A4) are sampled on the preset heptagon only.

The k = 7 gate is part of the slow tier ({{M_SLOW_TIME}}). Its recorded evidence file for the committed results is `docs/k7-gate-evidence.jsonl` (28 hexagons / 141,466 oracle leaves; 10 hexagons / 4,255 engine leaves; 0 failures); see `docs/K7_GATE.md` for scope.

## What the results mean

- Type check, lint and the architecture test establish structure (layering, purity, single sources of truth), not mathematical correctness.
- Default-tier tests combine exact unit tests, differential tests against the Python oracles, property tests (`fast-check`) and interface tests in jsdom.
- Slow-tier games and cell checks are randomized or finite-domain evidence about the encoded strategies; they are not proofs of the published theorems.
- `scripts/audit/overmars_check.py` needs the source paper and two companion data files outside this repository and cannot run from a clean checkout; the Overmars-29 facts are asserted by `tests/slow/overmars29.test.ts` (general position; hull layers 3, 4, 7, 7, 7, 1; 5,335 convex 6-subsets; no empty hexagon; 151 empty pentagons).
- Generated output under `scripts/audit/out/` and `coverage/` is ignored by version control.

Browser evidence for the interface (Section 12.8 of the report): {{M_BROWSER}}
