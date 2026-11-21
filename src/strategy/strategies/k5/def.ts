// strategy/strategies/k5/def.ts — the esmb-k5 core strategy
// (Das–Valla Lemma 6 [SRC: CGT 5(2), p. 3:3]; [DES] conventions per §23).
// Node ids are the literal §23 ids. Status is derived (validated-randomized
// until the §23.8 cell check passes — Gate C); nothing here asserts it.
import { Rat } from "../../../geometry/rat.ts";
import type { PtExpr, StrategyDef } from "../../types.ts";

const I = (x: number, y: number): PtExpr => ({
  kind: "const",
  x: Rat.make(BigInt(x)),
  y: Rat.make(BigInt(y)),
});

const PAPER = "Das–Valla 2026, Lemma 6 (CGT 5(2), pp. 3:3)";

export const esmbK5: StrategyDef = {
  id: "esmb-k5",
  k: 5,
  version: "1.0.0",
  source: {
    paper: PAPER,
    stepMap: {
      "k5:entry": "R1: Alice places A1 (arbitrary).",
      "k5:await-b1": "R1: Bob places B1 (arbitrary, general position).",
      "k5:r2:a2":
        'R2: Alice places A2 "in a non-collinear position with A1 and B1".',
      "k5:r2:classify":
        'R2 (Bob, forced): "Bob must place a point that is not in a convex position with the other three".',
      "k5:blunder":
        "Four in convex position form an empty 4-gon; the generic extension principle (§1) grows it.",
      "k5:r3:co-shoulder":
        'R3: "Alice places A3 in such a way that she creates one or more 4-holes."',
      "k5:r3:classify":
        'R3 (Bob): "one 4-hole remains in the plane irrespective of the placement of B3."',
      "k5:r4:extend":
        'R4: "Alice extends it to a 5-hole by placing A4 accordingly."',
      "k5:win": "7 points, Maker wins in round 4.",
    },
  },
  entry: "k5:entry",
  nodes: {
    "k5:entry": {
      id: "k5:entry",
      role: "maker-move",
      next: "k5:await-b1",
      placeBind: "A1",
      move: { kind: "fixed", at: [I(0, 0)] },
      show: [
        {
          kind: "region",
          expr: { kind: "window" },
          style: "neutral",
          label: "play window",
        },
      ],
      why: {
        headline: "Maker anchors A1 at the origin.",
        claims: [
          {
            tier: "strategy-rule",
            text: "Lemma 6 leaves the first placement open; the encoding pins A1 to (0,0) so replays match.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:await-b1": {
      id: "k5:await-b1",
      role: "classify-breaker",
      routes: [
        {
          case: "k5:any",
          when: { kind: "all" },
          target: "k5:r2:a2",
          bind: { B1: { kind: "last" } },
        },
      ],
      show: [],
      why: {
        headline: "Breaker replies anywhere legal.",
        claims: [
          {
            tier: "strategy-rule",
            text: "Lemma 6 puts no constraint on B1; every legal reply parks here.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:r2:a2": {
      id: "k5:r2:a2",
      role: "maker-move",
      next: "k5:r2:classify",
      placeBind: "A2",
      move: {
        kind: "fixed",
        at: [I(20, 28), I(28, 20), I(-20, 28), I(28, -20), I(13, 31), I(31, 13)],
      },
      post: [{ kind: "exists-k-hole", k: 3 }],
      show: [
        {
          kind: "poly-line",
          of: [
            { kind: "anchor", v: "A1" },
            { kind: "anchor", v: "B1" },
          ],
          style: "reference",
        },
      ],
      why: {
        headline: "Maker forms the opening triangle.",
        claims: [
          {
            tier: "verified-geometry",
            text: "A2 is the first candidate off the A1–B1 line, so {A1,B1,A2} is a 3-hole.",
          },
          {
            tier: "strategy-rule",
            text: "Ordered fixed candidates keep the view stable; at most one is ever blocked.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:r2:classify": {
      id: "k5:r2:classify",
      role: "classify-breaker",
      routes: [
        {
          case: "k5:b2:convex",
          when: {
            kind: "classifier",
            classifierId: "classifyFour",
            inputs: { pts: { kind: "last-n", n: 4 } },
            on: { tag: "convex" },
          },
          target: "k5:blunder",
        },
        {
          case: "k5:b2:one-interior",
          when: {
            kind: "classifier",
            classifierId: "classifyFour",
            inputs: { pts: { kind: "last-n", n: 4 } },
            on: { tag: "one-interior" },
          },
          target: "k5:r3:co-shoulder",
          bind: {
            outer: { kind: "result", field: "outer" },
            interior: { kind: "result", field: "interior" },
          },
        },
        {
          // Dead by the four-point theorem (classifyFour is total over GP
          // states): G7 mandates a trailing catch-all. No binds ⇒ the
          // co-shoulder move fails fail-closed (integrity) if ever reached.
          case: "k5:b2:else",
          when: { kind: "all" },
          target: "k5:r3:co-shoulder",
        },
      ],
      show: [{ kind: "case-map" }],
      why: {
        headline: "Four points: blunder or one point swallowed.",
        claims: [
          {
            tier: "verified-geometry",
            text: "Hull arithmetic sorts the four points into convex position or exactly one interior point.",
          },
          {
            tier: "strategy-rule",
            text: "Swallow wedges count as safe: ownership of the interior point is irrelevant.",
          },
        ],
        threats: [
          {
            tier: "strategy-rule",
            text: "A convex four-set hands Maker a 4-hole at once.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:blunder": {
      id: "k5:blunder",
      role: "maker-move",
      next: "k5:win",
      placeBind: "A3",
      move: {
        kind: "extend",
        hole: { kind: "enumerate", k: 4 },
        prefer: "farthest-clearance",
      },
      post: [{ kind: "exists-k-hole", k: 5 }],
      show: [{ kind: "highlight-hole", pattern: "intended" }],
      why: {
        headline: "Four in convex position: Maker grows to five.",
        claims: [
          {
            tier: "verified-geometry",
            text: "The convex four-set is a 4-hole; the growth move adds a fifth vertex.",
          },
          {
            tier: "theorem-cited",
            text: "Das–Valla Lemma 6 generic extension step.",
            ref: PAPER,
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:r3:co-shoulder": {
      id: "k5:r3:co-shoulder",
      role: "maker-move",
      next: "k5:r3:classify",
      placeBind: "A3",
      move: {
        kind: "co-shoulder",
        outer: { kind: "var", v: "outer" },
        interior: "interior",
      },
      pre: [{ kind: "config-class", cls: "one-interior" }],
      post: [
        {
          kind: "custom",
          checkerId: "k5-inv:trapezoid",
          args: {
            outer: { kind: "var", v: "outer" },
            interior: { kind: "points", of: [{ kind: "anchor", v: "interior" }] },
            A3: { kind: "points", of: [{ kind: "anchor", v: "A3" }] },
          },
          describe:
            "The intended 4-hole {u,v,interior,A3} exists — u,v = the outer edge farthest from interior (§23.3 item 1's selection, recomputed identically by the checker, §23.3a).",
        },
      ],
      show: [
        { kind: "highlight-hole", pattern: "intended" },
        { kind: "case-map" },
      ],
      why: {
        headline: "The co-shoulder trapezoid.",
        claims: [
          {
            tier: "verified-geometry",
            text: "A3 placed; the intended 4-hole {u,v,interior,A3} passed its check.",
          },
          {
            tier: "strategy-rule",
            text: "Co-shoulder along the farthest outer edge: the encoded form of placing A3 so that 4-holes appear.",
          },
        ],
        invariantNotes: [
          {
            tier: "verified-geometry",
            text: "k5-inv:trapezoid names the checked 4-hole.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:r3:classify": {
      id: "k5:r3:classify",
      role: "classify-breaker",
      routes: [
        {
          case: "k5:b3:blocked-intended",
          when: {
            kind: "classifier",
            classifierId: "classifyB3",
            on: { tag: "blocked-intended" },
          },
          target: "k5:r4:extend",
        },
        {
          case: "k5:b3:else",
          when: { kind: "all" },
          target: "k5:r4:extend",
        },
      ],
      post: [{ kind: "exists-k-hole", k: 4 }],
      show: [
        { kind: "highlight-hole", pattern: "survivors" },
        { kind: "case-map" },
      ],
      why: {
        headline: "One 4-hole stands after B3.",
        claims: [
          {
            tier: "verified-geometry",
            text: "An exact count after every B3 backs the parked invariant.",
          },
          {
            tier: "strategy-rule",
            text: "Inside the intended hole, B3 turns into a vertex of a replacement hole.",
          },
        ],
        sourceRef: PAPER,
      },
      sourceRef: PAPER,
    },
    "k5:r4:extend": {
      id: "k5:r4:extend",
      role: "maker-move",
      next: "k5:win",
      placeBind: "A4",
      move: {
        kind: "extend",
        hole: { kind: "enumerate", k: 4 },
        prefer: "largest-interval",
      },
      post: [{ kind: "exists-k-hole", k: 5 }],
      show: [{ kind: "highlight-hole", pattern: "survivors" }],
      why: {
        headline: "The surviving 4-hole grows to five.",
        claims: [
          {
            tier: "verified-geometry",
            text: "A4 extends an enumerated 4-hole; the 5-hole check passed.",
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
    "k5:win": {
      id: "k5:win",
      role: "terminal",
      show: [{ kind: "highlight-hole", pattern: "winning" }],
      why: {
        headline: "5-hole achieved: game over.",
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
