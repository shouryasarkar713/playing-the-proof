# K7_GATE.md — esmb-k7 (Das–Valla Lemma 8): reconstruction, proof, Week-7 gate

Status of this document: **our own derivation** (reasoning), plus the evidence the
test suite produces. Nothing here is a machine-checked proof; the strategy badge stays
`validated-randomized` (see §6). Source: Das & Valla, *On Erdős–Szekeres Maker–Breaker
games*, CGT 5(2) 2026, Lemma 8, Theorem 1, Figure 2 (p. 3:4). The paper's proof is a sketch;
every step below was re-derived.

## 0. Gate decision

**INTERACTIVE** (Proof mode + Break-the-Proof): every position class of B0 and of B1 was
verified by exact checks (§5); no branch is guided-only. Badge: `validated-randomized`
(unchanged discipline: finite exact checks + per-move runtime verification are not a proof
of the theorem).

## 1. Setting and notation

H = V0 V1 … V5 is an empty convex hexagon (a 6-hole in a general-position set; other points
lie outside H). Maker has just completed H; Breaker is to move (odd point count). Rounds: the
paper's arithmetic is verified — Lemma 6: 5-hole from 7 points in 4 rounds; Lemma 7: +2 rounds,
+4 points (B0, A1, B1, A2) → 6-hole from 11 points in round 6; Lemma 8: +2 rounds, +4 points →
**7-hole from 15 points in round 8** (7 + 4 + 4 = 15, 4 + 2 + 2 = 8). When Breaker's B0 is
harmless the game ends one round earlier (B0, A1 → 13 points).

Indices mod 6. Q_i = hull(V_i, V_{i+1}, V_{i+2}, V_{i+3}) are the six 4-holes ("halves"); the
three main chords are V_iV_{i+3}, i = 0,1,2, and Q_i, Q_{i+3} are the two halves of chord i.

## 2. The construction and its proof

**Step 0 (B0 outside H).** H stays empty ⇒ A1 extends it to a 7-hole (Edge-Extension Lemma). The strategy routes to `k7:immediate`.

**Lemma A (survivors) — discrepancy with the paper.** For B0 strictly inside H, B0 lies in
*exactly* one of Q_i, Q_{i+3} for each chord (Q_i ∪ Q_{i+3} = H, Q_i ∩ Q_{i+3} = the chord,
and B0 is on no chord by general position). So B0 lies in **exactly three** of the six 4-holes
(the paper says "at most three") and exactly three survive, one per chord: the survivor index
set S ⊂ Z6 has one element from each of {0,3}, {1,4}, {2,5}.

*Case classes (the 8 sign patterns of B0 against the three chords).* Six patterns are
"sector" patterns (S = three consecutive indices, e.g. {0,1,2}); two are "central"
patterns (S alternates: {0,2,4} or {1,3,5}). If the chords are concurrent only the six
sector patterns are realised; otherwise the three chords bound a central triangle realising
exactly one of the two central patterns (B0 in the central triangle). The paper's Figure 2 is
the central pattern S = {0,2,4}: B0 ∈ ADEF ∩ ABCF ∩ BCDE (the complements). Region
expressions for all eight patterns are in `k7/def.ts` (`patternExpr`); `central-024` /
`central-135` / `sector-…` are the route case ids.

**Lemma B (a shared-edge pair always exists).** S always contains i and i+2 for some i: check
the eight patterns — {0,1,2}→(0,2); {0,1,5}→(5,1); {0,4,2}→(0,2); {0,4,5}→(4,0); {3,1,2}→(1,3);
{3,1,5}→(1,3); {3,4,2}→(2,4); {3,4,5}→(3,5). (Central patterns contain *three* such pairs.)
Take Q_i = (A,B,C,D) and Q_{i+2} = (C,D,E,F) in the labelling where i = 0; they share the edge
CD (as vertex sets; as regions they overlap in the triangle C·X·D, X = AD ∩ CF).

