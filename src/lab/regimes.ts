// lab/regimes.ts — the source-grounded statement base (rows), the proposal's
// Table 1 / Table 2 reconstructed as typed records and CHECKED against the
// papers, and the discrepancy register. Pure data + tiny pure helpers.
//
// Papers (see the cited papers): DZ = Dzuklevski et al.,
// arXiv:2505.15366v2 (16 Mar 2026); DV = Das & Valla, CGT 5(2):3 (2026);
// AI = Aichholzer et al., EuroCG 2019 (extended abstract, preprint status);
// KG = Kolipaka & Govindarajan, DMTCS 15:3 (2013); HS = Heule & Scheucher,
// TACAS 2024. Theorem/lemma numbers below were read from the PDFs.
import type { LabStatus } from "./types.ts";

export type RowTier =
  | "published-theorem"
  | "published-statement-partial-proof"
  | "extended-abstract"
  | "classical-result"
  | "derived-inference";

export interface SourceRow {
  readonly id: string;
  readonly source: string;
  readonly statement: string;
  // Is this a statement ABOUT the (Erdos–Szekeres Maker–Breaker) game the lab
  // parameterises? Classical combinatorial-geometry facts are not.
  readonly aboutThisGame: boolean;
  // Lab status of the regime the row establishes (game statements only).
  readonly status: LabStatus | null;
  readonly tier: RowTier;
  readonly note: string;
}

