// strategy/strategies/k7/def.ts — the esmb-k7 strategy
// (Das–Valla Lemma 8 / Theorem 1 [SRC: CGT 5(2), p. 3:4, Figure 2]; [DES]
// reconstruction and conventions described in docs/K7_GATE.md).
//
// The paper's proof sketch is thin; this encoding follows the audited
// reconstruction:
//   * B0 outside the starting 6-hole → the hexagon survives → extend at once.
//   * B0 inside it lies in exactly three of the six 4-holes (one half of each
//     main chord), so exactly three survive; among them two share an edge
//     (Q_i, Q_{i+2}) and each survivor plus B0 is a 5-hole (the two 5-holes
//     meet exactly in the triangle C D B0).
//   * A1 just outside that shared edge CD: the extended halves are two 6-holes
//     meeting exactly in the convex quadrilateral C A1 D B0 (A1/B0 opposite).
//   * B1 kills at most one 6-hole unless it lies in that quadrilateral, where
//     it is an ear of one of the holes (diagonal A1–B0) → a replacement hole.
//   * A2 extends a surviving 6-hole to a 7-hole.
// Status is derived (validated-randomized: no recorded exact check promotes it).
import type { PtExpr, RegionExpr, StrategyDef, StrategyNode } from "../../types.ts";

const PAPER =
  "Das–Valla 2026, Lemma 8 and Theorem 1 (CGT 5(2), p. 3:4, Figure 2)";

const V = (i: number): PtExpr => ({ kind: "anchor", v: `V${i % 6}` });
const A = (name: string): PtExpr => ({ kind: "anchor", v: name });

export const hexExpr: RegionExpr = {
  kind: "hull",
  of: { kind: "var", v: "P6" },
};

// The 4-hole "half" Q_i = hull(V_i .. V_{i+3}) of the starting hexagon.
export function halfQuad(i: number): RegionExpr {
  return {
    kind: "hull",
    of: {
      kind: "points",
      of: [V(i), V(i + 1), V(i + 2), V(i + 3)],
    },
  };
}

// The B0 pattern region for a survivor mask: bit j (chord j: V_j–V_{j+3},
// j = 0..2) set ⇒ survivor Q_j (B0 on the LEFT of V_j→V_{j+3}); clear ⇒
// survivor Q_{j+3} (B0 on the RIGHT). Q_j = hull(V_j..V_{j+3}) lies right of
// V_j→V_{j+3}, so B0 outside Q_j ⇔ B0 left of it.
export function survivorsOfMask(mask: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < 3; j += 1) {
    out.push((mask >> j) & 1 ? j : j + 3);
  }
  return out.sort((a, b) => a - b);
}

export function patternExpr(mask: number): RegionExpr {
  const parts: RegionExpr[] = [hexExpr];
  for (let j = 0; j < 3; j += 1) {
    parts.push({
      kind: "halfplane",
      thru: [V(j), V(j + 3)],
      side: (mask >> j) & 1 ? "left" : "right",
    });
  }
  return { kind: "intersect", of: parts };
}

// "central" = the three survivors alternate around the hexagon ({0,2,4} or
// {1,3,5}): the paper's Figure 2 configuration (B0 in the central triangle of
// the three main chords). "sector" = three consecutive survivors.
export function patternCaseId(mask: number): string {
  const s = survivorsOfMask(mask);
  const alternating = s.every((v) => v % 2 === (s[0] as number) % 2);
  return `k7:b0:${alternating ? "central" : "sector"}-${s.join("")}`;
}

// The A1 candidate region (the open convex region in which BOTH extended
// halves are in convex position): outside edge CD, inside the wedge lines
// B→C and D→E, and on the inner sides of D→B0 and B0→C. Emptiness of the
// two 6-holes is an additional exact check (a thin triangle by CD).
export const a1RegionExpr: RegionExpr = {
  kind: "intersect",
  of: [
    { kind: "halfplane", thru: [A("HC"), A("HD")], side: "right" },
    { kind: "halfplane", thru: [A("HB"), A("HC")], side: "left" },
    { kind: "halfplane", thru: [A("HD"), A("HE")], side: "left" },
    { kind: "halfplane", thru: [A("HD"), A("B0")], side: "left" },
    { kind: "halfplane", thru: [A("B0"), A("HC")], side: "left" },
  ],
};