**Lemma C (5-holes).** Q_i ∪ {B0} is a 5-hole whenever B0 ∈ H \ Q_i: it is convex iff B0 is on
the far side of chord AD (the other four turns at A, B, C, D are those of H, B0 being inside H),
and it is empty since the extra region is the triangle A D B0 ⊂ ADEF, whose vertices
E, F are extreme points of the convex quadrilateral ADEF and so are not strictly inside any
triangle contained in it; outside points are outside H. Likewise Q_{i+2} ∪ {B0}. The two 5-holes
ABCDB0 and CDEFB0 meet exactly in the triangle C D B0 (the paper's "two 5-holes intersecting in
one triangle"; checked exactly by `k7-inv:pair5`).

**Lemma D (A1; the open region).** Let R be the set of points x with
orient(C,D,x) < 0 (outside edge CD), orient(B,C,x) > 0, orient(D,E,x) > 0,
orient(D,B0,x) > 0, orient(B0,C,x) > 0. R is an open convex set (five open half-planes) and
for x ∈ R both H1 = (A,B,C,x,D,B0) and H2 = (C,x,D,E,F,B0) are in convex position: the six left
turns of H1 are at A (B0 inside H), B, C [orient(B,C,x)], x [outside CD], D [orient(x,D,B0)
= orient(D,B0,x)], B0 [B0 beyond AD]; those of H2 at C [orient(B0,C,x)], x, D [orient(D,E,x)],
E, F, B0 [B0 beyond CF]. At every point of the open edge CD all five inequalities except the
first hold strictly (using orient(C,D,B0) > 0), so R contains points arbitrarily close to
the edge's interior. Emptiness: H1 = ABCD ∪ T(C,x,D) ∪ T(A,D,B0), H2 = CDEF ∪ T(C,x,D) ∪
T(C,F,B0); the parts inside H are empty by Lemma C, E/F are extreme in ADEF / A, B extreme in
ABCF; the only new area is the thin triangle T(C,x,D) outside H, which contains no point for x
close enough to the edge (finitely many extra points, none on the closed segment CD).
Finitely many x violate general position. Hence a valid A1 exists for **every** B0 ∈ int H —
unlike k = 6 there is no "forced region": every interior B0 is answered by the same two-round
construction. (The k = 6 analogue needed Lemma W-style margins; here the margin is the same
kind of open-neighbourhood statement.)

**Lemma E (twins meet in a quadrilateral).** C B0 is a chord of H1 and an edge of H2, so
H1 ∩ H2 ⊂ H1 ∩ (half-plane of H2) = quadrilateral Q* = (C, x, D, B0), and Q* ⊂ both (its
vertices are vertices of both). So **H1 ∩ H2 = Q* exactly**, a convex quadrilateral in which
x = A1 and B0 are opposite vertices. Moreover D is an *ear apex* of H1 (its H1-neighbours are
A1 and B0) and C an ear apex of H2 (its H2-neighbours are B0 and A1); the diagonal A1B0 cuts
Q* into the two ear triangles T(A1,D,B0) ⊂ H1 and T(B0,C,A1) ⊂ H2. `twinQuadEars`
(geometry/twinsK7.ts) tests exactly this structure (shared count 4, exact area equality,
anchors opposite, one ear per hole with distinct apexes).

**Lemma F (B1 survival) — where the paper's wording needs care.** Let B1 be any legal point.
(i) B1 ∉ int H1 ⇒ H1 survives; (ii) B1 ∉ int H2 ⇒ H2 survives; (iii) otherwise
B1 ∈ int H1 ∩ int H2 = int Q* and **both original holes are dead** — the paper's claim that
"B1 can be inside at most one of the triangles" is true but is not by itself the survival
statement: a B1 in Q* kills *both* H1 and H2 (counterexample: the centroid of T(A1,D,B0) in
the shipped Figure-2 fixture, `k7.test.ts` "kills BOTH twins"). What saves the construction is
the **ear replacement** the paper mentions in its example: B1 lies in the ear T(A1,D,B0) or the
ear T(B0,C,A1) (diagonal excluded by general position). In the first case
(A,B,C,A1,B1,B0) is a 6-hole: replacing the apex D of the convex hexagon H1 by a point of its ear
triangle keeps convexity (turns at B0, B1, A1 are left because B1 is inside the triangle
(A1,D,B0)), and it is empty because it lies inside H1, whose only interior point was B1. The
second case is symmetric (H2 with C replaced). So a 6-hole survives for **every** B1. The
classifier `classifyB1Hex` sorts B1 into: `inside-ear-A`, `inside-ear-B` (replacement
hole), `inside-twin-A` / `inside-twin-B` (one twin untouched), `else`.

**Lemma G (A2).** Extend any surviving 6-hole by the Edge-Extension Lemma → 7-hole.

## 3. Implementation map

| step | node | exact artifacts |
|---|---|---|
| B0 sort | `k7:boot` (classify; 8 pattern routes + outside) | region exprs, case map |
| survivors/pair | `k7:pairing` (`select-chord-half-pair`) | `k7-inv:pair5` |
| A1 | `k7:r1:escape` (`escape-pair-beyond-edge`) | R overlay, `k7-inv:twins6` |
| bind twins | `k7:r1:twins` (`select-twin-holes`, enumerated) | `k7-inv:twinpair6` |
| B1 sort | `k7:r1:classify` (`classifyB1Hex`) | post `exists-k-hole 6` |
| A2 | `k7:r2:extend` (extend, enumerate 6-holes) | post `exists-k-hole 7` |
| B0 outside | `k7:immediate` | post `exists-k-hole 7` |

A1 search convention (honest limit): near-first halving toward the midpoint of CD along the
outward normal (reusing `escapeNearEdge`, 256 halvings × 4096 s-values × 60 000 evaluations),
accepting only points that pass `twinQuadEars` on the hypothetical state. Lemma D shows an
accepted point exists; the search is bounded, so a pathological margin below ~1e-77 or a window
too small for the thin triangle ends as a typed `uncovered / window-exhausted` terminal (or
the post-condition's integrity failure with a captured fixture) — never a silent guess. Start
sets are limited to `N_BOOTSTRAP_EXACT = 12` points (exact P3 pre-check); a Lemma-7 chain from
the preset pentagon has 9–11 points.

## 4. Discrepancies and findings vs the paper

1. "at most three" 4-holes contain B0 → **exactly three** (general position).
2. The paper analyses only the central-triangle pattern and says the rest are "analogous by
   symmetry". The sector patterns are not images of the central one; they are handled by
   Lemma B (one valid pair instead of three). The central triangle exists in only one of the
   two orientations and only when the main chords are not concurrent.
3. B1 inside the shared quadrilateral kills both 6-holes; survival rests on the ear replacement
   (Lemma F), not on "inside at most one of two triangles" alone.
4. Unlike Lemma 7, **no** B0 inside the hexagon is "immediately losing for Maker" and there is
   no forced region / ear exception: the construction applies to every interior B0.
5. No error was found in the stated counts (15 points, 8 rounds); the sketch's example
   (B0 in ADEF∩ABCF∩BCDE, A1 beyond CD, twins ABCA1DB0 and CA1DEFB0) is exactly case
   `central-024` with shared edge CD.

## 5. Week-7 gate: evidence

Layers (all exact rationals; leaf claims confirmed by an **independent oracle** —
`tests/strategies/k7oracle.ts`, plain bigint integers, no `src/geometry` import, using the
"every triple's triangle is empty" criterion of):

1. *Structure* (Lemmas A–G above) — reasoning.
2. *Cell-exhaustive trees* (`tests/slow/k7gate-cells.test.ts`, `k7gate-engine.test.ts`):
   random hexagons from five families (integer, rational, nearly-concurrent main chords,
   near-collinear "flat", needle), each with one legal extra point; **every** cell of the exact
   line arrangement of the B0 plane (representatives via `arrangementCells` +
   `canonicalInteriorPoint`; inside-hexagon cells all, outside cells capped), A1 by the strategy,
   then **every** cell of the post-A1 B1 arrangement; leaf = independent oracle finds a 6-hole
   (cells test) / full engine pipeline ends in an oracle-confirmed 7-hole (engine test, B1 cells
   strided). Results: see §5.1.
3. *Seeded games* (`tests/slow/k7driver.test.ts`): 5×40 random-hexagon games and 60 chains
   k=6 win → promotion → k=7 win.
4. *Mutation testing*: §5.2.

### 5.1 Results

All runs: 0 failures.

| layer | hexagons | B0 cells enumerated (all / inside H) | leaves (B1 cell representatives) |
|---|---|---|---|
| cells + independent oracle (6-hole survives B1), integer / rational / nearly-concurrent / flat / needle = 6 / 6 / 6 / 5 / 5 | 28 | 4 499 / 1 260 | **141 466** |
| full engine pipeline, 2 hexagons per family, every second inside-B0 cell, every sixth B1 cell; each leaf = terminal maker-won, 7-vertex witness, oracle 7-hole | 10 | 1 604 / 450 | **4 255** |
| seeded games (`k7driver.test.ts`): 5 families × 40 games; 60 chains k=6 win → promote → k=7 | — | — | all won, oracle-confirmed |

B0 classes realised in the cell runs (all eight chord-side patterns plus outside):
`sector-012/123/234/345/045/015`, both `central-024` and `central-135`, `outside-hexagon`
(plus B0 placements that already complete a 7-hole by themselves). B1 classes realised:
ear A, ear B, twin A only, twin B only, else — and B1 placements that complete a 7-hole by
themselves (Breaker-completed wins, labelled with the previous case). Cells are exact:
representatives come from `arrangementCells` over **all** pair-lines of the placed points
(B0 plane: hexagon + extra point; B1 plane: + B0 + A1), so every combinatorially distinct
position of B1 relative to every placed point pair is exercised, including positions that are
extreme in the window. Hexagon families include nearly-concurrent main chords (tiny central
triangles of either orientation), near-collinear and needle hexagons (stress for the A1
halving search; the search always succeeded). Reproduce:
`K7_GATE_EVIDENCE=<file> npx vitest run --project slow tests/slow/k7gate-cells.test.ts tests/slow/k7gate-engine.test.ts`
(≈ 44 min on the development machine).

### 5.2 Mutation results

17 hand-written mutants (one at a time, run against `tests/strategies/k7.test.ts`,
`k7units.test.ts`, `k7promotion.test.ts`): anchors-opposite check removed, area-equality check
removed, 5-hole emptiness guard in `chordHalfPair` removed, distinct-apex check removed,
shared-hull-length guard removed, A1 acceptance `isKHole` removed, ear-A tag swapped, ear-B
triangle replaced by ear-A's, B0 pattern half-plane sides flipped, boot route target changed
to `k7:immediate`, A1-region edge half-plane flipped, shared edge reversed in the pairing
binds, twin-selection anchors degenerated, `pair5` second-hole guard replaced by `true`,
export hole var hard-wired to `P5`, promotion parity guard removed, twin overlay label
hard-wired to "5-holes".

First pass: 12 killed, 5 survived. The three real gaps (area equality, ear-A tag, ear-B
triangle) were closed by new tests (exact classifier-region mapping in `k7units.test.ts`; an
over-lapping-hexagons rejection test) and re-run: **killed**. Final: **15 / 17 killed**; the two
remaining survivors are justified, not ignored: `hS.length !== m` is an equivalent mutant (two
holes' shared vertices are a subset of a convex-position set, so their hull always has exactly m
vertices), and the `pair5` emptiness guard on the second 5-hole is a redundant defence (the
exact-area/convex-position test in `twinSharedPart` already fails for every constructible
non-hole, and the first-hole guard and the runtime post-conditions `twins6`/`twinpair6` still
cover the state). A mutation of the bootstrap budget constants turned out equivalent for
n ≤ 12 (actual enumeration cost 33 264 ≤ 55 440) and the constants were left untouched.

## 6. Evidence tiers (what this does and does not establish)

| tier | content |
|---|---|
| source theorem | Lemma 8 / Theorem 1 as published (cited, not re-proved by the app) |
| reconstruction | §2 (our derivation, not app-verified) |
| implemented convention | A1 halving search, canonical pair choice (first rotation), twin selection order |
| exact runtime checks | every move: `k7-inv:pair5`, `k7-inv:twins6`, `k7-inv:twinpair6`, post `exists-k-hole 6/7`, GP/window legality |
| finite exact validation | the cell-exhaustive trees above (finite families of hexagons — not all hexagons) |
| randomized | seeded games |

Hence `effectiveStatus(esmb-k7) = validated-randomized`; no `verified-conventions` promotion
(no recorded exact-check mapping exists for k7, by design).

## 7. UI integration requirements (nothing under `src/ui/**` was edited)

* Registration is done in `src/main.ts` (`esmb-k7`, tier `core`, classifier `classifyB1Hex`,
  checkers `k7-inv:*`). The entry screen lists it automatically through `listStrategies`
  ("esmb-k7 (k=7)" + derived badge). **Start works with no UI change**: `initSession` falls
  back to the shipped 7-point preset for `esmb-k7` when no `strategyStart` is supplied
  (`strategy/presets.ts defaultStartFor`).
* Recommended (cosmetic/consistency): in `ui/entry.ts startFor`, replace the
  `esmb-k6 / esmb-k6-wide` id test by `presetStartFor(strategyId)` (exported from
  `engine/describe.ts`; returns the record for k6, k6-wide and k7, `undefined` otherwise).
* **"Grow to 7" on a k=6 win card** (the only functional UI work): call the pure
  `growStartFromWin(shell.store.current())` (`src/engine/promote.ts`); if `ok`, start
  `shell.startProof("esmb-k7", result.start)` / `startBreak`; if not, show `result.message`
  (typed reasons `not-a-finished-win | wrong-k | breaker-completed-hole | too-many-points |
  bad-witness`; the even-count refusal is the same honest rule as "Grow to 6"). The existing
  `ui/modes/promote.ts` k=5 path can call the same function (it accepts k=5 wins too).
* Case ids to style/tint (they are data from the def, no UI knowledge needed beyond an optional
  legend): `k7:b0:{sector-XYZ|central-XYZ|outside-hexagon}`,
  `k7:b1:{inside-shared-quad-ear-A|inside-shared-quad-ear-B|inside-twin-A-only|inside-twin-B-only|else}`.
* Overlay labels are data (`node.show`): the boot node draws the hexagon, six 4-holes, the central
  triangles; the classify node draws twins (style `twin`, label now sized by hole size), the shared
  quadrilateral and the hexagon. The A1 region overlay lives on the (non-parked) `k7:r1:escape`
  node and is therefore visible only through `strategyOverlays`/timeline, not at a parked state.
* Replay export/import of k7 sessions works through the existing `strategyStartForExport`
  (hole var `P{k-1}`); no new file format.