export const SOURCE_ROWS: readonly SourceRow[] = [
  // ---- Dzuklevski et al. (monochromatic) ----
  {
    id: "DZ-T3",
    source: "DZ Thm 3 (Sec. 2.1)",
    statement:
      "Monochromatic online game, bias 1:1: for every k and t Maker can ensure t parallel k-strips (a k-strip is a k-hole), in at most (5/3*4^(k-2) - 2/3)*t rounds for k >= 2. Hence Maker wins for every k.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "Recurrence r(k,t)=r(k-1,4t)+2t, r(2,t)=t re-derived; closed form confirmed.",
  },
  {
    id: "DZ-T4",
    source: "DZ Thm 4 (Sec. 2.2)",
    statement:
      "Monochromatic online game, bias 1:s, any s >= 1: Maker can ensure t parallel k-strips; round bound ((4s)^(k-2)/(s+1) + ((4s)^(k-2)-1)/(4s-1))*2t for integer s.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "Statement is for real s >= 1; the proof assumes s is an integer 'without loss of generality' (Breaker with ceil(s) points is no weaker). The round bound is given for integer s only.",
  },
  {
    id: "DZ-T5",
    source: "DZ Thm 5 (Sec. 3)",
    statement:
      "Bichromatic online game, bias 1:s for any constant 0 <= s < 2 and every k >= 3: Maker wins (builds r parallel k-strips disjoint from Breaker's points).",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "Proof uses eps = 2-s directly, so real s is covered. The proof breaks at s = 2 (paper, remark after the proof).",
  },
  {
    id: "DZ-P7",
    source: "DZ Prop. 7 (Sec. 3.1)",
    statement:
      "Bichromatic ONE-ROUND game, bias exactly 1:2: for every k, n >= 3 Breaker wins (two points near every Maker point block every Maker triangle).",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "Proposition proves bias exactly 2. The introduction and conclusion state it for s_B >= 2 / 'speed two'; extra Breaker points only add blockers, so larger s is a one-line deduction, recorded as basis 'stated'.",
  },
  {
    id: "DZ-T8",
    source: "DZ Thm 8 (Sec. 3.2)",
    statement:
      "Bichromatic ONLINE game, bias 1:12, k >= 8: Breaker wins (perturbed regular hexagons around Maker's points).",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "The theorem body fixes bias exactly 12. The abstract says 'Breaker is allowed to play 12 or more points per round' and the introduction 's_B >= 12'; the written proof covers s = 12 only.",
  },
  {
    id: "DZ-T10",
    source: "DZ Thm 10 (Sec. 3.2)",
    statement:
      "Bichromatic ONLINE game, bias 1:2*lambda for every integer lambda >= 3: Breaker wins whenever k >= 3*ceil(2*lambda/(lambda-2)) - 1 (k >= 17 for lambda=3; k >= 11 for lambda in {4,5}; k >= 8 for lambda >= 6).",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-statement-partial-proof",
    note: "The proof is written only for lambda in {3,4,5,6}. For integer lambda >= 7 the theorem statement (and 'k >= 8 for lambda >= 6') is published but no argument is given; bias monotonicity is NOT stated as a lemma (the notation s(k) in Sec. 4 presupposes it).",
  },
  {
    id: "DZ-T13",
    source: "DZ Thm 13 (Sec. 3.3)",
    statement:
      "Bichromatic ONE-ROUND game, bias 1:(2-eps) for every eps > 0 and k >= 3: Maker wins (for a sufficiently large, explicitly structured point set, via the Density Hales–Jewett theorem).",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "'Sufficiently large' is astronomically large (d_0 from Density Hales–Jewett); not a small playable instance.",
  },
  {
    id: "DZ-OPEN",
    source: "DZ Sec. 4 (Conclusions)",
    statement:
      "Open: the minimum Breaker speed s(k) in the bichromatic online game. Known 2 <= s(k) <= 12 for k >= 8 and 2 <= s(k) <= 6 for k >= 17; unknown whether any constant s > 1 lets Breaker win for 3 < k < 8; whether Breaker wins the online game at speed two is open.",
    aboutThisGame: true,
    status: null,
    tier: "published-theorem",
    note: "A statement of what is NOT known. It is why bichromatic online configurations in 2 <= s < 12 (and s >= 12 with k < 8, and the lambda trade-off gaps) are never THEOREM_BACKED.",
  },
  // ---- Das & Valla (monochromatic, 1:1) ----
  {
    id: "DV-L6",
    source: "DV Lemma 6",
    statement: "Monochromatic 1:1: Maker obtains a 5-hole from 7 points in the 4th round.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "2*4-1 = 7 points: consistent.",
  },
  {
    id: "DV-L7",
    source: "DV Lemma 7",
    statement:
      "Monochromatic 1:1: starting from a 5-hole (Breaker to move), Maker obtains a 6-hole within the next two rounds.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "4+2 = round 6, 11 points (arithmetic recomputed; not printed in the paper).",
  },
  {
    id: "DV-T1",
    source: "DV Thm 1 (Lemmas 6-8)",
    statement: "Monochromatic 1:1: Maker obtains a 7-hole from 15 points in the 8th round.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "4+2+2 = round 8; 2*8-1 = 15 points: consistent.",
  },
  {
    id: "DV-T2",
    source: "DV Thm 2 (Lemma 9)",
    statement:
      "Monochromatic 1:1: Maker obtains an 8-hole from 25 points. Printed as 'in the 12-th round'.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "DISCREPANCY D1: Lemma 9 needs five rounds after the 7-hole (round 8), i.e. round 13, and 2*13-1 = 25 points. '12-th round' contradicts both the lemma and the 25-point count (round 12 has 23 points). The existence statement is unaffected.",
  },
  {
    id: "DV-T3",
    source: "DV Thm 3 (Sec. 2.1)",
    statement:
      "Monochromatic online game where Maker places (1+eps) times as many points as Breaker (on average): Maker wins for every k, in (r+1)^(k-1) turns for eps = 1/r.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "published-theorem",
    note: "Maps to bias 1:s with s = 1/(1+eps) in (0,1). Not in the proposal's Table 1.",
  },
  // ---- Aichholzer et al. ----
  {
    id: "AI-T37",
    source: "AI Thm 3.7 (+ Prop. 3.6 for k = 4)",
    statement:
      "Bichromatic (Red–Green) Maker–Breaker, one point each per turn: Maker can build a red convex 5-hole by placing 8 red points (and a red convex 4-hole with 5 red points). A hole may contain no point of either colour.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "extended-abstract",
    note: "Extended abstract with 'preprint' status; the convex statements are 'derived from Lemma 3.4' (a general, non-convex 5-hole) with no proof text. Its setting matches the lab's bichromatic online 1:1 rule (Maker-only vertices, all points block). Superseded for existence by DZ-T5.",
  },
  // ---- Classical reference facts (not statements about the game) ----
  {
    id: "REF-ES",
    source: "Klein; Kalbfleisch et al. 1970; Szekeres–Peters 2006 (via proposal [3,5,6])",
    statement: "ES(4)=5, ES(5)=9, ES(6)=17 (points in convex position, no emptiness).",
    aboutThisGame: false,
    status: null,
    tier: "classical-result",
    note: "Only 'every 9 points contain a convex 5-gon' is cited in the supplied corpus (AI ref [12]); ES(4), ES(6) not checkable in it.",
  },
  {
    id: "REF-ES-BOUNDS",
    source: "Erdos–Szekeres 1961; Suk 2017 (via proposal [4,7,8])",
    statement: "2^(k-2)+1 <= ES(k) <= 2^(k+O(sqrt(k log k))).",
    aboutThisGame: false,
    status: null,
    tier: "classical-result",
    note: "KG cites the lower bound; DZ cites Suk for the (1-o(1))log2 n form. Not a game statement.",
  },
  {
    id: "REF-H",
    source: "Harborth 1978; Heule–Scheucher 2024; Horton 1983",
    statement: "h(5)=10, h(6)=30, h(k)=infinity for k >= 7 (empty convex holes in every point set).",
    aboutThisGame: false,
    status: null,
    tier: "classical-result",
    note: "Verified in DZ Sec. 1, DV Sec. 1 and the HS abstract. Premise (not a game statement) of the derived rows 'mono k<=6'.",
  },
  {
    id: "REF-KG",
    source: "KG abstract; AI Thm 2.1",
    statement: "Avoider–Avoider convex 5-gon / 5-hole game: the second player wins; the game ends at ply 9.",
    aboutThisGame: false,
    status: null,
    tier: "classical-result",
    note: "A different game (Avoider–Avoider). KG: 'ends in the 9th step'; AI: 'ply 9'; DV/DZ say 'round 9' (ply vs round, discrepancy D7).",
  },
  {
    id: "REF-CL",
    source: "Conlon–Lim 2023 (via DZ Sec. 1, 4)",
    statement:
      "For every point set M there is S = M ∪ B without 9-holes, but B is much larger than M (no bias bound); hence some fast-growing Breaker speed f(i) wins the monochromatic online game.",
    aboutThisGame: false,
    status: null,
    tier: "classical-result",
    note: "One-round monochromatic with unbounded |B|. Gives no statement for any specific finite bias.",
  },
  // ---- Derived rows (labelled inference) ----
  {
    id: "DER-MONO-SMALLK",
    source: "derived from REF-H (and DZ Sec. 1: 'for k <= 6 Maker inevitably wins')",
    statement:
      "Monochromatic game, k in {3,4,5,6}, ANY bias s >= 0, online or one-round: Maker wins, because every point set of >= h(k) points in general position contains a k-hole and in the monochromatic game a hole may use either player's points.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "derived-inference",
    note: "Deduction, not a quoted theorem: the (infinite) online game, or a one-round set with |M| >= h(k), has >= h(k) points whatever Breaker does.",
  },
  {
    id: "DER-MONO-S0",
    source: "derived from DZ-T5 (reduction)",
    statement:
      "Monochromatic online game, bias s = 0: Maker wins, since a bichromatic winning hole is also a monochromatic k-hole of M ∪ B.",
    aboutThisGame: true,
    status: "THEOREM_BACKED",
    tier: "derived-inference",
    note: "The reduction also shows DZ-T5 transfers to the monochromatic rule for 0 <= s < 2.",
  },
];