const MASKS = [0, 1, 2, 3, 4, 5, 6, 7];

const twinInputs = {
  twinA: { kind: "var", v: "twinA" },
  twinB: { kind: "var", v: "twinB" },
  a1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
  b0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
} as const;

const classifyRoute = (tag: string, caseId: string) => ({
  case: caseId,
  when: {
    kind: "classifier" as const,
    classifierId: "classifyB1Hex",
    inputs: twinInputs,
    on: { tag },
  },
  target: "k7:r2:extend",
  interaction: "interactive" as const,
});

const nodes: Record<string, StrategyNode> = {
  "k7:boot": {
    id: "k7:boot",
    role: "classify-breaker",
    routes: [
      ...MASKS.map((mask) => ({
        case: patternCaseId(mask),
        when: { kind: "region" as const, expr: patternExpr(mask) },
        target: "k7:pairing",
        bind: { B0: { kind: "last" as const } },
        interaction: "interactive" as const,
      })),
      {
        case: "k7:b0:outside-hexagon",
        when: { kind: "all" },
        target: "k7:immediate",
        interaction: "interactive",
      },
    ],
    pre: [{ kind: "exists-k-hole", k: 6 }],
    show: [
      {
        kind: "region",
        expr: hexExpr,
        style: "neutral",
        label: "starting 6-hole",
      },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        kind: "region" as const,
        expr: halfQuad(i),
        style: "structure" as const,
        label: `4-hole Q${i} (V${i}..V${(i + 3) % 6}): one half of main chord V${i % 3}–V${(i % 3) + 3}`,
      })),
      ...[0, 1, 2].map((j) => ({
        kind: "poly-line" as const,
        of: [V(j), V(j + 3)],
        style: "reference" as const,
      })),
      {
        kind: "region",
        expr: patternExpr(0b101),
        style: "forced",
        label:
          "Central triangle of the three main chords (Figure 2 case; present only when they are not concurrent): B0 here lies in three alternate 4-holes.",
      },
      {
        kind: "region",
        expr: patternExpr(0b010),
        style: "forced",
        label:
          "Central triangle of the three main chords, other orientation (present only when they are not concurrent).",
      },
      { kind: "case-map" },
    ],
    why: {
      headline: "Breaker answers from the 6-hole.",
      claims: [
        {
          tier: "strategy-rule",
          text: "Outside the hexagon the 6-hole is untouched and is extended at once; strictly inside it, B0 lies in exactly one half of each of the three main chords, so exactly three of the six 4-holes survive.",
        },
        {
          tier: "verified-geometry",
          text: "The case map sorts B0 by its side of each main chord; every inside case runs the same two-round construction.",
        },
        {
          tier: "theorem-cited",
          text: "Das–Valla Lemma 8, Figure 2.",
          ref: PAPER,
        },
      ],
      threats: [
        {
          tier: "strategy-rule",
          text: "A B0 inside the hexagon is the only reply that destroys the 6-hole; it is met by the two-round construction below.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:pairing": {
    id: "k7:pairing",
    role: "computed-step",
    next: "k7:r1:escape",
    compute: {
      kind: "select-chord-half-pair",
      holeVar: "P6",
      anchorVar: "B0",
      binds: {
        v0: "HA",
        v1: "HB",
        v2: "HC",
        v3: "HD",
        v4: "HE",
        v5: "HF",
        ring: "RING",
        edge: "SE",
        halfA: "quadA",
        halfB: "quadB",
      },
    },
    post: [
      {
        kind: "custom",
        checkerId: "k7-inv:pair5",
        args: {
          halfA: { kind: "var", v: "quadA" },
          halfB: { kind: "var", v: "quadB" },
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
        },
        describe:
          "The two surviving chord halves, each extended by B0, are 5-holes meeting exactly in a triangle (Lemma 8, first step).",
      },
    ],
    show: [
      {
        kind: "region",
        expr: hexExpr,
        style: "structure",
        label: "6-hole after B0",
      },
    ],
    why: {
      headline: "Two surviving 4-holes sharing the edge CD.",
      claims: [
        {
          tier: "strategy-rule",
          text: "Of the three 4-holes that survive B0, the first rotation of the hexagon whose halves Q_i and Q_{i+2} both survive is taken; each of them extended by B0 is a 5-hole.",
        },
        {
          tier: "verified-geometry",
          text: "k7-inv:pair5 checks both 5-holes exactly and that they meet only in the triangle C D B0.",
        },
        {
          tier: "theorem-cited",
          text: "Das–Valla Lemma 8 (two 5-holes intersecting in one triangle).",
          ref: PAPER,
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:r1:escape": {
    id: "k7:r1:escape",
    role: "maker-move",
    next: "k7:r1:twins",
    placeBind: "A1",
    move: {
      kind: "escape-pair-beyond-edge",
      edge: { kind: "var", v: "SE" },
      ring: { kind: "var", v: "RING" },
      anchor: "B0",
      halves: [
        { kind: "var", v: "quadA" },
        { kind: "var", v: "quadB" },
      ],
    },
    post: [
      {
        kind: "custom",
        checkerId: "k7-inv:twins6",
        args: {
          halfA: { kind: "var", v: "quadA" },
          halfB: { kind: "var", v: "quadB" },
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
          A1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
        },
        describe:
          "After A1 both extended halves are 6-holes meeting exactly in the convex quadrilateral C A1 D B0 (Lemma 8 twins).",
      },
    ],
    show: [
      {
        kind: "region",
        expr: a1RegionExpr,
        style: "candidate",
        label:
          "A1 region: outside edge CD where both extended halves are convex; A1 is placed close to the edge (emptiness is then checked exactly).",
      },
      {
        kind: "poly-line",
        of: [A("HC"), A("HD")],
        style: "shared-edge",
      },
      {
        kind: "region",
        expr: { kind: "hull", of: { kind: "var", v: "quadA" } },
        style: "candidate",
        label: "surviving 4-hole A (empty of B0)",
      },
      {
        kind: "region",
        expr: { kind: "hull", of: { kind: "var", v: "quadB" } },
        style: "candidate",
        label: "surviving 4-hole B (empty of B0)",
      },
      { kind: "highlight-hole", pattern: "twin" },
    ],
    why: {
      headline: "A1 just beyond the shared edge CD.",
      claims: [
        {
          tier: "verified-geometry",
          text: "A1 placed; the twin post-condition passed its exact check (two 6-holes meeting in one convex quadrilateral).",
        },
        {
          tier: "strategy-rule",
          text: "Near-first halving search toward the midpoint of CD, accepting only a point after which both extended halves are exact 6-holes.",
        },
      ],
      invariantNotes: [
        {
          tier: "verified-geometry",
          text: "k7-inv:twins6 names the checked twin shape (shared quadrilateral C A1 D B0, A1/B0 opposite, one ear per hole).",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:r1:twins": {
    id: "k7:r1:twins",
    role: "computed-step",
    next: "k7:r1:classify",
    compute: {
      kind: "select-twin-holes",
      holeSize: 6,
      anchorVars: ["A1", "B0"],
      binds: { twinA: "twinA", twinB: "twinB", quad: "QD" },
    },
    post: [
      {
        kind: "custom",
        checkerId: "k7-inv:twinpair6",
        args: {
          twinA: { kind: "var", v: "twinA" },
          twinB: { kind: "var", v: "twinB" },
          A1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
        },
        describe:
          "The bound pre-B1 twins twinA/twinB are 6-holes meeting exactly in a convex quadrilateral, one ear per hole (re-asserted).",
      },
    ],
    show: [{ kind: "highlight-hole", pattern: "twin" }],
    why: {
      headline: "The pre-B1 twin 6-holes bound.",
      claims: [
        {
          tier: "strategy-rule",
          text: "Canonical twin selection over the after-A1 enumeration of 6-holes; the pair must meet exactly in a quadrilateral with A1 and B0 as its diagonal.",
        },
        {
          tier: "verified-geometry",
          text: "The bound pair re-asserted by k7-inv:twinpair6.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:r1:classify": {
    id: "k7:r1:classify",
    role: "classify-breaker",
    routes: [
      classifyRoute("inside-ear-A", "k7:b1:inside-shared-quad-ear-A"),
      classifyRoute("inside-ear-B", "k7:b1:inside-shared-quad-ear-B"),
      classifyRoute("inside-twin-A", "k7:b1:inside-twin-A-only"),
      classifyRoute("inside-twin-B", "k7:b1:inside-twin-B-only"),
      {
        case: "k7:b1:else",
        when: { kind: "all" },
        target: "k7:r2:extend",
        interaction: "interactive",
      },
    ],
    post: [{ kind: "exists-k-hole", k: 6 }],
    show: [
      { kind: "highlight-hole", pattern: "survivors" },
      {
        kind: "region",
        expr: hexExpr,
        style: "neutral",
        label: "starting 6-hole",
      },
      {
        kind: "region",
        expr: { kind: "hull", of: { kind: "var", v: "QD" } },
        style: "structure",
        label:
          "shared quadrilateral: B1 here kills both twins but is an ear of one — a replacement 6-hole appears",
      },
      { kind: "case-map" },
    ],
    why: {
      headline: "Breaker's B1 is sorted against the twin 6-holes.",
      claims: [
        {
          tier: "verified-geometry",
          text: "Hull and containment arithmetic on the pre-B1 twins sorts B1 into an ear of the shared quadrilateral, one twin only, or neither.",
        },
        {
          tier: "strategy-rule",
          text: "Inside the shared quadrilateral B1 is an ear of exactly one twin; replacing that ear's apex by B1 gives a new 6-hole.",
        },
        {
          tier: "theorem-cited",
          text: "Das–Valla Lemma 8: at least one 6-hole remains after B1.",
          ref: PAPER,
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:r2:extend": {
    id: "k7:r2:extend",
    role: "maker-move",
    next: "k7:win",
    placeBind: "A2",
    move: {
      kind: "extend",
      hole: { kind: "enumerate", k: 6 },
      prefer: "largest-interval",
    },
    post: [{ kind: "exists-k-hole", k: 7 }],
    show: [{ kind: "highlight-hole", pattern: "survivors" }],
    why: {
      headline: "The surviving 6-hole grows to seven.",
      claims: [
        {
          tier: "verified-geometry",
          text: "A2 extends an enumerated 6-hole; the 7-hole check passed.",
        },
        {
          tier: "strategy-rule",
          text: "Largest-interval edge choice; ties break canonically.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:immediate": {
    id: "k7:immediate",
    role: "maker-move",
    next: "k7:win",
    placeBind: "A1",
    move: {
      kind: "extend",
      hole: { kind: "enumerate", k: 6 },
      prefer: "largest-interval",
    },
    post: [{ kind: "exists-k-hole", k: 7 }],
    show: [
      { kind: "highlight-hole", pattern: "survivors" },
      {
        kind: "region",
        expr: hexExpr,
        style: "structure",
        label: "6-hole under extension",
      },
    ],
    why: {
      headline: "Outside the hexagon: immediate extension.",
      claims: [
        {
          tier: "strategy-rule",
          text: "A B0 outside the 6-hole leaves it empty, so the 6-hole is extended at once.",
        },
        {
          tier: "verified-geometry",
          text: "A 6-hole enumerated after B0; the 7-hole check passed.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k7:win": {
    id: "k7:win",
    role: "terminal",
    show: [{ kind: "highlight-hole", pattern: "winning" }],
    why: {
      headline: "7-hole achieved: game over.",
      claims: [
        {
          tier: "verified-geometry",
          text: "Witness computed by exact enumeration.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
};

export const esmbK7: StrategyDef = {
  id: "esmb-k7",
  k: 7,
  version: "1.0.0",
  source: {
    paper: PAPER,
    stepMap: {
      "k7:boot":
        "Since Bob can place B0 inside the intersection of at most three out of these six 4-holes, ... (a B0 inside the hexagon is the only one that matters).",
      "k7:pairing":
        "Alice can find two 5-holes intersecting in one triangle after the placement of B0 inside the 6-hole.",
      "k7:r1:escape":
        "She can extend these two 5-holes into two 6-holes intersecting in one convex quadrilateral.",
      "k7:r1:twins":
        "Figure 2 twin witnesses (structural binding step: the pre-B1 pair for the B1 classification).",
      "k7:r1:classify":
        "As a result, after the placement of B1, at least one 6-hole remains in the plane.",
      "k7:r2:extend":
        "...that can be extended to a 7-hole in the next round (A2).",
      "k7:immediate":
        "Outside the hexagon the 6-hole survives and is extended at once (derived).",
      "k7:win": "From a 6-hole, a 7-hole within the next two rounds.",
    },
  },
  entry: "k7:boot",
  startVars: ["P6", "V0", "V1", "V2", "V3", "V4", "V5"],
  nodes,
};
