// strategy/strategies/k8/def.ts — esmb-k8: the GUIDED walkthrough of
// Das–Valla Lemma 9 / Theorem 2 [SRC: CGT 5(2), pp. 3:5–3:7, Figures 3–5].
// Reconstruction, proofs, round count and the gate record: docs/K8_GATE.md.
//
// Round structure from the starting 7-hole (verified count, NOT the paper's
// "12"): B0 | A1 B1 | A2 B2 | A3 B3 | A4 B4 | A5 — five Maker moves A1..A5 after
// the 7-hole (Lemma 9: "within the next five rounds"), the 8-hole at the 13th
// round of the whole game with 25 points (7+4+4 = 15 at the 7-hole, then +1
// +9). Every classify route declares how far its response class is verified:
//   interactive — verified exactly; free play offered
//   guided      — continuation verified along the stated path + per-move
//                 exact checks (post-conditions); anything the checks cannot
//                 confirm ends as a typed uncovered terminal
//   unverified  — NOT encoded: the session ends honestly as `uncovered`
import type { PtExpr, RegionExpr, RouteRule, StrategyDef, StrategyNode } from "../../types.ts";

const PAPER =
  "Das–Valla 2026, Lemma 9, Observations 1–2, Theorem 2 (CGT 5(2), pp. 3:5–3:7, Figures 3–5)";

const V = (i: number): PtExpr => ({ kind: "anchor", v: `V${((i % 7) + 7) % 7}` });
const hullVar = (v: string): RegionExpr => ({ kind: "hull", of: { kind: "var", v } });

export const heptExpr: RegionExpr = hullVar("P7");

const sevenHalf = (i: number): RegionExpr => ({
  kind: "hull",
  of: { kind: "points", of: [V(i), V(i + 1), V(i + 2), V(i + 3)] },
});

const NEXT_WIN = "k8:win";

const extend7 = (
  id: string,
  bind: string,
  headline: string,
  claim: string,
): StrategyNode => ({
  id,
  role: "maker-move",
  next: NEXT_WIN,
  placeBind: bind,
  move: { kind: "extend", hole: { kind: "enumerate", k: 7 }, prefer: "largest-interval" },
  post: [{ kind: "exists-k-hole", k: 8 }],
  show: [{ kind: "highlight-hole", pattern: "survivors" }],
  why: {
    headline,
    claims: [
      { tier: "strategy-rule", text: claim },
      { tier: "verified-geometry", text: "A 7-hole enumerated after the Breaker move; the 8-hole check passed." },
    ],
    sourceRef: PAPER,
  },
  sourceRef: PAPER,
});

const route = (
  caseId: string,
  tag: string,
  classifierId: string,
  inputs: Record<string, never> | Record<string, { kind: "var"; v: string }>,
  target: string,
  interaction: NonNullable<RouteRule["interaction"]>,
  extra: Partial<RouteRule> = {},
): RouteRule => ({
  case: caseId,
  when: { kind: "classifier", classifierId, inputs, on: { tag } },
  target,
  interaction,
  ...extra,
});

