// tests/strategies/k6driver.ts — shared k=6 scaffolding (§24.7): ensureK6,
// the forced-region computer (test-side port of the prototype), barycentric
// samplers, bootstrap builders, and the seeded game drivers.
import { clipConvexByHalfPlane } from "../../src/geometry/poly.ts";
import { convexPosition, hull } from "../../src/geometry/hull.ts";
import { orient } from "../../src/geometry/predicates.ts";
import { findKHoles } from "../../src/geometry/holes.ts";
import { pt } from "../../src/geometry/pt.ts";
import type { Pt } from "../../src/geometry/pt.ts";
import { Rat } from "../../src/geometry/rat.ts";
import { checkPlacement } from "../../src/game/legality.ts";
import type { GameState } from "../../src/game/types.ts";
import type { StrategyStart } from "../../src/game/types.ts";
import { commit, startSession } from "../../src/session/commit.ts";
import { Store } from "../../src/session/store.ts";
import { reduceTransaction } from "../../src/engine/orchestrator.ts";
import {
  classifyFour,
  getClassifier,
  registerClassifier,
  registerStrategy,
  strategies,
} from "../../src/strategy/registry.ts";
import { getChecker, registerChecker } from "../../src/verification/invariants.ts";
import { esmbK6 } from "../../src/strategy/strategies/k6/def.ts";
import { esmbK6Wide } from "../../src/strategy/strategies/k6/wide.ts";
import { classifyB1 } from "../../src/strategy/strategies/k6/classifyB1.ts";
import { classifyB3 } from "../../src/strategy/strategies/k5/classifyB3.ts";
import { trapezoidChecker } from "../../src/verification/trapezoid.ts";
import { twinPairChecker, twinsChecker } from "../../src/verification/k6twins.ts";
import { mulberry32, testCtx } from "../helpers.ts";

// Idempotent: the live maps are shared across test files in a worker.
export function ensureK6(): void {
  if (getClassifier(classifyFour.id) === undefined) {
    registerClassifier(classifyFour);
  }
  if (getClassifier(classifyB3.id) === undefined) {
    registerClassifier(classifyB3);
  }
  if (getClassifier(classifyB1.id) === undefined) {
    registerClassifier(classifyB1);
  }
  if (getChecker(trapezoidChecker.id) === undefined) {
    registerChecker(trapezoidChecker);
  }
  if (getChecker(twinsChecker.id) === undefined) {
    registerChecker(twinsChecker);
  }
  if (getChecker(twinPairChecker.id) === undefined) {
    registerChecker(twinPairChecker);
  }
  if (!strategies().has(esmbK6.id)) {
    registerStrategy(esmbK6, "core");
  }
  if (!strategies().has(esmbK6Wide.id)) {
    registerStrategy(esmbK6Wide, "experimental-extension");
  }
}

ensureK6();

export const rat = (n: number, d = 1): Rat => Rat.make(BigInt(n), BigInt(d));

export function P(x: number, y: number): Pt {
  return pt(rat(x), rat(y));
}

// forcedRegion: intersection of the five chord-4-holes of a convex
// pentagon (CCW hull), by exact half-plane clipping — the test-side twin
// of the boot route's intersect-of-hulls construction (item 1 cross-check).
export function forcedRegion(pent: readonly Pt[]): Pt[] {
  const hp = hull([...pent]);
  if (hp.length !== 5) {
    throw new Error("forcedRegion: not a convex pentagon — test bug");
  }
  let poly = [...hp];
  const n = hp.length;
  for (let i = 0; i < n; i += 1) {
    const a = hp[i] as Pt;
    const c = hp[(i + 2) % n] as Pt;
    const keep = hp[(i + 4) % n] as Pt;
    poly = clipConvexByHalfPlane(poly, a, c, orient(a, c, keep) > 0);
    if (poly.length === 0) {
      return [];
    }
  }
  return poly;
}

export function centroidOf(verts: readonly Pt[]): Pt {
  let sx = rat(0);
  let sy = rat(0);
  for (const v of verts) {
    sx = sx.add(v.x);
    sy = sy.add(v.y);
  }
  const n = rat(verts.length);
  return pt(sx.div(n), sy.div(n));
}