const ROW_INDEX: ReadonlyMap<string, SourceRow> = new Map(SOURCE_ROWS.map((r) => [r.id, r]));

export function sourceRow(id: string): SourceRow | undefined {
  return ROW_INDEX.get(id);
}

// ---------------------------------------------------------------------------
// Proposal Table 1 (verified statement base) — typed, with the audit verdict.
// ---------------------------------------------------------------------------

export type Verdict = "confirmed" | "confirmed-with-caveat" | "discrepancy" | "not-checkable-in-corpus";

export interface ProposalTableRow {
  readonly id: string;
  readonly statement: string; // as printed in the proposal
  readonly proposalSources: string; // bracketed reference numbers as printed
  readonly proposalStatus: string; // as printed
  readonly rows: readonly string[]; // SourceRow ids that back it
  readonly verdict: Verdict;
  readonly note: string;
}

export const PROPOSAL_TABLE1: readonly ProposalTableRow[] = [
  {
    id: "T1-01",
    statement: "ES(4)=5, ES(5)=9, ES(6)=17",
    proposalSources: "[3, 5, 6]",
    proposalStatus: "theorem",
    rows: ["REF-ES"],
    verdict: "not-checkable-in-corpus",
    note: "Classical; only ES(5)=9 is cited in the supplied papers. Not a statement about the game.",
  },
  {
    id: "T1-02",
    statement: "2^(k-2)+1 <= ES(k) <= 2^(k+O(sqrt(k log k)))",
    proposalSources: "[4, 7, 8]",
    proposalStatus: "theorem",
    rows: ["REF-ES-BOUNDS"],
    verdict: "confirmed-with-caveat",
    note: "Lower bound appears in KG; DZ cites Suk for the refinement. Not a statement about the game.",
  },
  {
    id: "T1-03",
    statement: "H(5)=10, H(6)=30, and H(k)=infinity for k >= 7",
    proposalSources: "[10, 13, 9]",
    proposalStatus: "theorem",
    rows: ["REF-H"],
    verdict: "confirmed",
    note: "Matches DZ/DV introductions and the HS title/abstract.",
  },
  {
    id: "T1-04",
    statement: "Bichromatic MB: Maker wins 5-hole with 8 own points",
    proposalSources: "[16]",
    proposalStatus: "theorem",
    rows: ["AI-T37"],
    verdict: "confirmed-with-caveat",
    note: "AI Thm 3.7 says exactly this for the Red–Green game, but it is an extended abstract (preprint) whose convex-hole derivation is not written out. Labelled 'theorem' in the proposal; the lab records tier 'extended-abstract'.",
  },
  {
    id: "T1-05",
    statement: "Monochromatic MB: Maker wins all k <= 8 (explicit strategies; 7-hole in 8 rounds, 8-hole in 12)",
    proposalSources: "[2]",
    proposalStatus: "theorem + construction",
    rows: ["DV-L6", "DV-L7", "DV-T1", "DV-T2"],
    verdict: "discrepancy",
    note: "7-hole/8 rounds/15 points is right. '8-hole in 12 rounds' repeats DV Thm 2 as printed; Lemma 9 (+5 rounds after round 8) and the 25-point count give round 13 (D1).",
  },
  {
    id: "T1-06",
    statement: "Monochromatic MB: Maker wins, any constant s >= 1",
    proposalSources: "[1]",
    proposalStatus: "theorem",
    rows: ["DZ-T3", "DZ-T4"],
    verdict: "confirmed",
    note: "Thm 3 (s = 1) and Thm 4 (s >= 1; proof for integer s WLOG).",
  },
  {
    id: "T1-07",
    statement: "Bichromatic MB: Maker wins for constant s < 2",
    proposalSources: "[1]",
    proposalStatus: "theorem",
    rows: ["DZ-T5"],
    verdict: "confirmed",
    note: "k >= 3, 0 <= s < 2, online game.",
  },
  {
    id: "T1-08",
    statement: "Bichromatic MB 1:12: Breaker wins for k >= 8 (and the 1:2lambda trade-off)",
    proposalSources: "[1]",
    proposalStatus: "theorem",
    rows: ["DZ-T8", "DZ-T10"],
    verdict: "confirmed-with-caveat",
    note: "Thm 8 exact. Thm 10 is proved for lambda in {3,4,5,6} only; lambda >= 7 is stated without proof (D2). Table 1 does not say 'online'; both are online-game results.",
  },
  {
    id: "T1-09",
    statement:
      "One-round (offline) bichromatic: sharp bias threshold at s = 2; Breaker wins for s >= 2, Maker wins for s < 2 for sufficiently large point sets",
    proposalSources: "[1]",
    proposalStatus: "theorem",
    rows: ["DZ-P7", "DZ-T13"],
    verdict: "confirmed-with-caveat",
    note: "Prop. 7 proves exactly s = 2; 's >= 2' is the introduction's phrasing (D4). Thm 13: every s < 2 (eps > 0), k >= 3.",
  },
  {
    id: "T1-10",
    statement: "Interactive k=5 / k=6 replay of the above constructions",
    proposalSources: "this project",
    proposalStatus: "software module",
    rows: [],
    verdict: "confirmed",
    note: "esmb-k5 and esmb-k6 exist and are validated-randomized (README). A software statement, not a source theorem.",
  },
  {
    id: "T1-11",
    statement: "Breaker-win explorations outside encoded strategies",
    proposalSources: "this project",
    proposalStatus: "experimental",
    rows: [],
    verdict: "confirmed",
    note: "Lab EXPERIMENTAL status. Note: bounded simulations report observations of simple Breaker policies, not Breaker wins.",
  },
];

