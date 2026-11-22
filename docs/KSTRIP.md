# KSTRIP — headless core of the recursive k-strip strategy

Source: Džuklevski et al., *Erdős–Szekeres Maker–Breaker Games* (arXiv:2505.15366; Theoretical Computer Science 1077 (2026), 115999), §2–§3
(Definition 2, Theorems 3/4/5, Observation 6) and proposal §7. Code: `src/kstrip/`, tests:
`tests/kstrip/`, independent oracle: `scripts/audit/kstrip_oracle.py` (+ fixture
`tests/kstrip/fixtures/strips.json`). Layering: `kstrip/` imports `geometry/` only (lint zones +
`tests/architecture.test.ts`); no UI file was touched. Coverage gate: `kstrip` >= 90 % lines
(`scripts/check-coverage.mjs`).

Claim tiers used below: **T** theorem of the paper (not proved here), **C** construction of the
paper implemented as code, **I** implemented convention (a choice the paper leaves open), **X** exact
runtime check (an exact predicate evaluated on the actual board), **R** randomized evidence.
Nothing here proves arbitrary-k strategy execution; see "What is NOT verified".

## 1. Formal representation

* All coordinates are exact `Rat` (bigint). No floating point, no clipping. Screen clipping of the
  unbounded regions is a separate, one-way, *illustrative* rendering step that does not exist in this
  layer.
* **Frame (I, exact).** A direction v (v.y != 0) is reduced to the downward direction d = (0,-1) by
  the exact affine map T(x,y) = (x - (v.x/v.y) y, ±y) (`frame.ts`); T preserves convex position,
  hulls, Minkowski sums with a halfline, interiors and boundaries. "P is a strip w.r.t. v" is
  therefore evaluated as "T(P) is a downward strip in T(S)". The oracle evaluates Definition 2 *without*
  any frame (truncated hull) for v in {(0,-1), (1/3,-1), (-2,-1), (1/2,-2), (0,1), (1,1)} and agrees on
  every generated instance (`tests/kstrip/oracle.test.ts`).