// Strictly inside a CCW convex polygon (hull-verified).
export function insideStrict(poly: readonly Pt[], q: Pt): boolean {
  const h = hull([...poly]);
  if (h.length !== poly.length) {
    return false;
  }
  for (let i = 0; i < h.length; i += 1) {
    if (orient(h[i] as Pt, h[(i + 1) % h.length] as Pt, q) <= 0) {
      return false;
    }
  }
  return true;
}

// Inside-or-on a CCW convex polygon (hull-verified).
export function onHull(poly: readonly Pt[], q: Pt): boolean {
  const h = hull([...poly]);
  if (h.length !== poly.length) {
    return false;
  }
  for (let i = 0; i < h.length; i += 1) {
    if (orient(h[i] as Pt, h[(i + 1) % h.length] as Pt, q) < 0) {
      return false;
    }
  }
  return true;
}

// Random interior point (barycentric, deterministic stream) — GP/legality
// screened by the caller.
export function baryInside(poly: readonly Pt[], rand: () => number): Pt {
  const w = poly.map(() => Math.floor(rand() * 12) + 1);
  const s = w.reduce((a, b) => a + b, 0);
  let x = rat(0);
  let y = rat(0);
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i] as Pt;
    x = x.add(p.x.mul(rat(w[i] as number)).div(rat(s)));
    y = y.add(p.y.mul(rat(w[i] as number)).div(rat(s)));
  }
  return pt(x, y);
}

export function intPt(rand: () => number, lo: number, hi: number): Pt {
  const span = hi - lo + 1;
  return P(Math.floor(rand() * span) + lo, Math.floor(rand() * span) + lo);
}

// A random convex pentagon in the box (rejection-sampled, bounded).
export function randomPentagon(rand: () => number): Pt[] {
  for (let t = 0; t < 500; t += 1) {
    const cand = [intPt(rand, -40, 40), intPt(rand, -40, 40), intPt(rand, -40, 40), intPt(rand, -40, 40), intPt(rand, -40, 40)];
    if (convexPosition(cand)) {
      return cand;
    }
  }
  throw new Error("randomPentagon: no convex pentagon in 500 tries");
}

// Supplied bootstrap: a bare random convex pentagon (5 points, odd).
// This mirrors the prototype's validated domain exactly (§2.6: 800 forced
// + 800 anywhere-inside games from bare 5-point sets). Richer 7-point
// continue-style bootstraps get single-game coverage (routing pack,
// promotion tests); scaled 7-point driving is NOT claimed until the
// convention's pair-robustness on extra-point sets is characterized.
export function suppliedFive(rand: () => number): StrategyStart {
  const pent = randomPentagon(rand);
  return { kind: "supplied", points: pent, selectedHole: [...pent] };
}

// Supplied bootstrap: pentagon + two exterior extras (7 points, odd).
// The pentagon stays empty (extras exterior); extras resample on 6-hole.
export function suppliedSeven(rand: () => number): StrategyStart {
  for (let t = 0; t < 200; t += 1) {
    const pent = randomPentagon(rand);
    const hp = hull([...pent]);
    const extras: Pt[] = [];
    for (let k = 0; k < 60 && extras.length < 2; k += 1) {
      const cand = intPt(rand, -60, 60);
      const trial = [...pent, ...extras, cand];
      // Exterior to the pentagon hull + GP so far.
      let outside = false;
      for (let i = 0; i < hp.length; i += 1) {
        if (orient(hp[i] as Pt, hp[(i + 1) % hp.length] as Pt, cand) < 0) {
          outside = true;
          break;
        }
      }
      if (!outside) {
        continue;
      }
      let gpOk = true;
      for (let i = 0; i < trial.length && gpOk; i += 1) {
        for (let j = i + 1; j < trial.length && gpOk; j += 1) {
          for (let k2 = j + 1; k2 < trial.length; k2 += 1) {
            if (orient(trial[i] as Pt, trial[j] as Pt, trial[k2] as Pt) === 0) {
              gpOk = false;
              break;
            }
          }
        }
      }
      if (gpOk) {
        extras.push(cand);
      }
    }
    if (extras.length < 2) {
      continue;
    }
    const pts = [...pent, ...extras];
    // No 6-hole (else P3 ends the session before B0).
    const idpts = pts.map((p, i) => ({ id: `t${i + 1}`, pt: p }));
    const sixes = findKHoles(idpts, 6, { mode: "exhaustive", budget: 20000000 });
    if (sixes.kind === "exhaustive" && sixes.holes.length === 0) {
      return { kind: "supplied", points: pts, selectedHole: [...pent] };
    }
  }
  throw new Error("suppliedSeven: no clean bootstrap in 200 tries");
}

