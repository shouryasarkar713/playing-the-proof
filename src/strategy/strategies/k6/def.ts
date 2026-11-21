// strategy/strategies/k6/def.ts — the esmb-k6 core strategy
// (Das–Valla Lemma 7 [SRC: CGT 5(2), pp. 3:3–3:4, Figure 1]; [DES]
// conventions per §24). Node ids are the literal §24 ids. Gate D: the
// two-round construction is entered ONLY from k6:b0:inside-forced; all
// other B0 route to k6:immediate. Status is derived (validated-randomized
// until the §24.7 item 7 checks pass — Gate C6).
import type {
  PtExpr,
  RegionExpr,
  StrategyDef,
} from "../../types.ts";

const PAPER = "Das–Valla 2026, Lemma 7 (CGT 5(2), pp. 3:3–3:4, Figure 1)";

const V = (i: number): PtExpr => ({ kind: "anchor", v: `V${i}` });

// Chord-4-hole region skipping vertex i: hull of the other four P5 vertices.
export function chordQuad(skip: number): RegionExpr {
  const of = [];
  for (let j = 0; j < 5; j += 1) {
    if (j !== skip) {
      of.push(V(j));
    }
  }
  return { kind: "hull", of: { kind: "points", of } };
}

export const forcedExpr: RegionExpr = {
  kind: "intersect",
  of: [chordQuad(0), chordQuad(1), chordQuad(2), chordQuad(3), chordQuad(4)],
};

// Ear triangle at vertex i (cut off by the chord across its neighbors).
function earTri(i: number): RegionExpr {
  return {
    kind: "hull",
    of: {
      kind: "points",
      of: [V((i + 4) % 5), V(i), V((i + 1) % 5)],
    },
  };
}

export const p5HullExpr: RegionExpr = {
  kind: "hull",
  of: { kind: "var", v: "P5" },
};



