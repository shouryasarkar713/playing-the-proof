# K8_GATE.md — esmb-k8 (Das–Valla Lemma 9 / Theorem 2): reconstruction, round count, gate

Status: **our own derivation** plus the evidence the test suite produces. Source: Das &
Valla, CGT 5(2) 2026, Lemma 9, Observations 1–2, Theorem 2, Figures 3–5 (pp. 3:5–3:7; the
figures were rendered and read). The paper's argument is a sketch that analyses ONE instance;
every step below was re-derived. Nothing here is machine-checked; the badge stays
`validated-randomized`.

## 0. Gate decision

**GUIDED walkthrough (`verified-guided`), with free interaction only on the classes marked
interactive. THE EXHAUSTIVE GATE WAS NOT COMPLETED: see §5 for
exactly what was and was not verified.** The full branching k = 8 game is NOT claimed (stretch, out of scope). The
paper itself proves one instance of two steps (A1's twins, and Observation 2's A3); the
rest of the case analysis is not in the source. Each classify route carries
`interaction: interactive | guided | unverified` as DATA in the def (visible to the UI);
`unverified` routes end the session as a typed `uncovered / partial-encoding` terminal and
never run their target.

| class (route case) | interaction | what is established |
|---|---|---|
| `k8:b0:outside-heptagon` | interactive | 7-hole stays empty → Edge-Extension → 8-hole at A1 (proof + cells) |
| `k8:b0:inside-pair` | guided | a surviving chord-half pair always exists (Lemma B9, argued); A1: Lemma D9 is argued but NOT confirmed — the exact A1 search failed (typed uncovered) in 14 of 50 inside-pair cells of the preset heptagon (§5) |
| `k8:b0:inside-no-pair` | unverified | **empty class** (Lemma B9); kept as a fail-closed guard |
| `k8:b1:inside-shared-triangle` | guided | ear replacement + A2 (Lemmas E9, F9, proofs) |
| `k8:b1:elsewhere` | unverified | not in the source; ends as uncovered |
| `k8:b2:outside-seven` | interactive | X empty → extension (proof) |
| `k8:b2:inside-seven` | guided | A3 found by exact search; existence for every B2 is verified computationally (sampled + per-move exact post-condition), not proved |
| `k8:b3:seven-hole` | interactive | a 7-hole survives B3 → extension |
| `k8:b3:vertex-pair` | guided | Observation 2's shape verified exactly per move; coverage of all B3 is computational |
| `k8:b3:no-pair` | unverified | never observed in any run; ends as uncovered if it occurs |
| `k8:b4:*` (A / B / elsewhere) | interactive | two disjoint 7-holes ⇒ B4 kills at most one ⇒ A5 (proof) |

## 1. ROUND COUNT — the paper's "12" is not what its construction gives

Quoted briefly: Lemma 9 says Alice needs "5 more rounds … starting with a 7-hole"; Theorem 2
says "an 8-hole from 25 points in the 12-th round". Every Maker move of the construction:

| after the 7-hole | Breaker | Maker |
|---|---|---|
| (round 8 ends with the 7-hole) | B0 | A1 (two 6-holes meeting in a triangle) |
| | B1 | A2 (a 7-hole X and two 6-holes) |
| | B2 (must be inside X) | A3 (forcing pair) |
| | B3 (forced) | A4 (extends both 6-holes to two disjoint 7-holes) |
| | B4 | A5 (extends the surviving 7-hole: 8-hole) |

