// tests/strategies/k7driver.ts — shared k=7 scaffolding: ensureK7, session
// helpers, random convex-hexagon generators (including near-degenerate and
// nearly-concurrent-diagonal ones), the exact cell-representative enumerator
// used by the Week-7 gate, and an INDEPENDENT oracle (bigint fractions, no
// src/geometry imports) for "a 7-hole exists after A2".
import { arrangementCells } from "../../src/geometry/arrangement.ts";
import { canonicalInteriorPoint } from "../../src/geometry/poly.ts";
import type { ConvexPoly } from "../../src/geometry/poly.ts";
import { hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import type { GameState, StrategyStart } from "../../src/game/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import type { RuntimeCtx } from "../../src/engine/orchestrator.ts";
import {
  classifyFour,
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { getChecker, registerChecker } from "../../src/verification/invariants.ts";
import { esmbK7 } from "../../src/strategy/strategies/k7/def.ts";
import { classifyB1Hex } from "../../src/strategy/strategies/k7/classifyB1.ts";
import {
  pair5Checker,
  twinPair6Checker,
  twins6Checker,
} from "../../src/verification/k7twins.ts";
import { testCtx } from "../helpers.ts";

export function ensureK7(): void {
  if (getClassifier(classifyFour.id) === undefined) {
    registerClassifier(classifyFour);
  }
  if (getClassifier(classifyB1Hex.id) === undefined) {
    registerClassifier(classifyB1Hex);
  }
  for (const c of [pair5Checker, twins6Checker, twinPair6Checker]) {
    if (getChecker(c.id) === undefined) {
      registerChecker(c);
    }
  }
  if (!strategies().has(esmbK7.id)) {
    registerStrategy(esmbK7, "core");
  }
}

ensureK7();

export const rat = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));
export function P(x: number, y: number): Pt {
  return pt(rat(x), rat(y));
}
export function PQ(xn: number, xd: number, yn: number, yd: number): Pt {
  return pt(rat(xn, xd), rat(yn, yd));
}

export interface K7Session {
  store: Store;
  ctx: RuntimeCtx;
}

export function startK7(
  start?: StrategyStart,
  ctx: RuntimeCtx = testCtx(),
): K7Session & { status: string } {
  const store = new Store();
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId: "esmb-k7",
      mode: "break",
      ...(start === undefined ? {} : { strategyStart: start }),
    },
    ctx,
    store,
  );
  return { store, ctx, status: started.status };
}

export function placeBreaker(sess: K7Session, at: Pt): void {
  const r = reduceTransaction(
    sess.store.current(),
    { kind: "place", owner: "breaker", at },
    sess.ctx,
  );
  if (r.status !== "accepted" || r.nextState === undefined) {
    throw new Error("placeBreaker: rejected — test bug");
  }
  commit(r, { kind: "place", owner: "breaker", at }, sess.store, sess.ctx);
}

export function legalAt(sess: K7Session, at: Pt): boolean {
  return (
    checkPlacement(sess.store.current(), at, sess.ctx.config.window) === null
  );
}

export function suppliedHex(hex: readonly Pt[], extras: readonly Pt[] = []): StrategyStart {
  return {
    kind: "supplied",
    points: [...hex, ...extras],
    selectedHole: [...hex],
  };
}

export function varsOf(state: GameState): Readonly<Record<string, unknown>> {
  return (state.strategy?.vars ?? {}) as Readonly<Record<string, unknown>>;
}

export function ptById(state: GameState, id: string): Pt {
  const p = state.points.find((q) => q.id === id);
  if (p === undefined) {
    throw new Error(`ptById: ${id}`);
  }
  return p.pt;
}

// ---- random hexagons ----

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gpAll(pts: readonly Pt[]): boolean {
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      for (let k = j + 1; k < pts.length; k += 1) {
        if (orient(pts[i] as Pt, pts[j] as Pt, pts[k] as Pt) === 0) {
          return false;
        }
      }
    }
  }
  return true;
}

