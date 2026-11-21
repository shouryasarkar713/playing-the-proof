// strategy/strategies/fixtureTriangle.ts — the [FIX] pipeline fixture
// (§6.7): trivial k=3 lemma (Maker wins in round 2). Labeled [FIX] in the
// picker (dev/demo only); never an ESMB claim. Validates the full pipeline
// (runtime, routing, invariants, explanation, overlays, replay) on a proof
// small enough to verify by eye.
import { Rat } from "../../geometry/rat.ts";
import type { Rat as RatType } from "../../geometry/rat.ts";
import type { StrategyDef } from "../types.ts";

const half = (n: bigint): RatType => Rat.make(n, 2n);

export const fixtureTriangle: StrategyDef = {
  id: "fixture-triangle",
  k: 3,
  version: "1.0.0",
  source: { paper: "none — pipeline fixture", stepMap: {} },
  entry: "entry",
  nodes: {
    entry: {
      id: "entry",
      role: "maker-move",
      next: "await-b1",
      placeBind: "A1",
      move: {
        kind: "fixed",
        at: [{ kind: "const", x: Rat.make(0n), y: Rat.make(0n) }],
      },
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
            text: "Opening move is arbitrary; the strategy fixes it for determinism.",
          },
        ],
        sourceRef: "fixture",
      },
      sourceRef: "fixture",
    },
    "await-b1": {
      id: "await-b1",
      role: "classify-breaker",
      routes: [
        {
          case: "fx:any",
          when: { kind: "all" },
          target: "after-b1",
          bind: { B1: { kind: "last" } },
        },
      ],
      show: [],
      why: {
        headline: "Maker waits for Bob's first point.",
        claims: [
          {
            tier: "strategy-rule",
            text: "Any legal B1 is acceptable; no classification needed.",
          },
        ],
        sourceRef: "fixture",
      },
      sourceRef: "fixture",
    },
    "after-b1": {
      id: "after-b1",
      role: "maker-move",
      next: "win",
      placeBind: "A2",
      move: {
        kind: "fixed",
        at: [
          { kind: "const", x: half(5n), y: half(7n) },
          { kind: "const", x: half(7n), y: half(5n) },
          { kind: "const", x: half(-5n), y: half(7n) },
        ],
      },
      post: [{ kind: "exists-k-hole", k: 3 }],
      show: [
        {
          kind: "region",
          expr: {
            kind: "halfplane",
            thru: [
              { kind: "anchor", v: "A1" },
              { kind: "anchor", v: "B1" },
            ],
            side: "left",
          },
          style: "candidate",
          label: "any GP point wins: {A1,B1,A2} is a 3-hole",
        },
      ],
      why: {
        headline: "Any non-collinear A2 completes an empty triangle with A1 and B1.",
        claims: [
          {
            tier: "verified-geometry",
            text: "orient(A1,B1,A2) ≠ 0 and no other points exist ⇒ 3-hole.",
          },
          {
            tier: "strategy-rule",
            text: "Ordered fixed candidates; the first legal one is placed.",
          },
        ],
        sourceRef: "fixture",
      },
      sourceRef: "fixture",
    },
    win: {
      id: "win",
      role: "terminal",
      show: [{ kind: "highlight-hole", pattern: "winning" }],
      why: {
        headline: "3-hole achieved: game over.",
        claims: [
          {
            tier: "verified-geometry",
            text: "witness computed by exact enumeration",
          },
        ],
        sourceRef: "fixture",
      },
      sourceRef: "fixture",
    },
  },
};