export interface K6GameResult {
  won: boolean;
  terminalKind: string | null;
  points: number;
  nodeId: string | null;
  cases: readonly (string | null)[];
  boot: readonly Pt[];
  integrity: { at: string; id: string } | null;
}

// One full k6 game through the real pipeline. b0mode selects the boot
// route under test; b1mode the B1 sampling. Per-game structural assertions
// live in the test files (vars, twins); the driver records the outcome.
export function playK6Game(
  seedRand: () => number,
  b0mode: "forced" | "outside" | "ear",
  b1mode: "random" | "targeted",
  strategyId = "esmb-k6",
): K6GameResult {
  const store = new Store();
  const ctx = testCtx();
  const boot = suppliedFive(seedRand);
  if (boot.kind !== "supplied") {
    throw new Error("unreachable");
  }
  const started = startSession(
    {
      kind: "guided",
      config: { mode: "break", window: ctx.config.window },
      strategyId,
      mode: "break",
      strategyStart: boot,
    },
    ctx,
    store,
  );
  if (started.status !== "accepted") {
    throw new Error("playK6Game: bootstrap rejected — test bug");
  }
  if (store.current().terminal !== null) {
    throw new Error("playK6Game: P3-terminal bootstrap resample missed — test bug");
  }
  const cases: (string | null)[] = [];
  const bootPts: Pt[] = boot.kind === "supplied" ? [...boot.points] : [];
  const place = (at: Pt): void => {
    const r = reduceTransaction(
      store.current(),
      { kind: "place", owner: "breaker", at },
      ctx,
    );
    if (r.status !== "accepted" || r.nextState === undefined) {
      throw new Error("playK6Game: breaker placement rejected — test bug");
    }
    commit(r, { kind: "place", owner: "breaker", at }, store, ctx);
    cases.push(store.current().strategy?.lastCase ?? null);
  };
  const cur = (): GameState => store.current();
  const legal = (at: Pt): boolean =>
    checkPlacement(cur(), at, ctx.config.window) === null;
  // B0 by mode.
  const p5ids = cur().strategy?.vars["P5"] as string[];
  const byId = new Map(cur().points.map((p) => [p.id, p.pt]));
  const p5 = p5ids.map((id) => byId.get(id) as Pt);
  if (b0mode === "forced") {
    const fr = forcedRegion(p5);
    if (fr.length < 3) {
      throw new Error("playK6Game: empty forced region — test bug");
    }
    const cands = [centroidOf(fr), baryInside(fr, seedRand), baryInside(fr, seedRand)];
    let placed = false;
    for (const c of cands) {
      if (legal(c)) {
        place(c);
        placed = true;
        break;
      }
    }
    if (!placed) {
      throw new Error("playK6Game: no legal forced B0");
    }
  } else if (b0mode === "outside") {
    for (let t = 0; t < 500; t += 1) {
      const cand = intPt(seedRand, -60, 60);
      if (!legal(cand)) {
        continue;
      }
      const hp = hull([...p5]);
      let inside = true;
      for (let i = 0; i < hp.length; i += 1) {
        if (orient(hp[i] as Pt, hp[(i + 1) % hp.length] as Pt, cand) < 0) {
          inside = false;
          break;
        }
      }
      if (!inside) {
        place(cand);
        break;
      }
      if (t === 499) {
        throw new Error("playK6Game: no exterior B0");
      }
    }
  } else {
    // Ear: centroid of an ear triangle (v_{i-1}, v_i, v_{i+1}) in P5
    // order — strictly inside the ear, hence inside the pentagon but
    // outside the forced region. Tries all five ears (a centroid can land
    // exactly on a placed-pair line).
    const order = p5;
    const ei = Math.floor(seedRand() * 5);
    let placedEar = false;
    for (let k = 0; k < 5 && !placedEar; k += 1) {
      const vi = (ei + k) % 5;
      const earTri = [
        order[(vi + 4) % 5] as Pt,
        order[vi] as Pt,
        order[(vi + 1) % 5] as Pt,
      ];
      const c = centroidOf(earTri);
      if (legal(c)) {
        place(c);
        placedEar = true;
      }
    }
    if (!placedEar) {
      throw new Error("playK6Game: no legal ear B0");
    }
  }
  if (cur().terminal !== null) {
    return finish(cur(), cases, bootPts);
  }
  // B1: random legal, or targeted inside a post-A1 5-hole.
  if (b1mode === "random") {
    for (let t = 0; t < 500; t += 1) {
      const cand = intPt(seedRand, -60, 60);
      if (legal(cand)) {
        place(cand);
        break;
      }
      if (t === 499) {
        throw new Error("playK6Game: no legal B1");
      }
    }
  } else {
    const fives = findKHoles(
      cur().points.map((p) => ({ id: p.id, pt: p.pt })),
      5,
      { mode: "exhaustive", budget: ctx.config.analysis.budgetOps },
    );
    if (fives.kind !== "exhaustive" || fives.holes.length === 0) {
      throw new Error("playK6Game: no post-A1 5-hole — test bug");
    }
    const hole = fives.holes[Math.floor(seedRand() * fives.holes.length) as number] as (typeof fives.holes)[number];
    const hpts = hole.verts.map((id) => byIdAll(cur(), id));
    const hp = hull([...hpts]);
    let placed = false;
    for (let t = 0; t < 200 && !placed; t += 1) {
      const cand = baryInside(hp, seedRand);
      if (legal(cand)) {
        place(cand);
        placed = true;
      }
    }
    if (!placed) {
      throw new Error("playK6Game: no legal targeted B1");
    }
  }
  return finish(cur(), cases, bootPts);
}

