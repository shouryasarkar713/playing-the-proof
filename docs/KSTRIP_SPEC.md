# KSTRIP_SPEC — the k-strip Maker strategy as a declarative, validated, interpreted specification

Code: `src/kstrip/spec/`, kernel:
`src/kstrip/` (unchanged geometry), tests: `tests/kstrip/spec/` and `tests/lab/kstrip-encodings.test.ts`.
Companion: `docs/KSTRIP.md` (the construction, its tiers and its deviations from the paper). Nothing here
claims that the strategy works for arbitrary k, t, s or against all Breaker behaviours; see section 10.

## 1. Why a separate spec layer (and not `src/strategy/`)

`StrategyDef` (src/strategy/types.ts) is a finite node graph over hole analyses of a `GameState`: k is the
literal union `3|5|6|7|8`, moves are hole/edge `MoveSpec`s, invariants are `exists-k-hole | region-empty-of |
config-class | custom`, and G6 requires every cycle to contain a Breaker classification. It has no counters, no
level parameter and no strip/cone/ledger vocabulary. Unrolled, one k-strip instance needs one Maker-move node
per Maker round (6 / 26 / 106 rounds for k = 3 / 4 / 5 at t = 1; x4 per level) with a bespoke move kind each.
Extending Core to host it would touch `StrategyDef`, G1-G11, the reducer, `verification/` (which `kstrip/` may not
import), the replay/hash format and the pickers, for a construction with no `GameState`. records the decision
(additive spec layer beside the engine) and the rejected alternatives.

## 2. The representation (`KStripSpec`, pure data)

| field | meaning |
|---|---|
| `id, title, variant, theorem, version, sRule` | identity; `variant` in `mono-1:1 | mono-1:s | bichromatic`; `sRule` in `fixed-1 | integer>=1 | rational[0,2)` |
| `verified` | the ONLY configurations claimed: list of `{k, t[], s[]?}` (exact rationals as strings). Anything else is `uncovered` |
| `runPre / runPost` | run-level predicate ids (domain check; claims verified in base coordinates, parallel, >= goal, rounds match the plan, log legal, Maker-only for bichromatic) |
| `phases[]` | one `PhaseSpec` per construction phase (below) |

`PhaseSpec`: `id`, `kind` (`PhaseKind`), `when` (`level = n` or `level >= n`), `primitive` (the named geometric
act), formulas `units / inputStrips / makerMoves / breakerAllowance`, descriptive structure (`pairing`,
`candidateRegions`, `extensionMove`, `survivorSelection`), `allowedResponses` (Breaker response classes),
`pre` and `post` (predicate ids) and `transition` (`terminal`, or `recurse` into `level - 1` with a strip demand).

Formulas are an exact expression tree (`expr.ts`): `const | var | add | sub | mul | div | ceil | floor` over `Rat`
with variables `k level need s m units`; `evalCount` insists on a non-negative integer. They print
(`showExpr`) so the UI can show them. The shipped spec tables, as printed by `specTable()`:

| spec | phase | when | primitive | units | Maker moves | Breaker allowance | recursion |
|---|---|---|---|---|---|---|---|
| mono-1:1 | base-1 | level = 1 | mono-base-1 | 0 | ceil(need/(s + 1)) | s | terminal |
| mono-1:1 | base-2 | level = 2 | mono-base-2 | 0 | ceil(2*need/(s + 1)) | s | terminal |
| mono-1:1 | pairing | level >= 3 | pair-adopt | 2*need | units | s | level - 1, need 4*s*need |
| mono-1:s | base-1/2 | as above | mono-base-1/2 | 0 | as above | s | terminal |
| mono-1:s | grouping | level >= 3 | group-slab | 2*need | units | s | level - 1, need 4*s*need |
| bichromatic | bichromatic-base | level = 1 | bichromatic-base-1 | 0 | need | floor(m*s) - floor((m-1)*s) | terminal |
| bichromatic | bichromatic-pairing | level >= 2 | bichromatic-pair-tilt | ceil(2*need/(2 - s)) | units | floor(m*s) - floor((m-1)*s) | level - 1, need 2*units |