// ---------------------------------------------------------------------------
// Proposal Table 2 (theorem-to-software mapping).
// ---------------------------------------------------------------------------

export interface Table2Row {
  readonly id: string;
  readonly statement: string;
  readonly role: string;
  readonly rows: readonly string[];
  readonly verdict: Verdict;
  readonly note: string;
  // Encoding id realising it today (see encodings.ts), if any.
  readonly encodingId: string | null;
}

export const PROPOSAL_TABLE2: readonly Table2Row[] = [
  {
    id: "T2-01",
    statement: "Convex position [3]; k-hole [9-13]",
    role: "verified detection (geometric-kernel detectors; sandbox overlays)",
    rows: [],
    verdict: "not-checkable-in-corpus",
    note: "Kernel facts; src/geometry/holes.ts.",
    encodingId: null,
  },
  {
    id: "T2-02",
    statement: "Small exact values ES(4)=5, ES(5)=9, ES(6)=17; H(5)=10, H(6)=30",
    role: "verified fixtures (kernel fixture corpus; sandbox readouts)",
    rows: ["REF-ES", "REF-H"],
    verdict: "confirmed-with-caveat",
    note: "H values confirmed; ES(4)/ES(6) not in corpus.",
    encodingId: null,
  },
  {
    id: "T2-03",
    statement: "Das–Valla k = 5: 5-hole from 7 points in 4 rounds",
    role: "PROOF module k = 5 — fully interactive replay",
    rows: ["DV-L6"],
    verdict: "confirmed",
    note: "7 = 2*4-1.",
    encodingId: "esmb-k5",
  },
  {
    id: "T2-04",
    statement: "Das–Valla k = 6: 6-hole within 2 further rounds",
    role: "PROOF module k = 6 — fully interactive replay",
    rows: ["DV-L7"],
    verdict: "confirmed",
    note: "Total round 6, 11 points.",
    encodingId: "esmb-k6",
  },
  {
    id: "T2-05",
    statement: "Das–Valla k = 7: 7-hole from 15 points in 8 rounds",
    role: "PROOF module k = 7 — gated interactive / guided",
    rows: ["DV-T1"],
    verdict: "confirmed",
    note: "No encoding exists in the repository yet (esmb-k7: none).",
    encodingId: "esmb-k7",
  },
  {
    id: "T2-06",
    statement: "Das–Valla k = 8: 8-hole from 25 points in 12 rounds",
    role: "PROOF module k = 8 — guided proof tour",
    rows: ["DV-T2"],
    verdict: "discrepancy",
    note: "Round 13 by Lemma 9 + Thm 1 (D1). Proposal §8 repeats '12 rounds' with a 'five-round finish' after round 8. No encoding exists yet.",
    encodingId: "esmb-k8",
  },
  {
    id: "T2-07",
    statement: "Dzuklevski k-strip machinery (cones, pairing, counting, recursion)",
    role: "k-strip explorer; Break-the-Proof ledger — explorable visualization + adversarial replay",
    rows: ["DZ-T3", "DZ-T4", "DZ-T5"],
    verdict: "confirmed",
    note: "Recurrence r(k,t) = r(k-1,4t)+2t confirmed for both Thm 3 and Thm 4.",
    encodingId: "kstrip-mono-1:1",
  },
  {
    id: "T2-08",
    statement: "Monochromatic game, any constant bias s >= 1",
    role: "parameter laboratory — status row",
    rows: ["DZ-T4"],
    verdict: "confirmed",
    note: "",
    encodingId: "kstrip-mono-bias",
  },
  {
    id: "T2-09",
    statement: "Bichromatic 1:s with s < 2",
    role: "parameter laboratory — status row",
    rows: ["DZ-T5"],
    verdict: "confirmed",
    note: "Online game, k >= 3.",
    encodingId: "kstrip-bichromatic",
  },
  {
    id: "T2-10",
    statement: "Bichromatic 1:2lambda, k >= 3*ceil(2lambda/(lambda-2)) - 1: Breaker wins",
    role: "parameter laboratory — status row",
    rows: ["DZ-T10", "DZ-T8"],
    verdict: "confirmed-with-caveat",
    note: "Proof only for lambda <= 6 (D2).",
    encodingId: null,
  },
  {
    id: "T2-11",
    statement: "Aichholzer et al. bichromatic 5-hole, 8 own points",
    role: "verified fixture (fixture corpus; provenance note in the k = 5 module)",
    rows: ["AI-T37"],
    verdict: "confirmed-with-caveat",
    note: "Source is an extended abstract; no repo fixture for it was found (the lab records the row, not a fixture).",
    encodingId: null,
  },
];