* **Strip region (X).** `StripRegion`: vertices s'_1..s'_k with strictly increasing frame-x and strictly
  concave chain; closed region C = {x' in [x'_1,x'_k], y' <= chain(x')}, an *unbounded polygon with two
  rays* (`describe()` returns `{chain, dir, rayFrom}`). `classify(p)` -> interior / boundary / exterior
  with `orient` only. k = 1: C is the ray p+v (empty interior; every point of it is a boundary point).
* **`isStrip(P,S,v)` (X)** = Definition 2: P ⊂ S, int(C) ∩ S = ∅, ∂C ∩ S = P; plus the strictness
  convention (I): no two vertices on one v-line, no collinear triple (the paper works in general
  position). Typed failure codes: `empty-set, vertex-not-in-S, duplicate-vertex, shared-projection,
  not-cap, interior-point, boundary-point`.
* **`parallel` (X)**: same direction and *disjoint closed* regions, which in the frame is "closed
  x'-projections disjoint". `interiorsDisjoint`, `sharedHalfline` give the Observation-6 form
  (closed regions meet exactly in a v-halfline from a shared vertex). `isCap`/`isCup`: Definition 1.
* **Fail-closed typing.** Every operation returns `{ok:true,...} | {ok:false, reason:{code,...}}` or a
  run status in {completed, budget-exhausted, refused, unsupported, invalid-breaker-move,
  invariant-failure}. "Refused before execution" and "budget exhausted during execution" are distinct
  and an incomplete run never reports claims.

## 2. Extension cones (paper §2, `cone.ts`)

C- (at s_1) and C+ (at s_k) are the intersection of {x' on the cone's side of the apex} and
{below-or-on the stopping ray}; the ray is the first of (edge line L-/L+, direction of any point of S
strictly on that side) met by the sweep, compared with `orient` only (C). Exposed: `extensionCone`,
`coneContains` (closed/open), `coneSectionTop` (the section by a v-line is a closed downward halfline,
never empty), stop kind `edge-line | blocked(q) | horizontal-convention`.

`extendStrip(P,S,p,v)` returns the strip P ∪ {p} (re-verified with `isStrip`, X) or a typed reason:
`not-a-strip, p-in-P, p-wrong-side, above-edge-line, cone-blocked(blocker), degenerate (p on a boundary
line)`. Findings:

* The paper's text defines the second cone as "C-" again; it is C+ (typo).
* The cone condition is **sufficient, not necessary**: a blocking point *farther* in x than p does not
  obstruct p. `stillStrip` in the reason reports the exact verdict; on the oracle data the combined
  verdict matches the definition on every case (`oracle.test.ts`).
* Cones are defined by the paper for k >= 2. For k = 1 we use the horizontal ray as the limit (I,
  conservative: soundness only, verified).

## 3. Pairing (Theorem 3, `pairing.ts`, `runner.ts`)

For strips S_{2j-1}, S_{2j}: l_j = the vertical line at the first free dyadic fraction of the gap
(1/2, 1/4, 3/4, ... of the gap, avoiding every x of S) (I); the halfline l_j ∩ C+_{2j-1} ∩ C-_{2j} is
{x = c, y <= min(top_+, top_-)} (X, exact); p_j = the point at y = top - g for the smallest integer
g >= 1 keeping general position (I; the paper says "arbitrary", and lower p only shrinks regions).
Candidate regions R_{2j-1}, R_{2j}; the runner asserts at runtime that their interiors are disjoint and
that they share exactly the halfline below p_j (X).

**Adoption (C, X).** A Breaker point on the halfline below p_j / below s_{2j-1,1} / below s_{2j,k-1}
replaces that vertex; `settlePair` picks the lowest such point, which keeps the chain strictly concave
(a vertex moved down on its vertical line) and only shrinks the region (property test, 150 runs).
Observation: because a vertex lies on its boundary line, *general position allows at most one Breaker
point on each such line* (two would be collinear with the vertex), so "lowest of several" never occurs
in legal play; it is kept for robustness.

**Harvest.** One strip per surviving pair (the two candidates of a pair share a halfline, so they are
not parallel; the paper's "t indices" count is per pair). Each claimed strip is re-verified with
`isStrip` on the final board (X) and the chosen strips are checked pairwise parallel (X).

## 4. Counting ledger (`ledger.ts`)

Per unit (pair / group): interior blockers, boundary points, absorbed points (adopted vertices and
removed boundary points), live regions, `need` (further Breaker points to kill it), plus
`guaranteedSurvivors = U - dead - maxFurtherKills(remaining budget)`, an exact lower bound on the final
survivors for *any* continuation (argument in the file header: regions only shrink, interiors are
disjoint so one point is in at most one region). Proposition 1 as *worded in the paper* ("at most t
indices with >= 2 Breaker points in the interior of R_{2j-1} ∪ R_{2j}") is reported separately
(`proposition1`); it is weaker than what the ledger bound uses (a pair dies only if BOTH regions hold
a blocker, which is the proposal's wording). Property tests (`counting.test.ts`) drive the executor with
arbitrary legal Breaker sequences (random, interior, on the shared halfline, directly below end
vertices, above p_j) and assert final survivors >= t and `t <= guaranteedSurvivors <= survivors` at
every Breaker move (R).

## 5. Recursion and cost (`recursion.ts`)

* r(1,t) = t/2, r(2,t) = t, r(k,t) = r(k-1,4t) + 2t (k >= 3). Closed form (5/3·4^(k-2) − 2/3)·t is an
  **equality** (checked exactly, k in 2..14, t up to 500). The paper's Theorem 3 says "at most", the
  proposal (§7.6) says "<="; both are true but weaker.
* Biased: r(1,t) = t/(s+1), r(2,t) = 2t/(s+1), r(k,t) = r(k-1,4st) + 2t for k >= 3 **only** (at k = 2 the
  recurrence would give r(1,4st)+2t ≠ r(2,t)); closed form ((4s)^(k-2)/(s+1) + ((4s)^(k-2)−1)/(4s−1))·2t
  verified equal for k in 2..9, s in 1..9. s = 1 reduces to Theorem 3.
* `estimateCost(spec)` reports levels, rounds, points, regions, peak strips and an abstract work
  figure *before* execution; `DEFAULT_BUDGET` (400 points, 250 rounds, 1000 regions, 2e9 work) refuses
  k = 6 at t = 1 (852 points) and above. Integer rounds executed equal the estimate (tests); where the
  paper's closed form is fractional the executor uses ceilings at the base only.

## 6. Executor (`runKStrip`)

`runKStrip(k, t, breakerPolicy, budget?, {variant, s})`; log entries carry who/what/phase/level/round,
base and frame coordinates, and (for Breaker) a machine-readable reason; `replayLog` re-validates a log
without a policy.

| variant | construction | status |
|---|---|---|
| `mono-1:1` (Thm 3) | base (2t_2 points, consecutive-x pairs), pairing + adoption | verified for k = 2..5 (t = 1), k = 3 (t <= 3), k = 4 (t = 1) |
| `mono-1:s` (Thm 4), s integer | groups of 2s, C- cones, slab-restricted rotation | verified for k = 3 (s = 2, 3), k = 4 (s = 1, 2), t = 1 |
| `bichromatic` (Thm 5), s in [0,2) rational | 2t strips, t points, tilt delta | verified for k = 2 (s = 1, 3/2; r <= 2), k = 3 (s = 0, 1; r <= 2; s = 3/2: r = 1 only — r = 2 needs 500 points, refused by the default 400-point budget; corrected in) |

Legality: general position always; in the **monochromatic base phase also distinct x** (the paper's
"WLOG distinct x"); x-ties are legal in later phases, where they only matter below a vertex (adoption
handles it) or above one (outside every region). Maker's base points lie on y = x² (+ offset for
general position) at fresh integer abscissae (I).

### Theorem 4: deviations from the text (I)

* The paper rotates L(s_{i,1}) over **Breaker's** points only and does not restrict where the hit point
  lies. We rotate over **all** points of S ∪ {p_j} with x in [l_j.x, s_{i,1}.x). Rationale: Maker's own
  p_j can be the first point met (then S_i ∪ {p_j} is the strip), and without the slab restriction the
  extended region of S_i could reach into the x-range of another group's strips, so strips of different
  groups would not be disjoint (not parallel). The extension is re-verified exactly (X) and the
  harvested strips are re-checked parallel (X). Unverified: the paper's literal (unrestricted) version.
* Group lines l_j: left of the group, right of every earlier group (as in the paper), dyadic rule (I).
* p_j is below min_i top(C-_i ∩ l_j) (the intersection of the groups' cone sections is a halfline).

### Theorem 5: reading and a counting gap

* Indexing: the paper's proof speaks of S_j and S_{j+1} for j in [2t-1]; we read it as the pairs
  (S_{2j-1}, S_{2j}), j in [t], with t extension points p_j (the disjointness claims need disjoint pairs).
* Breaker points cannot be adopted; claimed strips are Maker-only and the closed regions contain no other
  point at all (X: `isStrip` with S = all points, and an ownership check). Strips are w.r.t. a common
  tilted direction v = (delta, -1) chosen after Breaker's moves of the phase (below).
* Base level: 1-strips are single Maker points; after the tilt no point shares a v-line, so every Maker
  point is a 1-strip. The pairing step then uses the k = 1 cone convention (I) to get 2-strips.

#### Tilt conditions (`checkTilt`, runner.ts)

Our reading of Observation 6 and of the choice of direction in the proof of Theorem 5: after Breaker has
played B = floor(t s) points in the phase, Maker picks delta so that, in the tilted frame:
**T1** no two board points share a v-line (in particular no Breaker point lies on the v-line through any p_j);
**T2** each candidate S_i ∪ {p_j} is a strict cap; **T3** the two candidates of a pair meet exactly in the
v-halfline below p_j; **T4** closed regions of different pairs are disjoint; **T5** no point that was on the
board *before Breaker's moves of this phase* (Maker's points, Breaker's earlier points), other than a
candidate's own vertices, lies in a closed candidate region (the candidates are strips "disjoint from S");
**T6** every Breaker point of the phase lies in at most one closed region. T6 follows from T1, T3, T4 and is
also checked per point (`tiltPointVerdict`), because the counting rests on it.

*Existence.* At delta = 0 the candidates are strips with respect to the board at the time p_j is placed, and
their closed regions have pairwise disjoint x-projections except that the two candidates of a pair touch
exactly at x(p_j). T2-T5 are finite conjunctions of strict inequalities in delta, hence hold for all small
delta; T1 excludes finitely many values (x(q) + delta y(q) = x(r) + delta y(r) has at most one solution for
distinct q, r); the delta = 0 failure of T6 (a Breaker point exactly below an apex, in both closed regions) is
excluded by T1 for every delta != 0. So T1-T6 hold for all sufficiently small delta outside a finite set; the
dyadic search ±2^-n, n = 1..60, finds one unless the required smallness is below 2^-60, in which case the run
stops with the typed integrity failure "no admissible tilt found" (never with a silent success).

*Count.* Under T5/T6 the B Breaker points of the phase spoil at most B of the 2t candidates; a pair has no free
candidate only if both are spoiled (>= 2 points), so at least t - floor(B/2) pairs keep a free candidate, one
strip each, and strips of different pairs are parallel by T4. This is the `pre-tilt` ledger bound
U - floor(B/2). It needs T5: before T5 was enforced the search accepted the first direction in which every
Breaker point lay in at most one region, including directions in which an *earlier* Breaker point lay inside
a candidate, spoiling it at no cost to the phase budget. With k = 2, r = 1, s = 1/2 (two pairs, one Breaker
point in the phase, reported bound 2), earlier Breaker points placed in the shadow of the accepted direction
left 1 delivered strip (regression in `tests/kstrip/tilt.test.ts`). The acceptance now rejects such directions
(T5) and checks T4 explicitly instead of only through Breaker points.

*Intermediate states.* The pre-tilt bound is static (U - floor(B/2), B the phase total), so it is the same at
every state of the phase; the monochromatic ledger bound is recomputed after every move.
`tests/kstrip/ledger-soundness.test.ts` enumerates Breaker's pairing-phase moves over a cell grid (interior of
each candidate, the shared halfline, below each end vertex, above the apex, far) combined with earlier-phase
placements from a shadow grid, and checks at every ledger state of every play that the reported lower bound
does not exceed the number of units that really deliver a strip (bichromatic: recounted with `isStrip` on the
final board; monochromatic: verified claims). Exhaustive on the grid for k = 2, s = 1/2 (78 plays) and
k = 2, s = 1 (676 plays); sampled for bichromatic k = 3; all ordered cell pairs for monochromatic k = 3.
This is finite evidence on a grid; the argument above is the proof.

*What the UI shows.* The explorer prints the ledger's lower bound at intermediate states and at the end, before
the final re-verification of the claims. The final re-verification re-checks the strips that exist, not the
bound that was displayed, so it would not have protected that number; the acceptance condition itself had to
be fixed.

#### The counting step of the published proof (our reading)

*Reading.* Candidates are the 2t sets S_{2j-1} ∪ {p_j}, S_{2j} ∪ {p_j} (we read the proof's pairs as
(S_{2j-1}, S_{2j}), j in [t], t = ceil(r/eps); with the literal indices S_j, S_{j+1} for j = 1..t consecutive
pairs would share strips). Definition 2 calls two k-strips parallel if they are strips for the same halfline
and C1 = conv(P1) + v, C2 = conv(P2) + v are disjoint; both are closed, so sharing a halfline means "not
disjoint". Observation 6 itself distinguishes the two situations (second bullet: disjoint regions stay
disjoint; third bullet: regions meeting exactly in {s} + d keep meeting exactly in {s} + v), and the proof of
Theorem 5 states that the two candidates of a pair "intersect only in the line p_i + v". In Theorem 3 the proof
counts one strip per index j (>= t indices out of 2t). Under this reading the two candidates of one pair are
not disjoint, hence not parallel.

*Consequence.* The pigeonhole (each Breaker point in at most one candidate region; 2t - (2 - eps)t = eps t free
candidates) is confirmed; it counts free *candidates*. Whether "eps t >= r disjoint strips" follows depends on
the free candidates lying in distinct pairs, which Definition 2 as written does not give.
`tests/kstrip/bichromatic-count.test.ts` is an exact play with eps = 1/2, t = 4 (the proof's t for r = 2): 8
candidates, 6 Breaker points occupying the interiors of the candidates of pairs 1-3; the two free candidates
(`isStrip` on the final board) are the two candidates of pair 4; they meet in the halfline below p_4
(`sharedHalfline`; `parallel` false), so one parallel strip results, not two. We read this as a gap in the
counting step as literally written, not as a refutation of Theorem 5: with t = ceil(2r/eps) at least
t - floor(floor(t s)/2) >= t eps / 2 >= r pairs keep a free candidate, giving r parallel strips. The published
statement is not declared false; under a reading in which candidates sharing the apex halfline count as
disjoint (cf. the third bullet of Observation 6) the published constant would suffice.

*Boundary points.* A Breaker point on the shared halfline lies on the boundary of both candidates, so by
Definition 2 (`int(C) ∩ S = ∅`, `∂C ∩ S = P`) it spoils both (exact fixture in `tilt.test.ts`: at delta = 0 both
`isStrip` calls fail with `boundary-point`). The choice of delta excludes this (T1): after the tilt the point is
off the v-line through p_j and lies in at most one region. "A Breaker point spoils at most one candidate" is
therefore a property of the chosen direction (T1, T4, T5), not of the vertical frame.

*Soundness of the implemented construction.* It uses t = ceil(2r/eps) and the bound t - floor(B/2) with
B = floor(t s): for every rational s in [0,2), floor(B/2) <= ts/2, so t - floor(B/2) >= t eps / 2 >= r. Each
level demands 2t strips from the level below (Maker-only, parallel, by induction). The verified configurations
(k = 2: s = 1, 3/2 with r <= 2; k = 3: s = 0, 1 with r <= 2, s = 3/2 with r = 1) satisfy the arithmetic (e.g.
s = 3/2, r = 1: t = 4, B = 6, 4 - 3 = 1) and were executed with every shipped policy; T1-T6 are enforced at run
time and claims are re-verified exactly. Conditional parts: the search bound 2^-60 (typed failure otherwise) and
the budget (k = 3, s = 3/2, r = 2 needs 500 points, refused by the default 400-point budget before execution).

## 7. Breaker policies (`policies.ts`) — heuristics, no optimality claim

`createRandomLegalPolicy(seed)` (seeded bigint xorshift), `createGreedyBlockingPolicy()` (interior point
of the first live region), `createStrategyAwarePolicy()` (reads the ledger: ignores units not killable
with the remaining budget, picks the cheapest killable unit, finishes one-blocker units first, always
plays strictly interior so nothing is absorbed). Each decision carries `{policy, code, summary, target,
data}`; tests check the point is strictly inside the named live region, the stated `need`/`remaining`
equal the ledger's, determinism, and a constructed state where greedy and aware choose different
targets. No minimax/MCTS.

## 8. Mutation testing (manual)

16 hand-made mutants, each run against the targeted test file(s) (`--bail=1`); source restored after each.

| # | mutation | result |
|---|---|---|
| M1 | C+ closed boundary made open | killed (region-cone) |
| M2 | cone sweep picks the last instead of the first hit | killed |
| M3 | adoption rule dropped | killed (pairing) |
| M4 | budget points cap off by one (`>` -> `>=`) | killed (recursion) |
| M5 | ledger maxFurtherKills off by one | killed |
| M6 | classify: on-edge point reported interior | killed |
| M7 | apex gap starts at 0 (apex on the cone boundary) | **survived — equivalent**: the apex on the boundary line is collinear with two board points and `canAdd` rejects it, so the next gap is used |
| M8 | pair top = max instead of min of the two cone sections | killed |
| M9 | group slab restriction removed | **survived at first** (the first slab test had no far-left steep point); strengthened test (`z` far left); re-run: killed |
| M10 | tilt accepts a Breaker point in two regions (`hits > 2`) | **killed** after the tilt conditions were made explicit (`tiltPointVerdict` is tested directly on overlapping regions; see section 6, Tilt conditions). The original gap was larger than the mutant: the acceptance did not distinguish earlier Breaker points from the phase's, and an earlier point inside a candidate was accepted (regression in `tests/kstrip/tilt.test.ts`). Variants M10a (`hits > 2`), M10b (cross-pair disjointness dropped), M10c (earlier Breaker points treated as phase points), M10d (earlier-point rule dropped): all killed. |
| M11 | closed-form coefficient 5 -> 4 | killed |
| M12 | bichromatic Breaker allowance +1 at m = 1 | killed |
| M13 | harvest ignores liveness of the left region | killed |
| M14 | monochromatic base phase: distinct-x rule dropped | killed |
| M15 | ledger: boundary points no longer block liveness | **survived — equivalent in legal play** (after adoption no boundary point can exist; it matters only for hand-built ledgers) |
| M16 | `isStrip` ignores boundary points | killed |

Totals (re-run after the tilt change, M1-M16 plus M10a-d): 18 killed, 1 survived (M7, equivalent: the apex on the cone boundary is collinear with two board points and is rejected by general position, so the next gap is used). M9 and M15 are killed by the current suite (M15 was previously argued equivalent). Defect (d), found by the M10 audit: tilt acceptance did not exclude earlier Breaker points from candidate regions, so the reported survivor bound could exceed the strips delivered (fixed; regressions in `tests/kstrip/tilt.test.ts`, soundness grid in `tests/kstrip/ledger-soundness.test.ts`).
Defects found while testing (each has a regression test in `tests/kstrip/regression.test.ts` or the oracle):
(a) Breaker can put two points on the planned line l_j before p_j (legal: no third point yet), after
which *no* point of l_j is in general position; the executor re-plans a free line in the same gap
using cones recomputed against the current board; the first version re-used the phase-start cones and
turned the spoiling points into interior blockers, which made the ledger lower bound exceed the true
survivors (found by the property test, fixed, regression-tested). (b) `extendStrip` reported
`not-a-strip` instead of `p-in-P` when p was already a vertex. (c) the cone condition is sufficient but not
necessary (oracle disagreement) -> `stillStrip` diagnosis.

## 9. What is NOT verified

* Execution for k >= 6 (budget-refused), t beyond the tested values, s beyond the tested values.
* The paper's unrestricted rotation in Theorem 4; the paper's count in Theorem 5 (shown insufficient
  for parallel strips); optimality of any policy; non-integer speeds beyond the floor(m·s) convention.
* The recursion's guarantee is a theorem of the paper; here it is an exact check *per run* plus
  property tests over sampled Breaker play, not a proof for all Breaker behaviours.
* k = 1 cone convention and all (I) items are choices, not statements of the paper.