That is **five Maker moves A1…A5** (the paper's own text: after A4 "the formation of an 8-hole
in the next round"), i.e. rounds 9–13 after the 7-hole of round 8: **the 8-hole arrives in
round 13**, with 15 points at the 7-hole (7 + 4 + 4) + B0 + (A1,B1,…,A4,B4,A5) = 15 + 1 + 9 =
**25 points = 2·13 − 1**. "12 rounds" would give only 23 points and contradicts the paper's
own "25 points". Theorem 2's "12-th round" is therefore an arithmetic slip in the source
(8 + 5 = 13, not 12); an independent count of the construction agrees. This repository records 13 /
25 and does not copy 12. (The same counting reproduces the k = 7 statement: 6-hole in
round 6, A1′, A2′ → 7-hole in round 8, 15 points.)

Starting from the app's bare 7-point heptagon preset the session has 7 + 10 = 17 points at
the 8-hole (7 start points + B0, A1…A5, B1…B4).

## 2. Reconstruction and proofs

Notation: heptagon V0…V6 CCW (paper A…G). Chord (V_j, V_{j+3}) cuts off the 4-hole
S_j = (V_j,…,V_{j+3}); the other side is a 5-hole. Seven chords: AD BE CF DG EA FB GC ✓
(= (V_j,V_{j+3}), j = 0…6).

**Lemma A9 (B0 outside).** The heptagon stays an empty 7-hole; Edge-Extension → A1 wins.

**Lemma B9 (a survivor pair always exists) — new, replaces the paper's "one instance".**
For B0 strictly inside, let H = {j : B0 ∈ S_j}. S_j and S_{j+3} have disjoint interiors
(S_{j+3} lies on the 5-side of chord j), so B0 lies in at most one of them: H is an
independent set of the 7-cycle j ~ j+3. If every edge {j, j+3} had an endpoint in H, then
(independence) every edge would have exactly one, a proper 2-colouring of an odd cycle —
impossible. Hence some j has B0 ∉ S_j and B0 ∉ S_{j+3}. For such j, S_j ∪ {B0} and
S_{j+3} ∪ {B0} are 5-holes (convex because B0 is on the far side of the chord, empty because
the extra region is a triangle inside the other part of the heptagon, whose vertices are
extreme), they share exactly the vertex E = V_{j+3} and B0, and meet only in the segment
E·B0 (disjoint interiors). The paper's Figure 3 is j = 1 (S_1 = BCDE, S_4 = EFGA).
Empirically: over every B0 cell of the preset heptagon (§5) the "no-pair" class never occurs, as the lemma predicts (one heptagon only).

**Lemma D9 (A1) — argued; contradicted in part by the exact search (see §5).** With ring R0…R6 rotated so S_j = (R0..R3), S_{j+3} = (R3..R6), E = R3,
F = R4: take A1 on the open edge EF near E, just outside. Then H1 = (R3,R4,R5,R6,B0)+A1 =
(A,B0,E,A1,F,G) and H2 = (R0..R3,B0)+A1 = (B,C,D,E,A1,B0) are in convex position: the
turns of H1 are those of the heptagon except at B0 [A,B0,E: B0 beyond chord AE], E
[B0,E,A1] and A1, F, which hold strictly at points of the open edge EF; for H2 the only
condition not inherited from the heptagon is at B0 [A1,B0,B]: it holds strictly at A1 = E
because (E,B0,B) is a left turn (B0 beyond chord BE), hence near E. Emptiness: the new
areas are triangles (E,A1,B0)/(E,A1,F), thin near E, and the finitely many other points
avoid them for A1 close enough; finitely many A1 violate general position. **Twins:**
B0·A1 is a chord of H1 and an edge of H2, so H1 ∩ H2 ⊂ triangle (B0,E,A1) ⊂ both: the
holes meet EXACTLY in that triangle. In H1 the vertex E has neighbours B0, A1; in H2 the
vertex A1 has neighbours E, B0: the triangle is an ear of BOTH holes (apexes E and A1).

**Lemma E9 (B1 in the shared triangle; Observation 1).** For B1 inside the triangle,
replacing the ear apex by B1 gives two 6-holes: H1′ = (A,B0,B1,A1,F,G) and
H2′ = (B,C,D,E,B1,B0) (convex: the new vertex lies in the ear; empty: they lie inside
the old holes whose only interior point is B1). They share exactly the edge B0B1 (one on
each side). B1 outside the triangle is NOT encoded (the source does not treat it).

**Lemma F9 (A2).** Beyond the shared edge of H1′ (into H2′): the region
{x : orient(A,B0,x)>0, orient(B0,B1,x)<0, orient(B1,A1,x)>0} (convexity of X = H1′+x)
∩ ear(H2′ at B1) ∩ ear(H2′ at B0) = the paper's "intersection of triangles B0BB1, B0EB1 and
the triangle cut by the prolongations of AB0 and A1B1". All inequalities hold strictly on
the open segment B0B1 and the ears both contain the points just beyond it on the B-side,
so the region contains points arbitrarily close to the segment; thin triangle (B0,x,B1) is
empty for x close enough. Then X = (A,B0,A2,B1,A1,F,G) is a 7-hole, and K1 = H2′ with B1 → A2
and K2 = H2′ with B0 → A2 are 6-holes sharing the adjacent X-edges B0A2 and A2B1 with X
(checked by `k8-inv:obs1`). Either twin may play the X role; the engine tries both.

**Step B2.** B2 ∉ X ⇒ X alive ⇒ extension (interactive). B2 ∈ X is Bob's only way to kill X.

**Observation 2 (A3, B3) — verified, not proved.** A3 is placed just outside an edge of X
(canonical order, three fractions, dyadic distances), accepted when two 6-holes through A3
meet exactly in a triangle and neither has B0·A2·B1 consecutive (`k8-inv:forcing`). The
search found an accepted A3 for each of the first 12 of 35 B2 centroid positions tried in
exploration (and for the B2 of the scripted tour); the engine-level cell sweeps of §5 were not completed. After B3: either a 7-hole survives (extend), or two
6-holes with disjoint interiors share exactly one vertex (the paper's Observation 2). That
dichotomy was never violated in any sampled cell; it is NOT proved here.

**Lemma G9 (A4, B4, A5) — proved given the shape.** Two interior-disjoint 6-holes sharing
exactly one vertex v: a point near v along the sum of the neighbour edge vectors (both
signs, dyadic distances) is accepted only if it extends BOTH to exact 7-holes whose
interiors stay disjoint (`k8-inv:two-sevens`). A single B4 lies in the interior of at
most one of two interior-disjoint 7-holes, so one survives and the Edge-Extension Lemma
gives the 8-hole at A5.

## 3. Implementation map

New data/machinery (no UI code): `RouteRule.interaction` (+ codec; `unverified` ⇒
uncovered terminal in the reducer, G3 relaxed for such routes); MoveSpecs
`escape-edge-accept`, `forcing-pair`, `double-extend`; ComputedOps `select-heptagon-pair`,
`select-twin-triangle`, `select-ear-replacement`, `select-hole-through`,
`select-disjoint-holes`; classifiers `classifyB0Hept`, `classifyB3Obs2`, `classifyB4Sevens`;
checkers `k8-inv:*` (7); `geometry/twinsK8.ts`; def `strategies/k8/def.ts`, preset (bare
heptagon). Registered in `main.ts`; `presetStartFor` / engine default start cover `esmb-k8`.

## 4. Guided tour contents (what the def exposes)

All eight rounds are exposed as nodes with timeline events: B0, A1 (pair, escape, twins),
B1 (+ replacement holes), A2, B2, A3, B3, A4 (+ disjoint sevens), B4, A5, win. Overlays
(`node.show`): the heptagon, its seven 4-holes S_i and seven chords, the 5-holes, the shared
triangle, the replacement holes, X, the two disjoint 7-holes; twin highlights; case maps at
B0, B1, B2 and B4 (B3's class boundary is unbounded, so no map: `boundaries` fails closed
and the UI shows the honest "unavailable" path). Exact checks at every supported state are
the `pre`/`post` invariants (`k8-inv:*`, `exists-k-hole`), shown as evidence rows. Every
node has a typed, ClaimLint-clean explanation (strategy-rule / verified-geometry /
theorem-cited / uncovered). The 15-point result of a Lemma 6–8 chain exceeds the exact
bootstrap bound (`N_BOOTSTRAP_EXACT = 12`), so **promotion k7 → k8 is not offered** (honest
limit; `growStartFromWin` is defined for k = 5, 6 only).

## 5. Gate evidence

**Not completed:** `tests/slow/k8gate.test.ts` layer 1 for the two
random heptagons and layer 2 (deep path) for all three heptagons, and `tests/slow/k8-b3.test.ts`
(full-engine B3/B4 cell sweep) were started and stopped; they are valid tests on their own but
long (hours) and are kept ONLY as unexecuted/partially executed drivers — they are not evidence.

**Evidence actually obtained (scope: ONE heptagon, the shipped preset; exact rationals; leaves
confirmed by the independent oracle `k7oracle.ts`, bigint integers, no `src/geometry` import):**

1. *Layer 1, preset heptagon, every B0 cell (162 cells; 105 outside + 7 + 50 inside-pair, 0
   no-pair), every ninth B1 cell of each parked B0 state:* **0 failures**, 47 oracle-checked
   8-hole leaves. Census of B0 cells: 105 outside → immediate 8-hole (oracle-confirmed); 7 where
   B0 itself completes a win; 22 inside-pair that already end in a win by the chain; 14 inside-pair
   parked at the B1 classifier; **14 inside-pair that ended as typed `uncovered / window-exhausted`
   at `k8:r1:escape` (the bounded A1 search found no accepted point) — 28 % of the inside-pair
   cells. Lemma D9's existence claim is therefore NOT confirmed; the failure is fail-closed (typed,
   never a wrong state), the tour is simply not offered there.** B1 census (47 shared-triangle,
   627 elsewhere → uncovered, 82 wins by the chain).
2. *Engine path of the tour (preset heptagon, B0 = centroid(A,C,E,F), B1 = centroid of the shared
   triangle, B2 = centroid of three X vertices):* A1 … A3 placed with all post-conditions passing;
   B3 sampled over 1/25 of the exact cells of the 13-point arrangement (92 cells): 84 leave a
   7-hole (extension wins), 3 are wins by B3 itself, 5 are Observation-2 vertex-pair states, each
   continued with a B4 inside seven-A and ended in an oracle-confirmed 8-hole (5/5); no `no-pair`
   cell was observed.
3. *Exploration (geometry only, no engine):* four (B2, A3) configurations, every 12th cell of the
   B3 arrangement (≈ 190 cells each): in every sampled cell an A4 exists extending two
   interior-disjoint 6-holes sharing one vertex to two interior-disjoint 7-holes (≈ 760 cells,
   0 exceptions).
4. *Fast tier:* `tests/strategies/k8.test.ts`, `k8units.test.ts` (26 tests): registration,
   route-interaction table, codec, ClaimLint, the tour to B3, every encoded class
   (B0 outside, B1 elsewhere → uncovered, B2 outside X), checker pass/fail pairs, classifier
   tag mapping, fail-closed moves, replay export/validate/re-fold.

NOT verified: A1 existence for all inside-pair B0; any other heptagon; the deep path over all
B2/B3 cells; B1 outside the shared triangle (not encoded); the B3 dichotomy for all B3; full
branching play.

## 6. Mutation testing

17 hand-written mutants run against `k8.test.ts`, `k8units.test.ts` and the lab suite: **11
killed, 6 survived.** Killed: interiors-disjoint helper, ear replacement apex swap, B4 tag swap,
B0 inside/outside inversion, `unverified` ⇒ uncovered branch, G3 relaxation, shared-edge
orientation, `sevenpair` disjointness, interaction table label change, route-interaction
propagation, forcing-chain exclusion. Survivors (not fixed, stated): `heptagonPair` shared-count /
disjointness guard (redundant by Lemma B9: the halves are always interior-disjoint), distinct
ear apexes (structurally always distinct), A1 `meet` acceptance (the post-condition re-checks
it), `double-extend` disjointness (post-condition `two-sevens` re-checks it), `obs1` adjacency
distinctness, `classifyB3Obs2` shared-count `!== 1` (no test constructs a state with two
disjoint 6-holes sharing an edge). Weak spots are the post-conditions' redundancy, not
unchecked outputs: every move is still re-verified by an independent exact post-check.

## 7. Evidence tiers

source theorem (cited) · reconstruction §2 (our derivation) · implemented conventions
(A1/A2 halving search, A3 candidate order, A4 directions) · exact runtime checks (every move,
`k8-inv:*` + post `exists-k-hole`) · finite exact validation (cell trees of §5 over finitely
many heptagons) · not established: A3 existence and the B3 dichotomy for ALL B2/B3, B1 outside
the shared triangle, anything about other heptagons. `effectiveStatus(esmb-k8)` is
`validated-randomized`.

## 8. UI integration requirements (nothing under `src/ui/**` was edited)

* Registration is in `main.ts`; the entry list shows "esmb-k8 (k=8)" automatically; **Start
  needs no UI change** (engine default start = the bare heptagon).
* Show the per-route `interaction` data: `StrategyDef.nodes[*].routes[*].interaction`
  (`interactive` = free play; `guided` = walk-through, exact checks per move; `unverified` =
  would end uncovered). Suggested labels: Interactive / Guided / Not encoded.
* Uncovered terminals with `origin: "breaker-reply", reason: "partial-encoding"` already have
  a card (`uncoveredCard`).
* B3 has no case map / sample chips by design: the tour is driven by typed placement, by
  replay, or by the deterministic fixture in `tests/strategies/k8.test.ts` (`tourToB3`).
* Replay export works (hole var `P7`); k8 replays require the supplied start record.