(in mono-1:1, s is the constant 1.) The recurrence is thus *the recursion of the phases*: the strip demand passed to
level - 1 is evaluated from the formulas, never hard-coded in the interpreter.

Verified configurations (`verified`): mono-1:1: k = 2, 4, 5 with t = 1 and k = 3 with t = 1, 2, 3; mono-1:s:
k = 3 with s = 2, 3 and k = 4 with s = 1, 2 (t = 1); bichromatic: k = 2 with s = 1, 3/2 (r = 1, 2) and k = 3 with
s = 0, 1 (r = 1, 2) and s = 3/2 (r = 1). Each point was executed by BOTH executors with all three shipped Breaker
policies (section 7).

## 3. Primitives (spec separate from geometry)

A primitive is a name the interpreter maps to an exported kernel function in `runner.ts`; the spec never contains
geometry. `mono-base-1 / mono-base-2` (parabola points, 1- and 2-strips), `pair-adopt` (pairs, extension cone
point p_j, adoption, harvest), `group-slab` (groups of 2s, slab-restricted rotation), `bichromatic-base-1` (base
plus dyadic tilt), `bichromatic-pair-tilt` (pairs, p_j, tilt search, Maker-only harvest). The round counts and
units come from the spec's formulas; the Breaker allowance is injected into the executor context
(`Ctx.allowance`), so the declared formula, not a constant in the executor, decides how many Breaker replies follow
each Maker move.

## 4. Predicates and certificates

A *phase certificate* (`PhaseCertificate`) records, per executed phase, the log range, the strip counts and the
verdict of every declared pre/post predicate with a human-readable detail. All predicates are exact checks over plain
data (`PhaseEnv`: start/end frame and board, inputs, outputs, the phase's log slice, the level report; `RunEnv`
for run level) and are implemented with kernel predicates only:

| predicate | scope | what it checks (exact kernel predicate) |
|---|---|---|
| `board-empty-at-start` | pre | base phases start on the empty board |
| `inputs-count` | pre | at least `inputStrips` strips delivered below |
| `inputs-are-strips` | pre | each input has level - 1 vertices and passes `isStrip` (Definition 2) on the start board |
| `inputs-pairwise-parallel` | pre | `parallel` on all inputs |
| `base-distinct-x` | post | monochromatic base: distinct abscissae |
| `apex-in-gap` | post | p_j strictly between the unit's strips / right of earlier groups (pairing rule) |
| `apex-in-cones` | post | p_j in C+ of the left and C- of the right strip (pair) or in every C- (group): `extensionCone`, `coneContains` on the start board |
| `phase-accounting` | post | Maker moves = formula, Breaker replies after move m = allowance(m), Maker-first rounds, numbering/levels, board grows by exactly the moves |
| `ledger-arithmetic` | post | level-report arithmetic: survivors = delivered, breakerMoves = Breaker points, guaranteedAtEnd <= survivors, categorised points <= Breaker moves |
| `survivor-selection` | post | at most one delivered strip per unit, inside its unit's x-span (in the start frame) |
| `outputs-count / -are-strips / -pairwise-parallel` | post | delivered strips: >= need, level vertices and `isStrip` on the end board, `parallel` |
| `outputs-maker-only` | post | bichromatic: every delivered vertex is a Maker point |
| `params-in-verified-domain` | run pre | the configuration is in `verified` |
| `claims-verified-base-coordinates` | run post | every claim: k vertices, `isStrip` on the final board in BASE coordinates |
| `claims-pairwise-parallel / -at-least-goal / -maker-only` | run post | `parallel` on all claims; count >= t; bichromatic Maker-only |
| `rounds-match-plan` | run post | rounds executed = sum of the spec's Maker-move formulas |
| `log-legal` | run post | `replayLog`: general position, distinct x in mono base, frame consistency, alternation |

