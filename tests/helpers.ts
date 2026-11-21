// tests/helpers.ts — shared deterministic test scaffolding (no geometry
// here; tests may use numbers and seeded PRNGs freely).
import { Rat } from "../src/geometry/rat.ts";
import { hull } from "../src/geometry/hull.ts";
import type { Pt } from "../src/geometry/pt.ts";
import type {
  Configuration,
  GameState,
  Player,
} from "../src/game/types.ts";
import type { IdPt, KHole } from "../src/geometry/holes.ts";
import type { RuntimeCtx } from "../src/engine/orchestrator.ts";
import { classifiers, strategies } from "../src/strategy/registry.ts";
import { checkers } from "../src/verification/invariants.ts";

// Placement-order ids p1..pn (mirrors I1 — §5.2).
export function withIds(pts: readonly Pt[]): IdPt[] {
  return pts.map((pt, i) => ({ id: `p${i + 1}`, pt }));
}

// Append a point the way placement would (next placement-order id).
export function placeId(all: IdPt[], pt: Pt): IdPt[] {
  return [...all, { id: `p${all.length + 1}`, pt }];
}

// The id-list hole for a Pt member set (hull order), resolved by reference.
export function holeFor(all: IdPt[], member: Pt[]): KHole {
  const verts = hull(member).map((h) => {
    const idx = all.findIndex((p) => p.pt === h);
    if (idx < 0) {
      throw new Error("holeFor: member point has no id — test bug");
    }
    return (all[idx] as IdPt).id;
  });
  return { k: member.length, verts };
}

// A minimal sandbox GameState over literal points (game-layer isolation:
// no engine/session imports — states as pure data).
export function sandboxState(pts: readonly Pt[], k: 3 | 4 | 5 | 6 | 7 | 8 = 5): GameState {
  return {
    seq: 0,
    k,
    mode: "sandbox",
    points: pts.map((pt, i) => ({
      id: `p${i + 1}`,
      owner: (i % 2 === 0 ? "maker" : "breaker") as Player,
      pt,
      move: i + 1,
    })),
    turn: (pts.length % 2 === 0 ? "maker" : "breaker") as Player,
    terminal: null,
    strategy: null,
  };
}

export function testWindow(): Configuration["window"] {
  return {
    xMin: Rat.make(-1000000n),
    yMin: Rat.make(-1000000n),
    xMax: Rat.make(1000000n),
    yMax: Rat.make(1000000n),
  };
}

export function testConfig(budgetOps = 20000000): Configuration {
  return {
    window: testWindow(),
    ui: { minSeparationPx: 6, theme: "light", autoplayMs: 500 },
    engine: { maxPoints: 64 },
    analysis: { budgetOps },
  };
}

// testCtx wires the LIVE registry maps (single source — registration calls
// in tests populate the same objects the pipeline resolves).
export function testCtx(budgetOps = 20000000): RuntimeCtx {
  return {
    config: testConfig(budgetOps),
    strategies: strategies(),
    classifiers: classifiers(),
    checkers: checkers(),
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