// ---------------------------------------------------------------------------
// Discrepancy register (proposal vs papers, and paper-internal).
// ---------------------------------------------------------------------------

export interface Discrepancy {
  readonly id: string;
  readonly where: string;
  readonly finding: string;
  readonly effectOnLab: string;
}

export const DISCREPANCIES: readonly Discrepancy[] = [
  {
    id: "D1",
    where: "DV Thm 2 / Lemma 9; proposal Table 1, Table 2, §8; DZ intro 'r(8) <= 12'",
    finding:
      "Lemma 9 needs five more rounds after the 7-hole of round 8, so round 13; 2*13-1 = 25 points matches the printed point count, round 12 would have 23 points. 'In the 12-th round' (and 'r(8) <= 12') is an off-by-one in the source. DZ also writes 'r(5) <= 6', whereas DV Lemma 6 gives a 5-hole in round 4 and Lemma 7 a 6-hole in round 6 (likely r(6) <= 6).",
    effectOnLab:
      "The lab records 8-hole as 'round 13 / 25 points (recomputed)', flags the printed 12, and uses only the existence statement (Maker wins k = 8, 1:1).",
  },
  {
    id: "D2",
    where: "DZ Thm 10 vs its proof",
    finding:
      "Stated for every integer lambda >= 3; the proof begins 'Let lambda in {3,4,5,6}'. For lambda >= 7 only the formula and the remark 'k >= 8 for lambda >= 6' exist. No lemma states monotonicity in the bias; Sec. 4 writes s(k) as a minimum speed (implicitly upward-closed) and calls s(k) 'clearly nonincreasing in k'.",
    effectOnLab:
      "Even bias 2*lambda, lambda >= 7, is THEOREM_BACKED with basis 'stated'. Odd or non-integer bias between the proved points is NOT inferred: EXPERIMENTAL.",
  },
  {
    id: "D3",
    where: "DZ Thm 8 vs abstract/introduction",
    finding: "Theorem 8 is exactly 1:12; the abstract says '12 or more points per round' and the introduction 's_B >= 12'. Only s = 12 is proved in the text.",
    effectOnLab: "Integer s >= 12 with k >= 8 is THEOREM_BACKED (s = 12 'proved', s > 12 'stated'). Non-integer s > 12 is EXPERIMENTAL.",
  },
  {
    id: "D4",
    where: "DZ Prop. 7 vs introduction/conclusion",
    finding: "Proposition 7 proves bias exactly 1:2; the introduction states s_B >= 2 and the conclusion 'whenever she has speed two'.",
    effectOnLab: "One-round bichromatic s >= 2 is THEOREM_BACKED (s = 2 'proved', s > 2 'stated'; extra blockers cannot hurt Breaker there).",
  },
  {
    id: "D5",
    where: "DZ Sec. 1 (non-integer speeds)",
    finding:
      "Non-integer speeds are ordered by sorting the multiset {i*sM} ∪ {i*sB} (ties to Maker). Read literally with s_B = s that would give a larger s FEWER Breaker points; the intended reading must be per-time rates. The paper never fixes the convention precisely.",
    effectOnLab:
      "The lab never infers a theorem for a non-integer bias from this convention. Simulations use the cumulative rule floor(s*r) Breaker points after Maker's r-th point and label it a simulation convention.",
  },
  {
    id: "D6",
    where: "DZ abstract ('settles an open problem posed by Aichholzer et al.')",
    finding:
      "The EuroCG extended abstract lists Questions 1-3 (Avoider–Avoider / Maker–Maker) and mentions Maker–Breaker for k >= 7 only as 'would make sense'; an explicit open problem on the bichromatic convex Maker–Breaker game was not found. DV: 'pointed out as interesting and challenging for k >= 7'.",
    effectOnLab: "Wording only: the lab attributes DZ-T5 to DZ and does not repeat the 'settles an open problem' claim.",
  },
  {
    id: "D7",
    where: "KG / AI vs DV / DZ (Avoider–Avoider k = 5)",
    finding: "KG: 'ends in the 9th step'; AI Thm 2.1: 'wins at ply 9'; DV: 'ends after round 9'; DZ: 'within 9 rounds'. Ply 9 is the 5th round.",
    effectOnLab: "Reference row only (a different game); recorded as 'ply 9'.",
  },
  {
    id: "D8",
    where: "AI Thm 3.7 / proposal Table 1 row 4",
    finding:
      "Stated for the convex 5-hole with 8 red points but derived 'from Lemma 3.4', which constructs a general (non-convex) 5-hole; no proof text. The paper is an unreviewed extended abstract.",
    effectOnLab: "Tier 'extended-abstract'; the theorem-backed status of bichromatic online 1:1 rests on DZ-T5 as well.",
  },
  {
    id: "D9",
    where: "Proposal §9.5 (label definitions)",
    finding:
      "NOT COVERED is defined as 'no encoded strategy applies', which contradicts reporting THEOREM-BACKED regimes that have no encoding (the same paragraph).",
    effectOnLab:
      "Status depends on theorem coverage first; an encoding only controls whether interactive replay is offered. EXPERIMENTAL vs NOT_COVERED is decided by whether a bounded simulation exists.",
  },
  {
    id: "D10",
    where: "DZ Thm 5 proof; proposal §7.7",
    finding:
      "The proof places p_i between S_i and S_{i+1} for i = 1..t and then claims the strips of different i are disjoint; consecutive pairs would share a strip, so the pairing must be (S_{2i-1}, S_{2i}). It also cites 'Theorem 6' for what is Observation 6. Thm 13's last paragraph writes 'k < (t+1)/2' where k = (t+1)/2 is meant.",
    effectOnLab: "Typos in the source proofs; no change in any regime boundary.",
  },
  {
    id: "D11",
    where: "Proposal Table 1 omissions",
    finding: "Table 1 omits DV Thm 3 (Maker ratio 1+eps, every k), AI Prop. 3.6 (4-hole with 5 points), and the open-problem row (DZ Sec. 4).",
    effectOnLab: "Added as DV-T3, AI-T37 and DZ-OPEN.",
  },
  {
    id: "D12",
    where: "k = 3 online bichromatic at bias >= 2",
    finding:
      "DZ Sec. 4 says it is unknown whether Breaker can win with constant speed for 3 < k < 8 (k = 3 is excluded and not discussed). An elementary argument suggests Maker wins k = 3 at ANY finite bias (a Maker triangle thin enough around a segment avoids the finitely many Breaker points) but no source states it.",
    effectOnLab: "Not used for classification: bichromatic online, k = 3, s >= 2 is EXPERIMENTAL (see docs/LAB_REGIMES.md).",
  },
];