`certificateTable(run)` and `specTable(spec)` return these as plain, JSON-serialisable rows for display layers; the UI
was not modified.

## 5. Validation (`validateSpec`, rules K1-K9; the analogue of G1-G11)

| rule | requirement |
|---|---|
| K1 | at least one phase, unique ids, a non-empty verified list |
| K2 | every phase has non-empty pre and post lists; every predicate id exists in the right registry (phase / run); no duplicates |
| K3 | at every level 1..12 exactly one phase applies (no gap, no overlap) |
| K4 | transitions form the recursion: every recursive phase goes to exactly level - 1 and demands exactly the strips it consumes; terminal iff a base primitive; primitive / kind / variant are consistent |
| K5 | formulas only use variables in scope and evaluate to non-negative integers; Maker moves = units in recursive phases; terminal phases have no units/inputs |
| K6 | allowed responses non-empty and known; `general-position` always; `distinct-x` exactly in the monochromatic base phase |
| K7 | certificate completeness: required pre/post predicates per phase kind and per variant (e.g. cones, accounting, survivor selection, Maker-only) and the required run-level predicates |
| K8 | budget formulas equal the kernel's `estimateCost` level by level (strips, Maker moves, Breaker moves, units, inputs, total rounds) and the paper's recurrence: integer rounds in [closed form, closed form + 1) |
| K9 | the claimed domain is well formed (k in [1,12], t >= 1, s matches `sRule`) |

K5 and K8 are evaluated on the verified points AND on a grid beyond them (k = 2..7, t in {1,2,3,5,7}, s in the rule's
sample set, instances up to 3000 rounds), because a formula that is only right on the verified points (e.g. `floor`
instead of `ceil`, which coincide for s = 1) must still be rejected. `runSpec` validates the spec first (memoised) and
refuses an invalid one with `integrity-failure / scope spec / predicate = <rule>`.

## 6. Typed outcomes (`SpecOutcome`)

| kind | when | carries |
|---|---|---|
| `completed` | goal met, every certificate and run predicate passed | certificates, the full `RunResult` |
| `uncovered` | parameters outside `verified` (also `s` missing / wrong for the variant) | reason; nothing is executed, no result |
| `rejected` | a Breaker response violates a phase's allowed class (`general-position`: duplicate / collinear; `distinct-x`) | phase, class, message |
| `integrity-failure` | an invalid spec (`spec`, rule id), a failed precondition / postcondition (`pre` / `post`, phase, **predicate id**), a failed run predicate, a replay mismatch (`replay`: `log-matches-strategy`, `log-complete`), or an executor invariant | scope, phase, predicate, message |
| `incomplete` | `refused` before execution (budget preflight) or `budget-exhausted` mid-run | message; no claims are reported |

The legacy `RunResult` (status, message, log, claims, levels, checks) is returned alongside whenever something ran, with
the same status/message strings as `runKStrip`.

## 7. Equivalence evidence (regression proof)

Test inventory of the spec layer: equivalence 57, expr/validator 17, predicates 28, interpreter 29, replay 29, property 5,
lab rows 11 (176 new tests); full suite 1277 tests, `kstrip/` line coverage 95.9 % (gate 90 %).

`tests/kstrip/spec/equivalence.test.ts`: for every verified configuration x {random-legal (seed 7), greedy-blocking,
strategy-aware}, `runSpec` and `runKStrip` produce identical `status, message, goalMet, rounds, work, points, log,
levels, checks, claims` — compared as canonical JSON (Rat serialises as "n/d"), i.e. byte-identical move logs. All
certificates pass in each run. Property test (`property.test.ts`): 60 random seeds over 8 cheap verified configurations
with the seeded random Breaker. The equivalence is meaningful because the spec path computes the phase selection, the
strip demands, the round counts, the unit counts and the Breaker allowance from the declared formulas (the legacy
`build()` carries its own copies of them) and applies a separately written guard to every Breaker move.

