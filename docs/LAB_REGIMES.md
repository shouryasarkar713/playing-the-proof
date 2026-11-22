# Research / Parameter Lab — regime table, classifier and discrepancies

Code: `src/lab/` (pure; imports `geometry/` and `game/` only), tests: `tests/lab/`.
Every statement below was read from the cited papers
(DZ = Džuklevski et al., arXiv:2505.15366v2; DV = Das–Valla, CGT 5(2):3;
AI = Aichholzer et al., EuroCG 2019; KG = Kolipaka–Govindarajan; HS =
Heule–Scheucher). Inequalities and ceilings of DZ Thm 10 were re-extracted from
the PDF with pymupdf and checked.

## 1. Parameters and the three labels

Parameters: game model (online / one-round), target k, bias 1:s (exact
rational, non-integer allowed), rule (monochromatic / bichromatic), encoded
strategy variant, number of parallel structures t.

| Label | Meaning (decided in this order) |
| --- | --- |
| `THEOREM_BACKED` | The configuration lies inside a regime stated by a cited source row (`src/lab/regimes.ts`). Independent of any encoding. |
| `EXPERIMENTAL` | Outside every cited regime **in the selected game model**, but the lab's bounded exact-geometry simulation covers it (k in 3..8, bias <= 1:16). Simulation output is an observation. |
| `NOT_COVERED` | Outside every cited regime **and** no simulation (k >= 9, bias > 1:16) — or invalid parameters (k < 3, bias < 0, t < 1). The lab lists the nearest theorem-backed neighbours instead of extrapolating. |

The encoding selection never changes the label; it decides only whether
interactive replay is offered (`encoding.replayOffered`: encoding applies to the
exact game **and** is `verified-interactive`/`verified-guided`).

Every result carries: citations (row id, basis `proved | stated | derived`),
strongest basis, verification text, encoding info, limitations, nearest
theorem-backed neighbours (for non-backed results), simulation availability
(`mustLabelObservationOnly`), reasons, and invalid-parameter messages.

## 2. Verified statements and how the lab uses them

| Row | Statement (as verified) | Lab use |
| --- | --- | --- |
| DZ Thm 3 | mono online 1:1, Maker wins every k; <= (5/3·4^(k-2) − 2/3)t rounds | backed, any k, s = 1 |
| DZ Thm 4 | mono online 1:s, any s >= 1; bound for integer s | backed, s >= 1 (real) |
| DV Thm 3 | mono online, Maker places (1+ε)× Breaker, every k | backed, 0 < s < 1 |
| derived | bichromatic win ⇒ monochromatic hole (reduction of DZ Thm 5) | backed, s = 0 (basis `derived`) |
| derived | h(5)=10, h(6)=30 ⇒ mono k <= 6 never lost, any bias, either model | backed, basis `derived` |
| DZ Thm 5 | bichromatic online, 0 <= s < 2, k >= 3: Maker wins | backed (proved) |
| DZ Thm 8 | bichromatic online **exactly** 1:12, k >= 8: Breaker wins | backed (proved at s = 12) |
| DZ Thm 8 (abstract/intro) | "12 or more" / s_B >= 12 | backed at integer s > 12, basis `stated` |
| DZ Thm 10 | bichromatic online 1:2λ, integer λ >= 3, k >= 3⌈2λ/(λ−2)⌉−1 | λ ∈ {3,4,5,6} proved; even λ >= 7 `stated` |
| DZ Prop 7 | bichromatic **one-round** exactly 1:2: Breaker wins, all k, n >= 3 | backed (proved at s = 2) |
| DZ intro | one-round s_B >= 2 | backed at s > 2, basis `stated` |
| DZ Thm 13 | one-round 1:(2−ε), k >= 3: Maker wins for large enough sets | backed, s < 2 |
| DV Lemma 6/7, Thm 1/2 | mono 1:1 constructions k = 5,6,7,8 | existence only; see D1 |
| AI Thm 3.7 / Prop 3.6 | Red–Green MB: red convex 5-hole with 8 red points (4-hole with 5) | row recorded (extended abstract); also DZ-T5 |