// Random convex hexagon with small integer or rational coordinates.
export function randomHexagon(rand: () => number, scale = 40, den = 1): Pt[] {
  for (let t = 0; t < 2000; t += 1) {
    const cand: Pt[] = [];
    for (let i = 0; i < 6; i += 1) {
      cand.push(
        PQ(
          Math.floor((rand() * 2 - 1) * scale * den),
          den,
          Math.floor((rand() * 2 - 1) * scale * den),
          den,
        ),
      );
    }
    const h = hull(cand);
    if (h.length === 6 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("randomHexagon: none found");
}

// Nearly regular hexagon with the three main chords nearly concurrent: a
// regular-like hexagon (scaled integer lattice points on a circle-ish ring)
// perturbed by `eps`/`den`. Chords are exactly concurrent for eps = 0 (which
// is not GP-safe for some constructions), so eps > 0 gives tiny central
// triangles of either orientation.
export function nearlyConcurrentHexagon(
  rand: () => number,
  big = 1000,
  eps = 1,
): Pt[] {
  for (let t = 0; t < 2000; t += 1) {
    // Hexagon with vertices on the "hex lattice": (±2,0),(±1,±sqrt3) scaled —
    // use the integer approximation (±2R,0),(±R,±(7R/4)) perturbed.
    const R = big;
    const base: Array<[number, number]> = [
      [2 * R, 0],
      [R, Math.round(1.75 * R)],
      [-R, Math.round(1.75 * R)],
      [-2 * R, 0],
      [-R, -Math.round(1.75 * R)],
      [R, -Math.round(1.75 * R)],
    ];
    const cand = base.map(([x, y]) =>
      P(
        x + Math.floor((rand() * 2 - 1) * (eps + 1)),
        y + Math.floor((rand() * 2 - 1) * (eps + 1)),
      ),
    );
    const h = hull(cand);
    if (h.length === 6 && gpAll(h)) {
      return h;
    }
  }
  throw new Error("nearlyConcurrentHexagon: none found");
}

// A random rational point strictly inside the (convex, CCW) polygon.
export function randomInside(poly: readonly Pt[], rand: () => number): Pt {
  const w = poly.map(() => rand() + 0.01);
  const s = w.reduce((a, b) => a + b, 0);
  let x = rat(0);
  let y = rat(0);
  for (let i = 0; i < poly.length; i += 1) {
    const wi = rat(Math.floor((w[i] as number / s) * 1000000), 1000000);
    x = x.add((poly[i] as Pt).x.mul(wi));
    y = y.add((poly[i] as Pt).y.mul(wi));
  }
  // Normalise by the weight sum to land exactly in the hull.
  let tot = rat(0);
  for (let i = 0; i < poly.length; i += 1) {
    tot = tot.add(rat(Math.floor((w[i] as number / s) * 1000000), 1000000));
  }
  return pt(x.div(tot), y.div(tot));
}

// ---- exact cell-representative enumerator ----

// All cells of the arrangement of the lines through every pair of the given
// points, restricted to `window`; one exact interior representative per cell
// (canonicalInteriorPoint). Also reports the cell polygons.
export function cellRepresentatives(
  pts: readonly Pt[],
  window: ConvexPoly,
): Array<{ cell: ConvexPoly; rep: Pt }> {
  const lines: Array<{ a: Pt; b: Pt }> = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      lines.push({ a: pts[i] as Pt, b: pts[j] as Pt });
    }
  }
  const cells = arrangementCells(lines, window);
  const out: Array<{ cell: ConvexPoly; rep: Pt }> = [];
  for (const cell of cells) {
    const rep = canonicalInteriorPoint(cell);
    if (rep !== null) {
      out.push({ cell, rep });
    }
  }
  return out;
}

export function windowOf(ctx: RuntimeCtx): ConvexPoly {
  const w = ctx.config.window;
  return [
    pt(w.xMin, w.yMin),
    pt(w.xMax, w.yMin),
    pt(w.xMax, w.yMax),
    pt(w.xMin, w.yMax),
  ];
}