## 8. Deterministic replay through the spec path (`replaySpec`)

The interpreter is run with a policy that plays back the recorded Breaker moves (their frame coordinates); Maker's
moves are re-derived by the strategy; the log is accepted only if the regenerated log serialises identically.
Negative cases (tests/kstrip/spec/replay.test.ts, property.test.ts): a changed Maker move or any edited field ->
`integrity-failure log-matches-strategy` naming the move; an illegal Breaker move (duplicate) -> `rejected general-position`;
truncated log -> `log-complete`; trailing moves -> `log-matches-strategy`; a replaced but legal Breaker move is accepted
only if the strategy's regenerated play equals the tampered log (it is then a legal alternative play, not a forgery).

## 9. Mapping: requirement -> code -> test

| brief requirement | code | test |
|---|---|---|
| executable, parameterized strategy | `runSpec` (interpret.ts), `planFromSpec` (plan.ts) | equivalence.test.ts; property.test.ts (formulas) |
| preconditions, postconditions | `runPre/runPost`, `PhaseSpec.pre/post`, predicates.ts | predicates.test.ts (every predicate, negative data); interpret.test.ts (pre/post violations name the predicate) |
| proof-state schema / strip invariants | `PhaseEnv`, `inputs-are-strips`, `outputs-are-strips`, `*-pairwise-parallel` (isStrip, parallel) | predicates.test.ts |
| allowed responses | `allowedResponses`, guard in interpret.ts, K6 | interpret.test.ts (rejected: duplicate, same-x, collinear; no distinct-x in bichromatic) |
| pairing rules, candidate regions, extension moves | `pairing / candidateRegions / extensionMove` fields (descriptive), `apex-in-gap`, `apex-in-cones` | predicates.test.ts |
| survivor selection | `survivorSelection` field, `survivor-selection` predicate | predicates.test.ts |
| round and budget accounting | formulas, `phase-accounting`, `ledger-arithmetic`, `rounds-match-plan`, K8 | expr-validate.test.ts (K8); property.test.ts (closed forms); predicates.test.ts |
| transitions (the recursion) | `transition`, K3/K4 | expr-validate.test.ts (invalid transitions named) |
| spec separate from geometry | primitives table (section 3); `kstrip/spec` imports the kernel, the kernel does not import the spec | architecture.test.ts (layering); equivalence.test.ts |
| typed outcomes | `SpecOutcome` | interpret.test.ts |
| unsupported parameters never guessed | `verified`, `params-in-verified-domain`, `uncovered` | interpret.test.ts (11 uncovered cases) |
| deterministic replay, tampered log rejected | replay.ts | replay.test.ts; property.test.ts |
| machine-readable table for the UI | table.ts | interpret.test.ts (tables) |
| lab rows reflect reality | encodings.ts, classify.ts | tests/lab/kstrip-encodings.test.ts; tests/lab/regimes.test.ts |
| mutation testing | section 11 | the suite above |

## 10. Honest limits

* **No arbitrary-k claim.** The spec claims exactly the `verified` table. The recursion's guarantee is a theorem of the
  paper; here it is an exact check per run (every claimed strip re-verified, certificates per phase) plus equivalence with
  the reference executor over three policies and property tests over seeded random Breaker play, not a proof for all Breaker
  behaviours. Policies are heuristics; no minimax.
* **Partly declarative.** Formulas, level selection, recursion, allowed responses, certificates and the domain are data and
  drive execution; the geometric acts (pairing, cone/apex choice, adoption, group extension, tilt search) are kernel code
  behind primitive ids; `pairing / candidateRegions / extensionMove / survivorSelection` are descriptive fields enforced by
  predicates, not interpreted. The Breaker's strategy is not part of the spec (it is the opponent).
* **Not in `src/strategy` / `src/verification`.** The spec layer is a sibling of the engine, so the UI-playable
  engine, the G1-G11 registry, the replay format and the verification pipeline do not know it. Its own validator (K1-K9) and
  certificates play that role.