function byIdAll(state: GameState, id: string): Pt {
  const p = state.points.find((q) => q.id === id);
  if (p === undefined) {
    throw new Error("test bug: unknown id");
  }
  return p.pt;
}

function finish(state: GameState, cases: (string | null)[], boot: readonly Pt[]): K6GameResult {
  const terminal = state.terminal;
  return {
    won: terminal?.kind === "maker-won",
    terminalKind: terminal?.kind ?? null,
    points: state.points.length,
    nodeId: state.strategy?.nodeId ?? null,
    cases,
    boot,
    integrity:
      terminal?.kind === "strategy-integrity-failure"
        ? { at: terminal.report.failedAt, id: terminal.report.failed.id }
        : null,
  };
}

export function runK6Suite(
  games: number,
  seed0: number,
  b0mode: "forced" | "outside" | "ear" | "immediate-mixed" | "inside-mixed",
  b1mode: "random" | "targeted" | "mixed",
  strategyId = "esmb-k6",
): { wins: number; games: number; failures: string[] } {
  const rand = mulberry32(seed0);
  let wins = 0;
  const failures: string[] = [];
  for (let i = 0; i < games; i += 1) {
    // Mixed modes alternate deterministically by game index (covers all
    // mode combinations inside one seeded suite).
    const b0 = b0mode === "immediate-mixed" ? (i % 2 === 0 ? "outside" : "ear") : b0mode === "inside-mixed" ? (i % 2 === 0 ? "forced" : "ear") : b0mode;
    const b1 = b1mode === "mixed" ? (i % 2 === 0 ? "random" : "targeted") : b1mode;
    const g = playK6Game(rand, b0, b1, strategyId);
    if (g.won) {
      wins += 1;
    } else if (failures.length < 3) {
      failures.push(
        `game ${i}: terminal=${g.terminalKind} points=${g.points} node=${g.nodeId} cases=${g.cases.join(",")} boot=${g.boot.map((p) => `(${p.x.toString()},${p.y.toString()})`).join(" ")}`,
      );
    }
  }
  return { wins, games, failures };
}