Open (DZ §4), never `THEOREM_BACKED`: bichromatic online 2 <= s < 12, s >= 12
with k < 8, the λ trade-off gaps (for example 1:6 with k < 17, 1:8 or 1:10 with
k < 11), odd or non-integer s >= 2 (1:7, 1:11, 1:12.5), k = 3 at s >= 2.
A one-round result at the same (k, s) does **not** back the online game:
`one-round bichromatic, s = 2` is backed, `online bichromatic, s = 2` is
`EXPERIMENTAL`. The proposal's mock-up (online, bichromatic, 1:2, k = 7) is
`EXPERIMENTAL` and the one-round twin is `THEOREM_BACKED`.

Reference (classical) rows are **not** statements about the game and carry no
label: ES(4)=5, ES(5)=9, ES(6)=17, the ES bounds, h(5)=10, h(6)=30, h(k)=∞ for
k >= 7, the Avoider–Avoider k=5 result, and Conlon–Lim (one-round monochromatic
with unbounded |B|, no bias bound). The h-values are premises of the two derived
monochromatic rows.

### Conservatism rules

* Bias monotonicity is not a lemma in DZ (the notation s(k) presupposes it).
  The lab never infers a regime from it: odd s (1:7, 1:11, 1:13 below 12...),
  non-integer s > 12, and s between proved λ-points are `EXPERIMENTAL`.
* The only inferences accepted are deductions from the cited statements and
  definitions, always labelled `derived`: the monochromatic reduction, the
  classical finiteness argument for k <= 6, and "extra blockers cannot hurt
  Breaker" in the **one-round** bichromatic game — the latter is anyway the
  introduction's own wording (`stated`).
* The "strongest basis" of a result is the best support among its citations;
  each citation keeps its own basis and the note names what is not proved.

## 3. Discrepancies found (proposal vs papers, and inside the papers)

| Id | Finding |
| --- | --- |
| D1 | **8-hole: 12 rounds vs 13.** DV Lemma 9 needs five rounds after the 7-hole of round 8 ⇒ round 13, and 25 points = 2·13−1; round 12 has 23 points. DV Thm 2 ("12-th round"), DZ intro ("r(8) <= 12") and the proposal (Table 1, Table 2, §8) repeat the off-by-one. DZ also writes "r(5) <= 6" where DV gives round 4 for k = 5 (round 6 for k = 6). Recomputed: 4/6/8/13 rounds, 7/11/15/25 points (`constructionArithmetic()`). |
| D2 | **Thm 10 proof covers λ ∈ {3,4,5,6} only**, statement is for every integer λ >= 3; no bias-monotonicity lemma. |
| D3 | Thm 8 is exactly 1:12; the abstract says "12 or more". |
| D4 | Prop 7 is exactly 1:2; the introduction/conclusion say s_B >= 2. |
| D5 | Non-integer speeds: the multiset convention {i·sM} ∪ {i·sB}, read literally, gives larger s fewer Breaker moves; the intended per-time reading is not fixed. The lab's simulation uses floor(s·r) cumulative Breaker points and says so; no theorem is inferred from it. |
| D6 | DZ says it "settles an open problem posed by Aichholzer et al."; the EuroCG abstract poses Questions 1–3 about Avoider–Avoider/Maker–Maker only. Not repeated by the lab. |
| D7 | Avoider–Avoider k = 5: KG "9th step", AI "ply 9"; DV/DZ say "round 9" (ply 9 is the 5th round). |
| D8 | AI Thm 3.7 (convex 5-hole, 8 points) is derived "from Lemma 3.4", a general non-convex 5-hole; extended abstract, no proof text. Recorded with tier `extended-abstract`. |
| D9 | Proposal §9.5 defines NOT COVERED as "no encoded strategy applies", which contradicts reporting theorem-backed regimes without an encoding. The lab's definition above resolves this. |
| D10 | Typos in DZ proofs: Thm 5 pairing indices (the pairs must be disjoint), "Theorem 6" for Observation 6, Thm 13 "k < (t+1)/2". No boundary changes. |
| D11 | Table 1 omits DV Thm 3, AI Prop 3.6 and the open-problem row; added. |
| D12 | k = 3 online bichromatic at s >= 2 is not discussed by DZ (open range is 3 < k < 8). An elementary argument (a Maker triangle thin enough around a segment avoids the finitely many Breaker points) suggests Maker wins at any finite bias, but it is not in the sources, so the lab keeps it `EXPERIMENTAL`. |