* **Predicates share the kernel's primitives.** `isStrip`, `parallel`, cones and `replayLog` are the same exact functions the
  executor uses; they are cross-checked by the independent oracle (`scripts/audit/kstrip_oracle.py`, tests/kstrip/oracle.test.ts),
  not re-derived here. The certificate adds a second, separately written layer of checks (frame-independent base-coordinate
  claim verification, accounting, spans), not a second geometry.
* **Mutation testing is manual** (section 11), over the new interpreter / validator / predicates / replay / spec data only.
* The k = 1 base primitive is not in any verified configuration (the lowest verified k is 2); it is exercised only through a
  hypothetical spec in interpret.test.ts, which matches `runKStrip`.
* Corrected claim: bichromatic k = 3, s = 3/2 is verified for r = 1 only (r = 2 needs 500 points; default budget 400 refuses).

## 11. Mutation testing of the new code

73 hand-made single-point mutants of the new code (`src/kstrip/spec/`: expr 5, plan 9, validate 18, interpret 14, replay 4,
predicates 17, spec data 6), each applied to a clean tree, run against the spec test files tiered fast-to-slow
(`expr-validate`, `predicates`, `interpret`, `replay`; then `property` and the lab rows; then the 57-test `equivalence`
file for any survivor) with `--bail=1`, source restored after each. The runner (`mutate.cjs`) was a throw-away
script; the mutant list is recorded here.

**Result: 64 killed, 8 survived, 1 removed as dead code (73).**

First pass: 53 + 6 killed, 13 survived, 1 pattern not applied. The survivors led to four test additions and one
deletion, after which the re-run killed the five that were killable:

| mutant | outcome | what it taught |
|---|---|---|
| plan: `eps = 2 + s` | survived -> **dead code removed** | `eps` was an unused expression variable; deleted from the language |
| validate K3: last level 12 unchecked | survived -> **killed** (new test: a spec with a gap only at level 12) | |
| validate K4: descent by exactly one unchecked | survived -> **killed** (new test: a transition skipping a level) | |
| validate: formula grid disabled | survived -> **killed** (new test: `floor` for `ceil` in the bichromatic unit count, invisible on the verified points where 2*need/(2-s) is integral) | the grid beyond the verified points earns its keep |
| pred apex-in-cones: open instead of closed cone | survived -> **killed** (new test: a point straight below the left strip's last vertex) | closed-cone semantics |
| pred outputs-maker-only: owner ignored | not applied (bad pattern) -> **killed** after fixing the pattern | |

The 8 survivors, all **redundant defence in depth, not behaviour gaps** (another rule or predicate that is checked
independently rejects every spec/run that the mutated check would have rejected; reasoning, not a proof):

| mutant | why it survives |
|---|---|
| validate K8: paper window upper bound `>=` -> `>` and lower bound dropped | the window is implied by the per-level equality with `estimateCost` (K8), which is derived from the same recurrence; the window is a second, independent statement of the paper's recurrence kept for readability of failures |
| validate K8: units / input strips / strip demand / total rounds unchecked | each is implied by the other K8 comparisons plus K4 (supply = demand) and K5 (Maker moves = units): a spec wrong in one is wrong in a compared one |
| interpret: goal-not-met branch of the run-level message | unreachable for a validated spec: the phase postcondition `outputs-count` (>= need) rejects the run first, so `claims-at-least-goal` cannot fail alone |
| interpret: `rounds-match-plan` compares with itself | the executor and the plan use the same formulas for a validated spec (K8); the predicate itself is killed at unit level (`predicates.test.ts`) |

Not covered by mutation testing: the kernel (`src/kstrip/*.ts`, 16 mutants recorded in `docs/KSTRIP.md` section 8), the
lab rows (covered by the encoding tests), and `runner.ts` refactoring (covered by the 57 equivalence runs plus the existing
`tests/kstrip` suite).