const nodes: Record<string, StrategyNode> = {
  "k8:boot": {
    id: "k8:boot",
    role: "classify-breaker",
    routes: [
      route("k8:b0:outside-heptagon", "outside", "classifyB0Hept", { hole: { kind: "var", v: "P7" } }, "k8:immediate", "interactive"),
      route("k8:b0:inside-pair", "pair", "classifyB0Hept", { hole: { kind: "var", v: "P7" } }, "k8:pairing", "guided", {
        bind: { B0: { kind: "last" } },
      }),
      {
        case: "k8:b0:inside-no-pair",
        when: { kind: "all" },
        target: "k8:pairing",
        interaction: "unverified",
        note: "B0 inside the 7-hole lies in too many 4-holes for two chord halves to survive: the paper gives one instance only, so this class is not encoded.",
      },
    ],
    pre: [{ kind: "exists-k-hole", k: 7 }],
    show: [
      { kind: "region", expr: heptExpr, style: "neutral", label: "starting 7-hole" },
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({
        kind: "region" as const,
        expr: sevenHalf(i),
        style: "structure" as const,
        label: `4-hole S${i} (V${i}..V${(i + 3) % 7}): the 4-side of chord V${i}–V${(i + 3) % 7}`,
      })),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({
        kind: "poly-line" as const,
        of: [V(i), V(i + 3)],
        style: "reference" as const,
      })),
      { kind: "case-map" },
    ],
    why: {
      headline: "Breaker answers from the 7-hole.",
      claims: [
        {
          tier: "strategy-rule",
          text: "Outside the heptagon it stays empty and is extended at once. Inside, the encoded construction needs two chord halves S_j and S_{j+3} that both survive B0 as 5-holes meeting only in a segment.",
        },
        {
          tier: "verified-geometry",
          text: "Each of the seven chords splits the 7-hole into a 4-hole and a 5-hole; the case map sorts B0 by the exact pair test.",
        },
        {
          tier: "theorem-cited",
          text: "Das–Valla Lemma 9 and Figure 3: seven chords, each cutting off a 5-hole and a 4-hole.",
          ref: PAPER,
        },
      ],
      threats: [
        {
          tier: "uncovered",
          text: "A B0 for which no two chord halves survive is not encoded in this build; the session ends as uncovered there.",
        },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:immediate": extend7(
    "k8:immediate",
    "A1",
    "Outside the heptagon: immediate extension.",
    "A B0 outside the 7-hole leaves it empty, so it is extended to an 8-hole at once.",
  ),
  "k8:pairing": {
    id: "k8:pairing",
    role: "computed-step",
    next: "k8:r1:escape",
    compute: {
      kind: "select-heptagon-pair",
      holeVar: "P7",
      anchorVar: "B0",
      binds: {
        v0: "H0", v1: "H1", v2: "H2", v3: "H3", v4: "H4", v5: "H5", v6: "H6",
        ring: "RING",
        edge: "SE",
        pentA: "pentA",
        pentB: "pentB",
      },
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:pent-pair",
        args: {
          pentA: { kind: "var", v: "pentA" },
          pentB: { kind: "var", v: "pentB" },
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
        },
        describe: "The two chord halves, each extended by B0, are 5-holes meeting only in a segment (Lemma 9, first step).",
      },
    ],
    show: [{ kind: "region", expr: heptExpr, style: "structure", label: "7-hole after B0" }],
    why: {
      headline: "Two 5-holes sharing the segment B0–E.",
      claims: [
        {
          tier: "strategy-rule",
          text: "The first rotation of the heptagon whose chord halves S_j and S_{j+3} both survive B0 is taken; each half plus B0 is a 5-hole and the two meet only on the segment from B0 to their common vertex E.",
        },
        { tier: "verified-geometry", text: "k8-inv:pent-pair checks both 5-holes and their disjoint interiors exactly." },
        { tier: "theorem-cited", text: "Das–Valla Lemma 9: a first step like Lemma 8 (the 4-hole halves of the chords).", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r1:escape": {
    id: "k8:r1:escape",
    role: "maker-move",
    next: "k8:r1:twins",
    placeBind: "A1",
    move: {
      kind: "escape-edge-accept",
      options: [
        {
          edge: { kind: "var", v: "SE" },
          ring: { kind: "var", v: "RING" },
          grow: [{ kind: "var", v: "pentA" }, { kind: "var", v: "pentB" }],
          meet: 3,
        },
      ],
      exactAnchor: "B0",
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:twins-any",
        args: {
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
          A1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
        },
        describe: "After A1 two 6-holes through A1 meet exactly in a triangle with A1 and B0 as vertices (Lemma 9 twins).",
      },
    ],
    show: [
      { kind: "region", expr: hullVar("pentA"), style: "candidate", label: "5-hole A with B0" },
      { kind: "region", expr: hullVar("pentB"), style: "candidate", label: "5-hole B with B0" },
      { kind: "poly-line", of: [{ kind: "anchor", v: "H3" }, { kind: "anchor", v: "H4" }], style: "shared-edge" },
      { kind: "highlight-hole", pattern: "twin" },
    ],
    why: {
      headline: "A1 just beyond the edge next to the common vertex E.",
      claims: [
        { tier: "verified-geometry", text: "A1 placed; its post-condition passed: two 6-holes meet exactly in the triangle B0·E·A1." },
        { tier: "strategy-rule", text: "Near-first halving search beyond the ring edge E→F, accepting only a point that makes both extended 5-holes exact 6-holes meeting exactly in a triangle." },
        { tier: "theorem-cited", text: "Das–Valla Lemma 9 and Figure 3 (left): two 6-holes AB0EA1FG and BCDEA1B0 intersecting in one triangle.", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r1:twins": {
    id: "k8:r1:twins",
    role: "computed-step",
    next: "k8:r1:classify",
    compute: {
      kind: "select-twin-triangle",
      anchorVars: ["A1", "B0"],
      binds: { twinA: "twinA", twinB: "twinB", tri: "TRI" },
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:twinpair-tri",
        args: {
          twinA: { kind: "var", v: "twinA" },
          twinB: { kind: "var", v: "twinB" },
          A1: { kind: "points", of: [{ kind: "anchor", v: "A1" }] },
          B0: { kind: "points", of: [{ kind: "anchor", v: "B0" }] },
        },
        describe: "The bound pre-B1 twins are 6-holes meeting exactly in a triangle, one ear per hole (re-asserted).",
      },
    ],
    show: [{ kind: "highlight-hole", pattern: "twin" }],
    why: {
      headline: "The pre-B1 twin 6-holes bound.",
      claims: [
        { tier: "strategy-rule", text: "Canonical twin selection over the after-A1 enumeration of 6-holes." },
        { tier: "verified-geometry", text: "The bound pair re-asserted by k8-inv:twinpair-tri." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r1:classify": {
    id: "k8:r1:classify",
    role: "classify-breaker",
    routes: [
      {
        case: "k8:b1:inside-shared-triangle",
        when: { kind: "region", expr: hullVar("TRI") },
        target: "k8:r2:ears",
        bind: { B1: { kind: "last" } },
        interaction: "guided",
      },
      {
        case: "k8:b1:elsewhere",
        when: { kind: "all" },
        target: "k8:r2:ears",
        interaction: "unverified",
        note: "B1 outside the shared triangle is not encoded: the paper's continuation covers the shared-triangle reply only.",
      },
    ],
    post: [{ kind: "exists-k-hole", k: 6 }],
    show: [
      { kind: "highlight-hole", pattern: "survivors" },
      { kind: "region", expr: heptExpr, style: "neutral", label: "starting 7-hole" },
      { kind: "region", expr: hullVar("TRI"), style: "structure", label: "shared triangle: B1 here is an ear of BOTH 6-holes (Observation 1)" },
      { kind: "case-map" },
    ],
    why: {
      headline: "Breaker's B1 is sorted against the twin 6-holes.",
      claims: [
        { tier: "verified-geometry", text: "Hull arithmetic on the bound twins decides whether B1 lies in their shared triangle." },
        { tier: "strategy-rule", text: "Inside the shared triangle B1 is an ear of both 6-holes: replacing the ear apex by B1 gives two new 6-holes sharing exactly one edge." },
        { tier: "theorem-cited", text: "Das–Valla Observation 1: after B1 there are two 6-holes sharing exactly one common edge.", ref: PAPER },
      ],
      threats: [
        { tier: "uncovered", text: "B1 outside the shared triangle is not encoded here; the session ends as uncovered." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r2:ears": {
    id: "k8:r2:ears",
    role: "computed-step",
    next: "k8:r2:escape",
    compute: {
      kind: "select-ear-replacement",
      twinA: "twinA",
      twinB: "twinB",
      tri: "TRI",
      b1Var: "B1",
      binds: { ring1: "R1", edge1: "E1", k1a: "K1A", k1b: "K1B", ring2: "R2", edge2: "E2", k2a: "K2A", k2b: "K2B" },
    },
    show: [{ kind: "highlight-hole", pattern: "twin" }],
    why: {
      headline: "The two replacement 6-holes bound.",
      claims: [
        { tier: "strategy-rule", text: "Each twin with its ear apex replaced by B1 is a 6-hole; the two share exactly the edge from B1 to the third triangle vertex." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r2:escape": {
    id: "k8:r2:escape",
    role: "maker-move",
    next: "k8:r2:x",
    placeBind: "A2",
    move: {
      kind: "escape-edge-accept",
      options: [
        {
          edge: { kind: "var", v: "E1" },
          ring: { kind: "var", v: "R1" },
          grow: [{ kind: "var", v: "R1" }, { kind: "var", v: "K1A" }, { kind: "var", v: "K1B" }],
        },
        {
          edge: { kind: "var", v: "E2" },
          ring: { kind: "var", v: "R2" },
          grow: [{ kind: "var", v: "R2" }, { kind: "var", v: "K2A" }, { kind: "var", v: "K2B" }],
        },
      ],
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:obs1",
        args: { A2: { kind: "points", of: [{ kind: "anchor", v: "A2" }] } },
        describe: "Observation 1: a 7-hole through A2 and two 6-holes sharing adjacent single edges with it.",
      },
    ],
    show: [
      { kind: "region", expr: hullVar("R1"), style: "candidate", label: "replacement 6-hole extended across the shared edge" },
      { kind: "region", expr: hullVar("R2"), style: "candidate", label: "replacement 6-hole on the other side" },
      { kind: "poly-line", of: [{ kind: "anchor", v: "B1" }, { kind: "anchor", v: "B0" }], style: "shared-edge" },
    ],
    why: {
      headline: "A2 across the shared edge: one 7-hole, two 6-holes.",
      claims: [
        { tier: "verified-geometry", text: "A2 placed; k8-inv:obs1 enumerated a 7-hole through A2 and two 6-holes sharing adjacent single edges with it." },
        { tier: "strategy-rule", text: "Near-first halving search beyond the shared edge of one replacement hole, accepting only a point that extends it to an exact 7-hole and turns the other replacement hole into two exact 6-holes." },
        { tier: "theorem-cited", text: "Das–Valla Observation 1 and Figure 3 (right): A2 inside triangles B0BB1, B0EB1 and the triangle cut by the prolongations of AB0 and A1B1.", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r2:x": {
    id: "k8:r2:x",
    role: "computed-step",
    next: "k8:r2:classify",
    compute: {
      kind: "select-hole-through",
      holeSize: 7,
      anchorVar: "A2",
      binds: { hole: "X" },
    },
    post: [{ kind: "exists-k-hole", k: 7 }],
    show: [{ kind: "highlight-hole", pattern: "survivors" }],
    why: {
      headline: "The 7-hole X bound.",
      claims: [{ tier: "verified-geometry", text: "The canonical 7-hole through A2, found by enumeration." }],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r2:classify": {
    id: "k8:r2:classify",
    role: "classify-breaker",
    routes: [
      {
        case: "k8:b2:inside-seven",
        when: { kind: "region", expr: hullVar("X") },
        target: "k8:r3:escape",
        bind: { B2: { kind: "last" } },
        interaction: "guided",
      },
      {
        case: "k8:b2:outside-seven",
        when: { kind: "all" },
        target: "k8:r2:extend",
        interaction: "interactive",
      },
    ],
    post: [{ kind: "exists-k-hole", k: 6 }],
    show: [
      { kind: "region", expr: hullVar("X"), style: "structure", label: "the 7-hole X: Breaker must place B2 inside it" },
      { kind: "case-map" },
    ],
    why: {
      headline: "Breaker must put B2 inside the 7-hole.",
      claims: [
        { tier: "verified-geometry", text: "Hull containment against the bound 7-hole X." },
        { tier: "strategy-rule", text: "A B2 outside X leaves X empty: it is extended to an 8-hole at once. A B2 inside X continues with the forcing move A3." },
        { tier: "theorem-cited", text: "Das–Valla: Bob must place B2 inside the 7-hole to prevent an immediate win.", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r2:extend": extend7(
    "k8:r2:extend",
    "A3",
    "B2 outside X: the 7-hole is extended.",
    "A B2 outside X leaves X empty, so it is extended to an 8-hole at once.",
  ),
  "k8:r3:escape": {
    id: "k8:r3:escape",
    role: "maker-move",
    next: "k8:r3:classify",
    placeBind: "A3",
    move: {
      kind: "forcing-pair",
      ring: { kind: "var", v: "X" },
      chain: ["B0", "A2", "B1"],
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:forcing",
        args: {
          A3: { kind: "points", of: [{ kind: "anchor", v: "A3" }] },
          chain: { kind: "points", of: [{ kind: "anchor", v: "B0" }, { kind: "anchor", v: "A2" }, { kind: "anchor", v: "B1" }] },
        },
        describe: "After A3 two 6-holes through A3 meet exactly in a triangle and neither has B0·A2·B1 consecutive.",
      },
    ],
    show: [{ kind: "region", expr: hullVar("X"), style: "structure", label: "7-hole X (now dead: B2 inside)" }],
    why: {
      headline: "A3 forces B3: two 6-holes meeting in a triangle.",
      claims: [
        { tier: "verified-geometry", text: "A3 placed; k8-inv:forcing enumerated two 6-holes through A3 meeting exactly in a triangle, neither containing both edges B0A2 and A2B1." },
        { tier: "strategy-rule", text: "Candidate points just outside each edge of X in canonical order; the first one passing the exact forcing check is placed." },
        { tier: "theorem-cited", text: "Das–Valla Observation 2 and Figure 4: A3 creates two 6-holes intersecting in one triangle, none containing both B0A2 and A2B1 as edges.", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r3:classify": {
    id: "k8:r3:classify",
    role: "classify-breaker",
    routes: [
      route("k8:b3:seven-hole", "seven-hole", "classifyB3Obs2", {}, "k8:r3:extend", "interactive"),
      route("k8:b3:vertex-pair", "vertex-pair", "classifyB3Obs2", {}, "k8:r4:escape", "guided"),
      {
        case: "k8:b3:no-pair",
        when: { kind: "all" },
        target: "k8:r4:escape",
        interaction: "unverified",
        note: "No two interior-disjoint 6-holes sharing exactly one vertex exist after this B3: Observation 2 does not apply, nothing further is encoded.",
      },
    ],
    show: [{ kind: "region", expr: heptExpr, style: "neutral", label: "starting 7-hole" }],
    why: {
      headline: "Breaker's B3 is sorted by Observation 2.",
      claims: [
        { tier: "verified-geometry", text: "Exact enumeration decides whether two 6-holes with disjoint interiors share exactly one vertex after B3 (Observation 2's shape), or a 7-hole already exists." },
        { tier: "strategy-rule", text: "With a vertex-sharing pair, A4 extends both at once; with an existing 7-hole Maker extends it." },
        { tier: "theorem-cited", text: "Das–Valla Observation 2: after B3 two 6-holes share exactly one vertex.", ref: PAPER },
      ],
      threats: [
        { tier: "uncovered", text: "A B3 after which no such pair exists is not encoded; the session ends as uncovered." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r3:extend": extend7(
    "k8:r3:extend",
    "A4",
    "B3 left a 7-hole: extended.",
    "A 7-hole exists after B3, so it is extended to an 8-hole at once.",
  ),
  "k8:r4:escape": {
    id: "k8:r4:escape",
    role: "maker-move",
    next: "k8:r4:sevens",
    placeBind: "A4",
    move: { kind: "double-extend", holeSize: 6 },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:two-sevens",
        args: { A4: { kind: "points", of: [{ kind: "anchor", v: "A4" }] } },
        describe: "After A4 two 7-holes through A4 have disjoint interiors.",
      },
    ],
    show: [{ kind: "region", expr: heptExpr, style: "neutral", label: "starting 7-hole" }],
    why: {
      headline: "A4 extends both 6-holes at their common vertex.",
      claims: [
        { tier: "verified-geometry", text: "A4 placed; k8-inv:two-sevens confirmed two 7-holes through A4 with disjoint interiors." },
        { tier: "strategy-rule", text: "Near the vertex the two 6-holes share, along the sums of their neighbour edge vectors, accepting only a point extending both to exact 7-holes with disjoint interiors." },
        { tier: "theorem-cited", text: "Das–Valla Figure 5: A4 extends both 6-holes into two disjoint 7-holes.", ref: PAPER },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r4:sevens": {
    id: "k8:r4:sevens",
    role: "computed-step",
    next: "k8:r4:classify",
    compute: {
      kind: "select-disjoint-holes",
      holeSize: 7,
      anchorVar: "A4",
      binds: { holeA: "sevA", holeB: "sevB" },
    },
    post: [
      {
        kind: "custom",
        checkerId: "k8-inv:sevenpair",
        args: { holeA: { kind: "var", v: "sevA" }, holeB: { kind: "var", v: "sevB" } },
        describe: "The bound pair sevA/sevB are 7-holes with disjoint interiors.",
      },
    ],
    show: [{ kind: "region", expr: heptExpr, style: "neutral", label: "starting 7-hole" }],
    why: {
      headline: "The two disjoint 7-holes bound.",
      claims: [
        { tier: "strategy-rule", text: "Canonical pair of 7-holes through A4 with disjoint interiors." },
        { tier: "verified-geometry", text: "Re-asserted by k8-inv:sevenpair." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r4:classify": {
    id: "k8:r4:classify",
    role: "classify-breaker",
    routes: [
      route("k8:b4:inside-seven-A", "inside-seven-A", "classifyB4Sevens", { holeA: { kind: "var", v: "sevA" }, holeB: { kind: "var", v: "sevB" } }, "k8:r5:extend", "interactive"),
      route("k8:b4:inside-seven-B", "inside-seven-B", "classifyB4Sevens", { holeA: { kind: "var", v: "sevA" }, holeB: { kind: "var", v: "sevB" } }, "k8:r5:extend", "interactive"),
      { case: "k8:b4:elsewhere", when: { kind: "all" }, target: "k8:r5:extend", interaction: "interactive" },
    ],
    post: [{ kind: "exists-k-hole", k: 7 }],
    show: [
      { kind: "region", expr: hullVar("sevA"), style: "candidate", label: "7-hole A" },
      { kind: "region", expr: hullVar("sevB"), style: "candidate", label: "7-hole B" },
      { kind: "case-map" },
    ],
    why: {
      headline: "B4 can kill at most one of the two disjoint 7-holes.",
      claims: [
        { tier: "verified-geometry", text: "The two bound 7-holes have disjoint interiors, so a single B4 lies in at most one of them." },
        { tier: "strategy-rule", text: "Whichever 7-hole survives is extended to the 8-hole." },
      ],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
  "k8:r5:extend": extend7(
    "k8:r5:extend",
    "A5",
    "A5 extends the surviving 7-hole to the 8-hole.",
    "One of the two disjoint 7-holes survives B4; it is extended by the generic extension principle.",
  ),
  [NEXT_WIN]: {
    id: NEXT_WIN,
    role: "terminal",
    show: [{ kind: "highlight-hole", pattern: "winning" }],
    why: {
      headline: "8-hole achieved: game over.",
      claims: [{ tier: "verified-geometry", text: "Witness computed by exact enumeration." }],
      sourceRef: PAPER,
    },
    sourceRef: PAPER,
  },
};

export const esmbK8: StrategyDef = {
  id: "esmb-k8",
  k: 8,
  version: "1.0.0",
  domain: {
    coverage: "partial",
    note: "Guided walkthrough: only response classes marked interactive/guided are encoded; every other class ends as an honest uncovered terminal.",
  },
  source: {
    paper: PAPER,
    stepMap: {
      "k8:boot": "To play optimally, Bob places B0 inside the 7-hole.",
      "k8:pairing": "We begin with a similar approach as Lemma 8 that there are 7 chords in a 7-hole such that each divides the hole into one 5-hole and one 4-hole.",
      "k8:r1:escape": "After the placement of B0, Alice can place A1 in such a way that there are two 6-holes in the plane intersecting in one triangle.",
      "k8:r1:twins": "Figure 3 (left) twin witnesses (structural binding step).",
      "k8:r1:classify": "After the placement of B1, there are two 6-holes in the plane sharing exactly one common edge (Observation 1).",
      "k8:r2:ears": "Replacement holes after B1 (derived: ear replacement).",
      "k8:r2:escape": "Alice can place A2 in such a way that it creates two 6-holes and one 7-hole (Observation 1).",
      "k8:r2:x": "The 7-hole X (structural binding step).",
      "k8:r2:classify": "Now Bob must place B2 inside the 7-hole to prevent Alice from winning in the immediate next round.",
      "k8:r2:extend": "Outside X the 7-hole survives and is extended (derived).",
      "k8:r3:escape": "To force such placement of B3, Alice places A3 in such a way that there are two 6-holes intersecting in one triangle (Observation 2).",
      "k8:r3:classify": "After the placement of B3, there are two 6-holes in the plane sharing exactly one vertex (Observation 2).",
      "k8:r3:extend": "A 7-hole after B3 is extended (derived).",
      "k8:r4:escape": "Alice extends both 6-holes to two disjoint 7-holes by placing A4 accordingly.",
      "k8:r4:sevens": "Two disjoint 7-holes (structural binding step).",
      "k8:r4:classify": "Bob can kill at most one of two disjoint 7-holes (derived).",
      "k8:r5:extend": "...ensuring the formation of an 8-hole in the next round.",
      "k8:immediate": "Outside the heptagon the 7-hole survives and is extended at once (derived).",
      "k8:win": "From a 7-hole, an 8-hole within the next five rounds.",
    },
  },
  entry: "k8:boot",
  startVars: ["P7", "V0", "V1", "V2", "V3", "V4", "V5", "V6"],
  nodes,
};