export const esmbK6: StrategyDef = {
  id: "esmb-k6",
  k: 6,
  version: "1.0.0",
  source: {
    paper: PAPER,
    stepMap: {
      "k6:boot":
        "Bob has to place B0 in the common intersection of all the 4-holes to prevent Alice from winning in the immediate next round.",
      "k6:pairing":
        "Alice can find two 4-holes intersecting only in one edge, after the placement of B0.",
      "k6:r5:escape":
        "Alice places A1 in such a way that it creates two 5-holes intersecting in one triangle.",
      "k6:r5:twins":
        "Figure 1 twin witnesses (structural binding step: the pre-B1 pair for the B1 classification).",
      "k6:r5:classify":
        "Case 1: B1 inside the shared triangle; Case 2: B1 inside exactly one of the two 5-holes.",
      "k6:r6:extend":
        "Alice extends the surviving 5-hole to a 6-hole.",
      "k6:immediate":
        "Outside the common intersection, Alice wins in the immediate next round (forcing sentence, contrapositive).",
      "k6:win": "From a 5-hole, a 6-hole within the next two rounds.",
    },
  },
  entry: "k6:boot",
  startVars: ["P5", "V0", "V1", "V2", "V3", "V4"],
  nodes: {
    "k6:boot": {
      id: "k6:boot",
      role: "classify-breaker",
      routes: [
        {
          case: "k6:b0:inside-forced",
          when: { kind: "region", expr: forcedExpr },
          target: "k6:pairing",
          bind: { B0: { kind: "last" } },
        },
        {
          case: "k6:b0:inside-h5",
          when: { kind: "region", expr: p5HullExpr },
          target: "k6:immediate",
        },
        {
          case: "k6:b0:outside-h5",
          when: { kind: "all" },
          target: "k6:immediate",
        },
      ],
      pre: [{ kind: "exists-k-hole", k: 5 }],
      show: [
        {
          kind: "region",
          expr: forcedExpr,
          style: "forced",
          label:
            "Bob's survivable zone (common intersection of the five 4-holes — Lemma 7): outside it, Maker wins immediately.",
        },
        ...[0, 1, 2, 3, 4].map((i) => ({
          kind: "region" as const,
          expr: earTri(i),
          style: "candidate" as const,
          label: `ear ${i} (a B0 here hands Maker an immediate extension target)`,
        })),
        {
          kind: "region",
          expr: p5HullExpr,
          style: "neutral",
          label: "starting 5-hole",
        },
        { kind: "case-map" },
      ],
      why: {
        headline: "Breaker answers from the 5-hole.",
        claims: [
          {
            tier: "strategy-rule",
            text: "The forcing sentence transcribed: inside the forced zone the two-round construction runs; anywhere else the 5-hole is extended at once.",
          },
          {
            tier: "theorem-cited",
            text: "Das–Valla Lemma 7, Figure 1.",
            ref: PAPER,
          },
        ],
        threats: [
          {
            tier: "strategy-rule",
            text: "A B0 outside the forced zone meets the enumerated 5-hole extension.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:pairing": {
      id: "k6:pairing",
      role: "computed-step",
      next: "k6:r5:escape",
      compute: {
        kind: "select-anchored-shared-edge-pair",
        k: 4,
        anchorVar: "B0",
        polyVar: "P5",
        binds: { sharedEdge: "SE", quadA: "quad1", quadB: "quad2" },
      },
      post: [{ kind: "exists-shared-edge-pair", k: 4 }],
      show: [
        {
          kind: "region",
          expr: p5HullExpr,
          style: "structure",
          label: "5-hole after B0",
        },
      ],
      why: {
        headline: "Two 4-holes sharing one edge out of B0.",
        claims: [
          {
            tier: "strategy-rule",
            text: "Anchored-pair selection: 4-hole pairs sharing exactly one edge out of B0, in canonical order.",
          },
          {
            tier: "theorem-cited",
            text: "Das–Valla Lemma 7 (two 4-holes intersecting only in one edge).",
            ref: PAPER,
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:r5:escape": {
      id: "k6:r5:escape",
      role: "maker-move",
      next: "k6:r5:twins",
      placeBind: "A1",
      move: {
        kind: "escape-beyond-edge",
        sharedEdge: { kind: "var", v: "SE" },
        poly: { kind: "var", v: "P5" },
        quads: [{ kind: "var", v: "quad1" }, { kind: "var", v: "quad2" }],
      },
      post: [
        {
          kind: "custom",
          checkerId: "k6-inv:twins",
          args: {
            A1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
          },
          describe:
            "Two 5-hole witnesses share exactly 3 vertices including A1 (the Lemma 7 twins, enumerated — §24.3 item 4).",
        },
      ],
      show: [
        { kind: "highlight-hole", pattern: "twin" },
        { kind: "case-map" },
      ],
      why: {
        headline: "A1 beyond the pentagon edge.",
        claims: [
          {
            tier: "verified-geometry",
            text: "A1 placed; the twin post-condition passed its check.",
          },
          {
            tier: "strategy-rule",
            text: "Adjacent-edge escape across the pentagon edge next to the shared vertex.",
          },
        ],
        invariantNotes: [
          {
            tier: "verified-geometry",
            text: "k6-inv:twins names the checked twin shape.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:r5:twins": {
      id: "k6:r5:twins",
      role: "computed-step",
      next: "k6:r5:classify",
      compute: {
        kind: "select-twin-pair",
        anchorVar: "A1",
        binds: { twinA: "twinA", twinB: "twinB" },
      },
      post: [
        {
          kind: "custom",
          checkerId: "k6-inv:twinpair",
          args: {
            twinA: { kind: "var", v: "twinA" },
            twinB: { kind: "var", v: "twinB" },
          },
          describe:
            "The bound pre-B1 twins twinA/twinB both exist as 5-holes (re-asserted — §24.3b).",
        },
      ],
      show: [
        { kind: "highlight-hole", pattern: "twin" },
        { kind: "case-map" },
      ],
      why: {
        headline: "The pre-B1 twin witnesses bound.",
        claims: [
          {
            tier: "strategy-rule",
            text: "Canonical twin-pair selection over the after-A1 enumeration.",
          },
          {
            tier: "verified-geometry",
            text: "The bound pair re-asserted by k6-inv:twinpair.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:r5:classify": {
      id: "k6:r5:classify",
      role: "classify-breaker",
      routes: [
        {
          case: "k6:b1:inside-shared-triangle",
          when: {
            kind: "classifier",
            classifierId: "classifyB1",
            inputs: {
              twinA: { kind: "var", v: "twinA" },
              twinB: { kind: "var", v: "twinB" },
              se: { kind: "var", v: "SE" },
              a1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
            },
            on: { tag: "inside-shared-triangle" },
          },
          target: "k6:r6:extend",
        },
        {
          case: "k6:b1:inside-twin",
          when: {
            kind: "classifier",
            classifierId: "classifyB1",
            inputs: {
              twinA: { kind: "var", v: "twinA" },
              twinB: { kind: "var", v: "twinB" },
              se: { kind: "var", v: "SE" },
              a1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
            },
            on: { tag: "inside-twin" },
          },
          target: "k6:r6:extend",
        },
        {
          case: "k6:b1:else",
          when: { kind: "all" },
          target: "k6:r6:extend",
        },
      ],
      post: [{ kind: "exists-k-hole", k: 5 }],
      show: [
        { kind: "highlight-hole", pattern: "survivors" },
        { kind: "case-map" },
      ],
      why: {
        headline: "Breaker's B1 is sorted against the twin 5-holes.",
        claims: [
          {
            tier: "verified-geometry",
            text: "Hull and containment arithmetic on the pre-B1 twins sorts B1 into the shared triangle, a twin interior, or elsewhere.",
          },
          {
            tier: "strategy-rule",
            text: "Inside the shared triangle, B1 turns into a vertex of replacement holes.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:r6:extend": {
      id: "k6:r6:extend",
      role: "maker-move",
      next: "k6:win",
      placeBind: "A2",
      move: {
        kind: "extend",
        hole: { kind: "enumerate", k: 5 },
        prefer: "largest-interval",
      },
      post: [{ kind: "exists-k-hole", k: 6 }],
      show: [{ kind: "highlight-hole", pattern: "survivors" }],
      why: {
        headline: "The surviving 5-hole grows to six.",
        claims: [
          {
            tier: "verified-geometry",
            text: "A2 extends an enumerated 5-hole; the 6-hole check passed.",
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
    "k6:immediate": {
      id: "k6:immediate",
      role: "maker-move",
      next: "k6:win",
      placeBind: "A1",
      move: {
        kind: "extend",
        hole: { kind: "enumerate", k: 5 },
        prefer: "largest-interval",
      },
      post: [{ kind: "exists-k-hole", k: 6 }],
      show: [
        { kind: "highlight-hole", pattern: "survivors" },
        {
          kind: "region",
          expr: p5HullExpr,
          style: "structure",
          label: "5-hole under extension",
        },
      ],
      why: {
        headline: "Outside the forced zone: immediate extension.",
        claims: [
          {
            tier: "theorem-cited",
            text: "Das–Valla Lemma 7 forcing sentence: outside the common intersection, Maker wins in the immediate next round.",
            ref: PAPER,
          },
          {
            tier: "verified-geometry",
            text: "A 5-hole enumerated after B0; the 6-hole check passed.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k6:win": {
      id: "k6:win",
      role: "terminal",
      show: [{ kind: "highlight-hole", pattern: "winning" }],
      why: {
        headline: "6-hole achieved: game over.",
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
  },
};