Proposal Table 1 verdicts: 6 confirmed or confirmed-with-caveat as printed,
row 5 (8-hole in 12 rounds) a discrepancy; Table 2 row 6 likewise. Both tables
are typed in `PROPOSAL_TABLE1/2` with the verdict per row.

## 4. Encoding registry (`src/lab/encodings.ts`)

A data table: `esmb-k5`, `esmb-k6`, `esmb-k7` = `verified-interactive`; `esmb-k8` =
`verified-guided`; `esmb-k6-wide` = `exists-unverified` (the experimental definition);
`kstrip-mono-1:1`, `kstrip-mono-bias`, `kstrip-bichromatic` = `verified-guided`
**for listed configurations only** (`verifiedScope`: exact (k, t = structures, s) points,
mirrored from the KStripSpec `verified` tables and cross-checked by
`tests/lab/kstrip-encodings.test.ts`; see `docs/KSTRIP_SPEC.md`). For any other
configuration the entry still *applies* (it is a construction for that game) but is
reported `exists-unverified` with a note that nothing is extrapolated. `replay: "explorer"`
means the verified runs live in the k-strip explorer, so `replayOffered` stays false
(no Proof-mode link) and the explorer link is the only entry point. Encoding availability
never changes the theorem status.
`tests/lab/regimes.test.ts` cross-checks the `esmb-*` entries against the real
strategy registry, so a stale entry fails a test with an instruction.

## 5. Simulation (`runSimulation`)

Seeded (xorshift32), interruptible (`shouldStop`), budgeted (rounds and
exact-geometry ops), exact rational legality, ownership-aware win detection
shared with the engine (`game/gamemode.ts`). Policies: random-legal, greedy
(best of 16 by a budgeted hole count). It returns
`{ kind: "completed" | "budgetExhausted", stoppedBy, observed, notAGuarantee: true, label }`
or `{ kind: "unsupported" }`. It does not run any encoded strategy and is never
evidence for or against a theorem. `availableControls()` lists only controls
with an implementation behind them (a test imports each named symbol).

## 6. Round-bound calculator

`monoRoundBound(k, t, s)` — DZ Thm 3/4 for integer s >= 1, exact rationals
(recurrence r(k,t) = r(k−1, 4st) + 2t); cross-checked against the printed closed
form. No bound is given for non-integer s or for the bichromatic strategy (none
is stated in the source).

## 7. Manual mutation testing (record)

40 hand-written mutants (sed on the source, targeted test files, original restored
each time). **38 killed, 2 survived, both equivalent.**

* Bichromatic win condition (20 mutants): vertex eligibility inverted or dropped
  (`gamemode.ts`, `ownedholes.ts` x3), `mayBeHoleVertex` always true, breaker-vertex
  branch of `checkWinningHole` removed, `isBichromatic` constant, empty-witness check,
  I6 skipped, hash line dropped, engine gating inverted, replay version/gameMode rules
  flipped, validate/assemble ignoring the flag, win detection and the declared-win
  check forced monochromatic, effect diff forced monochromatic. Initial survivors, now
  killed by new tests: declared-win check forced monochromatic (needed a def without
  a post-condition), effect diff forced monochromatic (needed an explicit before/after
  diff test). Equivalent survivors: the early `k > eligible` returns in
  `findKHolesAmong` / `findNewKHolesAmong` (the combination generator already yields
  nothing).
* Classifier (20 mutants): every threshold (`< 2`, `>= 1`, `>= 12`, `k >= 8`, ceil
  formula, `lambda <= 6` basis, evenness, `k <= 6`, `s > 0`, the one-round split,
  simulation envelope `k`/bias edges, status swap, `k < 3`, encoding rule/bias
  matching). One initial survivor (`at-least` bias boundary of `kstrip-mono-bias`),
  killed by a boundary test at s = 1.