// ---------------------------------------------------------------------------
// Das–Valla construction arithmetic (recomputed, to expose D1).
// ---------------------------------------------------------------------------

export interface ConstructionArithmetic {
  readonly k: number;
  // Rounds implied by chaining the lemmas.
  readonly rounds: number;
  readonly points: number; // 2*rounds - 1 (Maker places the (2r-1)-st point in round r)
  readonly printedRounds: number | null;
  readonly printedPoints: number | null;
  readonly consistent: boolean;
}

// Lemma 6: 5-hole in round 4. Lemma 7: +2. Lemma 8: +2. Lemma 9: +5.
export function constructionArithmetic(): readonly ConstructionArithmetic[] {
  const steps: ReadonlyArray<{ k: number; add: number; printedRounds: number | null; printedPoints: number | null }> = [
    { k: 5, add: 4, printedRounds: 4, printedPoints: 7 },
    { k: 6, add: 2, printedRounds: null, printedPoints: null },
    { k: 7, add: 2, printedRounds: 8, printedPoints: 15 },
    { k: 8, add: 5, printedRounds: 12, printedPoints: 25 },
  ];
  const out: ConstructionArithmetic[] = [];
  let rounds = 0;
  for (const s of steps) {
    rounds += s.add;
    const points = 2 * rounds - 1;
    out.push({
      k: s.k,
      rounds,
      points,
      printedRounds: s.printedRounds,
      printedPoints: s.printedPoints,
      consistent:
        (s.printedRounds === null || s.printedRounds === rounds) &&
        (s.printedPoints === null || s.printedPoints === points),
    });
  }
  return out;
}
